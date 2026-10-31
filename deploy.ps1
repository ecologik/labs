#Requires -Version 5.1
<#
.SYNOPSIS
    Clean-build the Labs dashboard (Vite SPA) and deploy the static output to the
    Apache/cPanel VPS behind Sucuri.

.DESCRIPTION
    Builds to dist/ (Vite SPA: index.html + hashed assets/), stages .htaccess alongside
    it, and uploads the result to the web root. After upload it purges the Sucuri cache
    (optional) and then verifies the live site actually serves the new bundle.

    Two upload paths, and they are NOT equivalent:

      rsync (preferred) -- true mirror. Files at the destination that are not in the
        build are deleted, except $Protected. Supports -DryRun. Sets modes in transit.

      scp (fallback)    -- NOT a mirror. Only the hashed assets/ directory is cleared,
        because that is where stale files accumulate (every build emits new content
        hashes). Stale files elsewhere in the docroot SURVIVE. No dry-run: scp has no
        preview mode. Modes are fixed afterwards over ssh, scoped to uploaded entries.

    Neither path touches $Protected. .well-known/ belongs to ACME / cPanel AutoSSL and a
    deploy must never delete, overwrite, or chmod it -- doing so can break certificate
    renewal. cgi-bin/ is likewise server-owned.

.PARAMETER DryRun
    Preview transfers and deletions without changing the server. rsync path only.

.PARAMETER SkipBuild
    Deploy the existing dist/ without rebuilding. The payload guard still runs.

.EXAMPLE
    .\deploy.ps1 -DryRun
    .\deploy.ps1
#>
[CmdletBinding()]
param(
    [ValidateNotNullOrEmpty()]
    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string]$RemoteUser = "labsecologik",

    [ValidateNotNullOrEmpty()]
    [ValidatePattern('^[A-Za-z0-9._-]+(\.[A-Za-z0-9._-]+)*$')]
    [string]$RemoteHost = "vps.ecologik.net",

    # Must be a relative path ending in "/". Rejects "", "/", "~", "..", and anything
    # with shell-significant characters. This value is interpolated into a remote
    # `rm -rf`, so it fails CLOSED: no match, no deploy.
    [ValidateNotNullOrEmpty()]
    [ValidatePattern('^(?!/)(?!~)(?!\.\.)[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*/$')]
    [string]$RemotePath = "public_html/",

    # Fetched after upload to prove the deploy actually works. See section 6.
    [ValidateNotNullOrEmpty()]
    [ValidatePattern('^https?://[A-Za-z0-9._-]+$')]
    [string]$SiteUrl = "https://labs.ecologik.net",

    # Sucuri firewall cache purge (optional). Fill both to auto-clear after deploy.
    # Sucuri dashboard: Settings > API. Leave blank to skip (then purge manually).
    [string]$SucuriKey    = "",
    [string]$SucuriSecret = "",

    [switch]$DryRun,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$Payload = "dist"
$Target  = "${RemoteUser}@${RemoteHost}:${RemotePath}"

# Server-owned paths that live in the docroot but are never produced by the build.
# Never deleted, never chmod'd, never uploaded over. .well-known/ is ACME's.
$Protected = @(".well-known", "cgi-bin")

# --- 0. Validate the remote path ------------------------------------------------
# ValidatePattern above already rejects the dangerous shapes, but that only fires on
# a bound parameter. Re-assert here so the invariant is checked at the point of use,
# not merely at the point of binding.

if ($RemotePath -notmatch '^(?!/)(?!~)(?!\.\.)[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*/$') {
    throw "Unsafe RemotePath '$RemotePath'. Must be relative, end in '/', and contain no shell metacharacters. Not deploying."
}
if ($RemotePath -split '/' | Where-Object { $_ -eq '..' }) {
    throw "RemotePath '$RemotePath' contains '..'. Not deploying."
}

# --- 1. Clean build ------------------------------------------------------------

if (-not $SkipBuild) {
    Write-Host "==> Clean build" -ForegroundColor Cyan
    if (Test-Path dist) { Remove-Item -Recurse -Force dist }

    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Build failed (exit $LASTEXITCODE). Not deploying." }
}

# --- 2. Payload guard ----------------------------------------------------------
# The upload deletes remote files. If the build silently produced nothing, an
# unguarded deploy would clear assets/ and replace it with an empty tree.

if (-not (Test-Path "$Payload/index.html")) {
    throw "$Payload/index.html is missing -- build did not produce a shell. Not deploying."
}

$assetCount = @(Get-ChildItem "$Payload/assets" -File -ErrorAction SilentlyContinue).Count
if ($assetCount -lt 1) {
    throw "$Payload/assets is empty -- build output looks broken. Not deploying."
}

Write-Host "==> Payload OK: index.html + $assetCount asset(s)" -ForegroundColor Green

# --- 3. Stage .htaccess into the payload ---------------------------------------
# It must ship inside the uploaded tree. On the rsync path anything outside the tree
# is deleted by --delete, so a separately-copied .htaccess would be removed and every
# client-side route would 404.

if (-not (Test-Path ".htaccess")) { throw ".htaccess missing from repo root. Not deploying." }
Copy-Item ".htaccess" "$Payload/.htaccess" -Force
Write-Host "==> Staged .htaccess into $Payload" -ForegroundColor Green

# --- 4. Enumerate what we are actually uploading -------------------------------
# Used to scope the remote chmod. Only these entries are touched; anything else in
# the docroot -- .well-known/ above all -- is left alone.

$uploadEntries = @()
foreach ($item in Get-ChildItem -Force $Payload) {
    if ($item.Name -notmatch '^[A-Za-z0-9._-]+$') {
        throw "Unexpected filename in payload: '$($item.Name)'. It would need shell quoting. Not deploying."
    }
    if ($Protected -contains $item.Name) {
        throw "Payload contains a protected name '$($item.Name)'. Not deploying."
    }
    $uploadEntries += $item.Name
}
if ($uploadEntries.Count -lt 1) { throw "Payload is empty. Not deploying." }

Write-Host "==> Uploading entries: $($uploadEntries -join ', ')" -ForegroundColor Green

# --- 5. Upload -----------------------------------------------------------------

$rsync = Get-Command rsync -ErrorAction SilentlyContinue

if ($rsync) {
    Write-Host "==> Deploying with rsync -> $Target" -ForegroundColor Cyan

    # D755/F644: Apache needs dirs traversable and files readable. Trailing slash on
    # the source uploads the CONTENTS of dist/, not the directory itself.
    $rsyncArgs = @("-avz", "--delete", "--chmod=D755,F644", "--omit-dir-times")
    foreach ($p in $Protected) { $rsyncArgs += "--exclude=/$p/" }
    if ($DryRun) {
        $rsyncArgs += "--dry-run"
        Write-Host "    (dry run -- no changes will be made)" -ForegroundColor Yellow
    }
    $rsyncArgs += @("$Payload/", $Target)

    & rsync @rsyncArgs
    if ($LASTEXITCODE -ne 0) { throw "rsync failed (exit $LASTEXITCODE)." }
}
else {
    Write-Host "==> rsync not found; falling back to scp (NOT a mirror)" -ForegroundColor Yellow

    if ($DryRun) {
        Write-Host "-DryRun is not supported on the scp path (scp has no preview mode)." -ForegroundColor Red
        Write-Host "Install rsync to preview, or re-run without -DryRun to deploy." -ForegroundColor Red
        exit 1
    }

    # Clear stale hashed assets. The remote side re-validates the path independently:
    # a bad value must fail closed even if it somehow passed the local checks.
    Write-Host "==> Clearing stale ${RemotePath}assets" -ForegroundColor Cyan
    $rm = @"
set -eu
d='$RemotePath'
case "`$d" in
  ''|'/'|'~'|'~/'|'.'|'./'|*'..'*) echo "refusing unsafe remote path: `$d" >&2; exit 2 ;;
esac
[ -d "`$d" ] || { echo "docroot not found: `$d" >&2; exit 2; }
[ -n "`$d" ] || { echo "empty remote path" >&2; exit 2; }
rm -rf -- "`${d}assets"
"@
    $rm = $rm -replace "`r", ""   # strip CR: this file is CRLF, remote bash chokes on \r
    & ssh "${RemoteUser}@${RemoteHost}" $rm
    if ($LASTEXITCODE -ne 0) { throw "Remote cleanup failed (exit $LASTEXITCODE). Not uploading." }

    Write-Host "==> Uploading with scp" -ForegroundColor Cyan
    # Upload each entry BY NAME. Do NOT use 'dist/.' -- the trailing '.' makes scp copy
    # the source directory entry itself, stamping the local (Windows, NTFS, modeless)
    # directory's permissions onto the remote docroot. That silently reset public_html
    # to 700 and 403'd the whole site: Apache could no longer traverse in to read
    # .htaccess. Naming entries individually never touches the parent.
    $scpSources = @($uploadEntries | ForEach-Object { "$Payload/$_" })
    & scp -r @scpSources $Target
    if ($LASTEXITCODE -ne 0) { throw "scp failed (exit $LASTEXITCODE)." }

    # scp preserves local modes, which are meaningless coming from Windows/NTFS, so
    # they must be fixed server-side. Scoped to $uploadEntries ONLY -- never a blanket
    # `find public_html/`, which would chmod .well-known/ and can break ACME renewal.
    Write-Host "==> Setting modes 755/644 on uploaded entries only" -ForegroundColor Cyan
    $entryList = ($uploadEntries | ForEach-Object { "'$_'" }) -join " "
    $fix = @"
set -eu
cd '$RemotePath'
# The docroot itself must stay traversable. Apache reads .htaccess through it, so if
# its mode is ever clobbered the whole site 403s with "unable to read htaccess file".
# 755 is the correct, pre-existing mode for a cPanel docroot. Belt-and-braces: the scp
# invocation above no longer touches it, but assert it rather than assume.
chmod 755 .
for p in $entryList; do
  if [ -d "`$p" ]; then
    find "`$p" -type d -exec chmod 755 {} +
    find "`$p" -type f -exec chmod 644 {} +
  elif [ -f "`$p" ]; then
    chmod 644 "`$p"
  fi
done
"@
    $fix = $fix -replace "`r", ""   # strip CR: this file is CRLF, remote bash chokes on \r
    & ssh "${RemoteUser}@${RemoteHost}" $fix
    if ($LASTEXITCODE -ne 0) { throw "Setting permissions failed (exit $LASTEXITCODE)." }
}

if ($DryRun) {
    Write-Host "==> Dry run complete. Nothing was changed." -ForegroundColor Yellow
    return
}

# --- 5.5 Purge Sucuri cache ----------------------------------------------------
# Labs sits behind Sucuri's CDN/WAF. Until the edge cache is cleared, visitors (and
# the verification fetches below) may be served the OLD index.html -> old bundle. Purge
# before verifying so section 6 reflects what actually got deployed.

if ($SucuriKey -and $SucuriSecret) {
    Write-Host "==> Purging Sucuri cache" -ForegroundColor Cyan
    $purgeUrl = "https://waf.sucuri.net/api?v2&k=$SucuriKey&s=$SucuriSecret&a=clear_cache"
    try {
        Invoke-RestMethod -Method Post -Uri $purgeUrl -TimeoutSec 20 | Out-Null
        Write-Host "    Sucuri cache cleared." -ForegroundColor Green
        Start-Sleep -Seconds 3   # let the edge drop the old objects before we verify
    } catch {
        Write-Warning "Sucuri purge failed: $($_.Exception.Message) - clear it manually in the dashboard."
    }
} else {
    Write-Host "(!) Sucuri purge skipped - clear the cache manually in the Sucuri dashboard," -ForegroundColor Yellow
    Write-Host "    or set -SucuriKey/-SucuriSecret. Verification below may show stale content." -ForegroundColor Yellow
}

# --- 6. Post-deploy verification -----------------------------------------------
# A clean exit code does NOT mean the site works. A sibling deploy once returned 0 while
# every URL 403'd, because the upload reset the docroot's mode. Never report success
# without fetching the site and checking that the deployed bundle is actually live.

$expected = $null
if ((Get-Content "$Payload/index.html" -Raw) -match 'src="/assets/(index-[^"]+\.js)"') {
    $expected = $Matches[1]
}

$checks = @()
try {
    $shell = Invoke-WebRequest "$SiteUrl/?cb=$(Get-Random)" -UseBasicParsing -TimeoutSec 20
    $checks += [pscustomobject]@{ Check = "shell 200"; Ok = ($shell.StatusCode -eq 200); Detail = $shell.StatusCode }

    $liveBundle = $null
    if ($shell.Content -match 'src="/assets/(index-[^"]+\.js)"') { $liveBundle = $Matches[1] }
    $checks += [pscustomobject]@{ Check = "bundle matches build"; Ok = ($liveBundle -eq $expected); Detail = "live=$liveBundle build=$expected" }

    if ($liveBundle) {
        $asset = Invoke-WebRequest "$SiteUrl/assets/$liveBundle" -UseBasicParsing -TimeoutSec 20
        $checks += [pscustomobject]@{ Check = "asset 200"; Ok = ($asset.StatusCode -eq 200); Detail = "$($asset.StatusCode) ($($asset.RawContentLength) bytes)" }
    }

    # Deep link via a synthetic path: proves the .htaccess rewrite is live. The path is
    # not a real file, so a 200 means the rewrite served index.html; a 404 means the
    # rewrite is missing and every client-side route is broken.
    $deep = Invoke-WebRequest "$SiteUrl/__deeplink_probe?cb=$(Get-Random)" -UseBasicParsing -TimeoutSec 20
    $checks += [pscustomobject]@{ Check = "deep link via rewrite"; Ok = ($deep.StatusCode -eq 200); Detail = $deep.StatusCode }
}
catch {
    Write-Host "==> VERIFICATION FAILED: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "    The upload completed but the site is not serving correctly." -ForegroundColor Red
    Write-Host "    Check: ssh $RemoteUser@$RemoteHost 'ls -ld ~/$RemotePath'  (docroot must be 755)" -ForegroundColor Red
    exit 1
}

$checks | ForEach-Object {
    if ($_.Ok) { Write-Host "    PASS  $($_.Check): $($_.Detail)" -ForegroundColor Green }
    else       { Write-Host "    FAIL  $($_.Check): $($_.Detail)" -ForegroundColor Red }
}

if ($checks | Where-Object { -not $_.Ok }) {
    Write-Host "==> DEPLOY VERIFICATION FAILED. The site may be broken (or Sucuri is still serving cache)." -ForegroundColor Red
    exit 1
}

Write-Host "==> Deployed and verified: $SiteUrl" -ForegroundColor Green
