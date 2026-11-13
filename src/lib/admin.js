import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

// Admin-only data access for settings + task templates. Every call is tenant-scoped;
// the database also refuses these for non-admins.

const TPL_COLS = 'id, stage_system, stage, trip_types, name, description, task_type, default_role, default_member_id, due_anchor, due_offset_days, reminder_offsets, position, active'

export function useTemplates(tenantId) {
  const [state, setState] = useState({ loading: true, error: null, templates: [] })
  const reload = useCallback(async () => {
    const { data, error } = await supabase.from('task_templates').select(TPL_COLS)
      .eq('tenant_id', tenantId).order('position').order('name')
    setState({ loading: false, error: error?.message ?? null, templates: data ?? [] })
  }, [tenantId])
  useEffect(() => { reload() }, [reload])
  return { ...state, reload }
}

function clean(t) {
  return {
    stage_system: t.stage_system, stage: t.stage, trip_types: t.trip_types ?? [],
    name: t.name.trim(), description: t.description?.trim() || null, task_type: t.task_type || null,
    default_member_id: t.default_member_id || null,
    due_anchor: t.due_anchor || null,
    due_offset_days: t.due_anchor ? Number(t.due_offset_days) || 0 : null,
    reminder_offsets: t.reminder_offsets ?? [], active: t.active ?? true,
  }
}

export async function saveTemplate(tenantId, t) {
  if (t.id) {
    const { error } = await supabase.from('task_templates').update(clean(t)).eq('tenant_id', tenantId).eq('id', t.id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('task_templates').insert({ ...clean(t), tenant_id: tenantId, position: t.position ?? 0 })
    if (error) throw error
  }
}

export async function setTemplateFields(tenantId, id, fields) {
  const { error } = await supabase.from('task_templates').update(fields).eq('tenant_id', tenantId).eq('id', id)
  if (error) throw error
}

export async function deleteTemplate(tenantId, id) {
  const { error } = await supabase.from('task_templates').delete().eq('tenant_id', tenantId).eq('id', id)
  if (error) throw error
}

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data
}
export const addListItem = (tenantId, list, name, before = null) =>
  rpc('admin_add_list_item', { p_tenant: tenantId, p_list: list, p_name: name, p_before: before })
export const renameListItem = (tenantId, list, oldName, newName) =>
  rpc('admin_rename_list_item', { p_tenant: tenantId, p_list: list, p_old: oldName, p_new: newName })
export const removeListItem = (tenantId, list, name) =>
  rpc('admin_remove_list_item', { p_tenant: tenantId, p_list: list, p_name: name })
export const mergeDestination = (tenantId, from, into) =>
  rpc('admin_merge_destination', { p_tenant: tenantId, p_from: from, p_into: into })
export const deleteDestination = (tenantId, name) =>
  rpc('admin_delete_destination', { p_tenant: tenantId, p_name: name })

// Logins: who can sign in, linked to a person on the team or guide list.
export const listAccess = tenantId => rpc('admin_access_list', { p_tenant: tenantId })
export const invitePerson = (tenantId, { email, role, teamMemberId = null, guideId = null }) =>
  rpc('admin_invite', { p_tenant: tenantId, p_email: email, p_role: role, p_team_member: teamMemberId, p_guide: guideId })
export const revokeAccess = (tenantId, kind, id) =>
  rpc('admin_revoke_access', { p_tenant: tenantId, p_kind: kind, p_id: id })
