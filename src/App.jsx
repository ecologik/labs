import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { supabaseConfigured } from './lib/supabase'
import { SessionProvider, useSession } from './lib/session'
import { setTaskNote, setTaskStatus, useTenantData } from './lib/data'
import SignIn from './views/SignIn'
import NoAccess from './views/NoAccess'
import Setup from './views/Setup'
import TripsView from './views/TripsView'
import TripDetail from './views/TripDetail'
import { MyTasks, TeamTasks } from './views/TasksView'
import GuideHome from './views/GuideHome'
import TemplatesAdmin from './views/TemplatesAdmin'
import BrandingAdmin from './views/BrandingAdmin'
import { applyBranding } from './lib/brand'
import { applyFonts } from './lib/fonts'
import { Empty } from './views/common'
import Icon from './views/Icon'
import NewTripModal from './views/NewTripModal'
import DestinationsAdmin from './views/DestinationsAdmin'
import TeamAdmin from './views/TeamAdmin'

const STAFF_NAV = [
  { key: 'trips', label: 'Trips', icon: 'trips' },
  { key: 'mine', label: 'My Tasks', icon: 'mine' },
  { key: 'team', label: 'Team Tasks', icon: 'team' },
]
const ADMIN_NAV = [
  { key: 'templates', label: 'Task templates', icon: 'templates' },
  { key: 'people', label: 'Team & guides', icon: 'team' },
  { key: 'destinations', label: 'Destinations', icon: 'pin' },
  { key: 'branding', label: 'Branding', icon: 'brand' },
]
const GUIDE_NAV = [
  { key: 'calendar', label: 'Calendar', icon: 'cal' },
  { key: 'heritage', label: 'Heritage Trips', icon: 'heritage' },
]

function Shell() {
  const { tenant, role, isStaff, isAdmin, membership, memberships, switchTenant, user, signOut } = useSession()
  const mainNav = isStaff ? STAFF_NAV : GUIDE_NAV
  const nav = isAdmin ? [...mainNav, ...ADMIN_NAV] : mainNav
  const [view, setView] = useState(nav[0].key)
  const [tripId, setTripId] = useState(null)
  const data = useTenantData(tenant.id, isStaff)
  const branding = tenant.settings?.branding
  useEffect(() => { applyBranding(branding?.colors); applyFonts(branding?.fonts); document.title = tenant.name }, [branding, tenant.name])

  const tripById = useMemo(() => Object.fromEntries(data.trips.map(t => [t.id, t])), [data.trips])
  const teamById = useMemo(() => Object.fromEntries(data.team.map(m => [m.id, m])), [data.team])
  const [actionErr, setActionErr] = useState(null)
  const [newTrip, setNewTrip] = useState(false)
  const counts = useMemo(() => {
    const me = membership?.team_member_id
    return {
      trips: data.trips.length,
      mine: me ? data.tasks.filter(t => t.assignees.includes(me) && t.status !== 'Complete' && !(t.gate != null && (tripById[t.trip_id]?.trip_stage ?? 0) < t.gate)).length : 0,
    }
  }, [data.trips, data.tasks, tripById, membership])
  const navBtn = n => (
    <button key={n.key} className={'nav' + (n.key === view ? ' active' : '')} onClick={() => go(n.key)}>
      <Icon name={n.icon} />{n.label}{isStaff && counts[n.key] > 0 && <span className="badge">{counts[n.key]}</span>}
    </button>
  )
  const onStatus = async (task, status) => {
    setActionErr(null)
    try { await setTaskStatus(tenant.id, task.id, status); await data.reload() } catch (e) { setActionErr(e.message) }
  }

  const onNote = async (task, note) => {
    setActionErr(null)
    try { await setTaskNote(tenant.id, task.id, note); await data.reload() } catch (e) { setActionErr(e.message); throw e }
  }

  const go = k => { setView(k); setTripId(null) }
  const openTrip = id => { setView('trips'); setTripId(id) }
  const current = nav.find(n => n.key === view) ?? nav[0]

  let body
  if (!isStaff) body = <GuideHome section={view} />
  else if (data.loading) body = <div className="view"><Empty>Loading…</Empty></div>
  else if (data.error) body = <div className="view"><p className="err">{data.error}</p></div>
  else if (view === 'trips' && tripId && tripById[tripId])
    body = <TripDetail tenant={tenant} trip={tripById[tripId]} tasks={data.tasks} teamById={teamById} tripById={tripById} guides={data.guides}
      onStatus={onStatus} onNote={onNote} back={() => setTripId(null)} reload={data.reload} />
  else if (view === 'trips')
    body = <TripsView tenant={tenant} guides={data.guides} trips={data.trips} tasks={data.tasks} teamById={teamById} openTrip={openTrip} reload={data.reload} />
  else if (view === 'templates' && isAdmin)
    body = <TemplatesAdmin team={data.team} />
  else if (view === 'people' && isAdmin)
    body = <TeamAdmin team={data.team} guides={data.guides} trips={data.trips} tasks={data.tasks} reload={data.reload} />
  else if (view === 'destinations' && isAdmin)
    body = <DestinationsAdmin trips={data.trips} reload={data.reload} />
  else if (view === 'branding' && isAdmin)
    body = <BrandingAdmin />
  else if (view === 'mine')
    body = <MyTasks me={membership.team_member_id} tasks={data.tasks} tripById={tripById} teamById={teamById} onStatus={onStatus} onNote={onNote} />
  else body = <TeamTasks tasks={data.tasks} team={data.team} tripById={tripById} teamById={teamById} onStatus={onStatus} onNote={onNote} />

  return (
    <div className="app">
      <aside className="sidebar">
        {branding?.logo && branding.logo_only
          ? <div className="brand logo-only"><img className="brand-logo" src={branding.logo} alt={tenant.name} /></div>
          : <div className="brand">{branding?.logo ? <img className="brand-logo" src={branding.logo} alt="" /> : <div className="brand-mark">{tenant.name[0]}</div>}
            <div><div className="brand-name">{tenant.name}</div><div className="brand-sub">EcoLogik Labs</div></div></div>}
        {mainNav.map(navBtn)}
        {isStaff && <button className="btn side-new" onClick={() => setNewTrip(true)}>+ New Trip</button>}
        {isAdmin && <>
          <div className="navlbl">Admin</div>
          {ADMIN_NAV.map(navBtn)}
        </>}
        <div className="side-foot">
          {memberships.length > 1 && (
            <select className="tenant-sel" value={tenant.id} onChange={e => switchTenant(e.target.value)}>
              {memberships.map(m => <option key={m.tenant.id} value={m.tenant.id}>{m.tenant.name}</option>)}
            </select>
          )}
          <div className="who">{user.email}</div>
          <div className="muted small">Role: {role}</div>
          <button className="linkbtn" onClick={signOut}>Sign out</button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar"><h1>{tripId && view === 'trips' ? 'Trip' : current.label}</h1></header>
        {actionErr && <p className="err pad">{actionErr}</p>}
        {body}
      </main>
      {newTrip && <NewTripModal tenant={tenant} teamById={teamById} guides={data.guides} onClose={() => setNewTrip(false)}
        onCreated={id => { setNewTrip(false); data.reload().then(() => openTrip(id)) }} />}
    </div>
  )
}

function Gate() {
  const { loading, session, membership } = useSession()
  if (loading) return <div className="center-screen muted">Loading…</div>
  if (!session) return <SignIn />
  if (!membership) return <NoAccess />
  return <Shell key={membership.tenant.id} />
}

export default function App() {
  if (!supabaseConfigured) return <Setup />
  return <SessionProvider><Gate /></SessionProvider>
}
