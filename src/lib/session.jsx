import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'

const SessionCtx = createContext(null)
const TENANT_KEY = 'labs.activeTenant'

function readStoredTenant() {
  try { return localStorage.getItem(TENANT_KEY) } catch { return null }
}
function storeTenant(id) {
  try { localStorage.setItem(TENANT_KEY, id) } catch { /* private mode: fine */ }
}

export function SessionProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = still loading
  const [memberships, setMemberships] = useState(null)
  const [activeTenantId, setActiveTenantId] = useState(readStoredTenant)
  const [error, setError] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s ?? null))
    return () => sub.subscription.unsubscribe()
  }, [])

  const userId = session?.user?.id
  useEffect(() => {
    if (!userId) { setMemberships(null); return }
    let cancelled = false
    ;(async () => {
      // Turns any open invitation for this email into a login (no-op if none).
      await supabase.rpc('claim_invitations')
      const { data, error: err } = await supabase
        .from('memberships')
        .select('id, role, team_member_id, guide_id, tenant:tenants(id, slug, name, modules, settings)')
        .eq('user_id', userId)
      if (cancelled) return
      if (err) setError(err.message)
      setMemberships(data ?? [])
    })()
    return () => { cancelled = true }
  }, [userId, refreshKey])

  const membership = useMemo(() => {
    if (!memberships?.length) return null
    return memberships.find(m => m.tenant.id === activeTenantId) ?? memberships[0]
  }, [memberships, activeTenantId])

  const switchTenant = useCallback(id => { storeTenant(id); setActiveTenantId(id) }, [])

  const signInWithGoogle = useCallback(() => supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  }), [])

  const signOut = useCallback(() => supabase.auth.signOut(), [])
  // Re-read tenant settings (e.g. after an admin edits stage lists).
  const refreshTenant = useCallback(() => setRefreshKey(k => k + 1), [])

  const value = {
    loading: session === undefined || (session && memberships === null),
    session, user: session?.user ?? null, error,
    memberships: memberships ?? [], membership,
    tenant: membership?.tenant ?? null,
    role: membership?.role ?? null,
    isStaff: membership?.role === 'staff' || membership?.role === 'admin',
    isAdmin: membership?.role === 'admin',
    hasModule: key => Boolean(membership?.tenant?.modules?.[key]),
    switchTenant, signInWithGoogle, signOut, refreshTenant,
  }
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>
}

export function useSession() {
  const ctx = useContext(SessionCtx)
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>')
  return ctx
}
