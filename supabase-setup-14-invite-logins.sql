-- =============================================================================
-- EcoLogik Labs — Supabase step 14: Invite people to log in (Team & guides)
-- Paste into Supabase → SQL Editor → Run. Safe to re-run.
-- =============================================================================
-- =============================================================================
-- EcoLogik Labs — 0011 Invite people to log in (admin, from Team & guides)
--   An invitation pairs an email + role with a person on the team or guide list.
--   On first Google sign-in with that email it becomes a membership (0001), so the
--   login is linked to the person and their trips/tasks.
--   These RPCs let an admin invite, re-invite (change email/role), see who has
--   signed in, and remove a login, without touching auth.users directly.
-- =============================================================================

-- Who can log in, per person: open invitations and accepted logins (with the
-- Google email they signed in with, which only lives in auth.users).
create or replace function public.admin_access_list(p_tenant uuid)
returns table (kind text, id uuid, email text, role text, team_member_id uuid, guide_id uuid, is_me boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin(p_tenant) then raise exception 'Only admins can see logins' using errcode = '42501'; end if;
  return query
    select 'login'::text, m.id, u.email::text, m.role, m.team_member_id, m.guide_id, m.user_id = auth.uid()
      from public.memberships m join auth.users u on u.id = m.user_id
     where m.tenant_id = p_tenant
    union all
    select 'invite'::text, i.id, i.email, i.role, i.team_member_id, i.guide_id, false
      from public.invitations i
     where i.tenant_id = p_tenant and i.accepted_at is null;
end $$;

-- Invite (or re-invite) one person. Exactly one of p_team_member / p_guide is the
-- person; a team member who is also a guide gets both links automatically.
-- If that email already has a Google login, access is granted right away.
create or replace function public.admin_invite(p_tenant uuid, p_email text, p_role text, p_team_member uuid, p_guide uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_tm uuid := p_team_member;
  v_guide uuid := p_guide;
  v_user uuid;
  v_member public.memberships;
begin
  if not public.is_admin(p_tenant) then raise exception 'Only admins can invite people' using errcode = '42501'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 200 then raise exception 'That email address doesn''t look right'; end if;
  if p_role not in ('staff', 'admin', 'guide') then raise exception 'Unknown role %', p_role; end if;
  if (v_tm is null) = (v_guide is null) then raise exception 'Pick one person to invite'; end if;

  if v_tm is not null then
    if not exists (select 1 from public.team_members where tenant_id = p_tenant and id = v_tm) then raise exception 'Unknown team member'; end if;
    if p_role = 'guide' then raise exception 'Office team members log in as staff or admin'; end if;
    select g.id into v_guide from public.guides g where g.tenant_id = p_tenant and g.team_member_id = v_tm and g.active limit 1;
  else
    select g.team_member_id into v_tm from public.guides g where g.tenant_id = p_tenant and g.id = v_guide;
    if not found then raise exception 'Unknown guide'; end if;
    if v_tm is not null then raise exception 'This guide is also on the office team: invite them from the Office team list'; end if;
    if p_role <> 'guide' then raise exception 'Guides log in with the guide role'; end if;
  end if;

  -- The person already has a login: change its role (the email stays the one they sign in with).
  select * into v_member from public.memberships m
   where m.tenant_id = p_tenant and ((v_tm is not null and m.team_member_id = v_tm) or (v_tm is null and m.guide_id = v_guide))
   limit 1;
  if found then
    if v_member.user_id = auth.uid() and p_role <> 'admin' then raise exception 'You can''t remove your own admin role'; end if;
    update public.memberships set role = p_role, guide_id = coalesce(v_guide, guide_id) where id = v_member.id;
    return 'updated';
  end if;

  -- One open invitation per person and per email.
  delete from public.invitations i
   where i.tenant_id = p_tenant and i.accepted_at is null
     and (lower(i.email) = v_email or (v_tm is not null and i.team_member_id = v_tm) or (v_tm is null and i.guide_id = v_guide));

  select u.id into v_user from auth.users u where lower(u.email) = v_email limit 1;
  if v_user is not null and exists (select 1 from public.memberships m where m.tenant_id = p_tenant and m.user_id = v_user) then
    raise exception 'That email already logs in as someone else';
  end if;

  insert into public.invitations (tenant_id, email, role, team_member_id, guide_id, invited_by)
  values (p_tenant, v_email, p_role, v_tm, v_guide, auth.uid());

  if v_user is not null then
    perform public.accept_invitations_for(v_user, v_email);
    return 'granted';
  end if;
  return 'invited';
end $$;

-- Cancel an open invitation, or remove a login (never your own).
create or replace function public.admin_revoke_access(p_tenant uuid, p_kind text, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin(p_tenant) then raise exception 'Only admins can remove logins' using errcode = '42501'; end if;
  if p_kind = 'invite' then
    delete from public.invitations where tenant_id = p_tenant and id = p_id and accepted_at is null;
  elsif p_kind = 'login' then
    if exists (select 1 from public.memberships where tenant_id = p_tenant and id = p_id and user_id = auth.uid()) then
      raise exception 'You can''t remove your own login';
    end if;
    delete from public.memberships where tenant_id = p_tenant and id = p_id;
  else
    raise exception 'Unknown kind %', p_kind;
  end if;
end $$;

revoke all on function public.admin_access_list(uuid) from public;
revoke all on function public.admin_invite(uuid, text, text, uuid, uuid) from public;
revoke all on function public.admin_revoke_access(uuid, text, uuid) from public;
grant execute on function public.admin_access_list(uuid) to authenticated;
grant execute on function public.admin_invite(uuid, text, text, uuid, uuid) to authenticated;
grant execute on function public.admin_revoke_access(uuid, text, uuid) to authenticated;
