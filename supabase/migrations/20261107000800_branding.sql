-- =============================================================================
-- EcoLogik Labs — 0008 Branding
--   Admins set their organization's name, logo and colors. Stored on the tenant:
--     tenants.name
--     tenants.settings.branding = { logo: data-URL (small PNG/WebP, resized in the
--       browser), colors: { primary, dark, light, tint, line } as #rrggbb,
--       logo_only: true to show just the logo (no name) in the sidebar,
--       fonts: { heading, body } as font keys from the app's bundled list (src/lib/fonts.js) }
--   One RPC so a save never overwrites other settings (stages, lists) by accident.
-- =============================================================================

create or replace function public.admin_set_branding(p_tenant uuid, p_name text, p_branding jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  nm   text := btrim(p_name);
  logo text := p_branding ->> 'logo';
  k    text;
  v    text;
begin
  if not public.is_admin(p_tenant) then raise exception 'Only admins can change branding' using errcode = '42501'; end if;
  if nm is null or nm = '' then raise exception 'Organization name is required'; end if;
  if length(nm) > 120 then raise exception 'Organization name is too long'; end if;
  if jsonb_typeof(p_branding) <> 'object' then raise exception 'Branding must be an object'; end if;
  if logo is not null then
    if logo !~ '^data:image/(png|webp|jpeg|svg\+xml);base64,[A-Za-z0-9+/=]+$' then raise exception 'Logo must be a PNG, WebP, JPEG or SVG image'; end if;
    if length(logo) > 400000 then raise exception 'Logo is too large (keep it under about 300 KB)'; end if;
  end if;
  if p_branding ? 'logo_only' and jsonb_typeof(p_branding -> 'logo_only') <> 'boolean' then raise exception 'logo_only must be true or false'; end if;
  if p_branding ? 'fonts' then
    if jsonb_typeof(p_branding -> 'fonts') <> 'object' then raise exception 'Fonts must be an object'; end if;
    for k, v in select key, value #>> '{}' from jsonb_each(p_branding -> 'fonts') loop
      if k not in ('heading','body') then raise exception 'Unknown font slot %', k; end if;
      if v is null or v !~ '^[a-z0-9-]{1,40}$' then raise exception 'Font % is not a valid choice', k; end if;
    end loop;
  end if;
  if p_branding ? 'colors' then
    if jsonb_typeof(p_branding -> 'colors') <> 'object' then raise exception 'Colors must be an object'; end if;
    for k, v in select key, value #>> '{}' from jsonb_each(p_branding -> 'colors') loop
      if k not in ('primary','dark','light','tint','line') then raise exception 'Unknown color %', k; end if;
      if v !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Color % must look like #9c3d54', k; end if;
    end loop;
  end if;

  update public.tenants
     set name = nm,
         settings = jsonb_set(settings, '{branding}',
                      jsonb_strip_nulls(jsonb_build_object('logo', logo, 'colors', p_branding -> 'colors', 'fonts', p_branding -> 'fonts',
                        'logo_only', case when logo is not null and (p_branding -> 'logo_only') = 'true'::jsonb then true end)), true)
   where id = p_tenant;
  return (select jsonb_build_object('name', name, 'branding', settings -> 'branding') from public.tenants where id = p_tenant);
end $$;
revoke execute on function public.admin_set_branding(uuid, text, jsonb) from public, anon;
grant  execute on function public.admin_set_branding(uuid, text, jsonb) to authenticated;
