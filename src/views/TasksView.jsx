import { BUCKET_LABEL, STATUSES, dueBucket } from '../lib/format'
import { isQueued } from '../lib/data'
import { useState } from 'react'
import { Avatar, Empty, FilterPin, SearchBox, StatusFilter, TaskRow, textFilter, useStatusFilter } from './common'
import TaskBoard, { LayoutToggle, useTaskLayout } from './TaskBoard'

const ORDER = ['overdue', 'week', 'later', 'nodate', 'done']

function Groups({ list, tripById, teamById, onStatus, onNote }) {
  const groups = {}
  for (const t of list) (groups[dueBucket(t)] ||= []).push(t)
  return ORDER.filter(b => groups[b]?.length).map(b => (
    <div className="card" key={b}>
      <div className="card-h"><h2 className={'bucket-' + b}>{BUCKET_LABEL[b]}</h2><span className="muted small">{groups[b].length}</span></div>
      {groups[b].map(t => <TaskRow key={t.id} task={t} trip={tripById[t.trip_id]} teamById={teamById} onStatus={onStatus} onNote={onNote} />)}
    </div>
  ))
}

export function MyTasks({ me, tasks, tripById, teamById, onStatus, onNote }) {
  const filter = useStatusFilter('mine')
  const [layout, setLayout] = useTaskLayout('mine', 'list')
  const [q, setQ] = useState('')
  if (!me) return <div className="view"><Empty>Your login isn't linked to a team member yet, so there's no personal list. An admin can link it.</Empty></div>
  const all = textFilter(q, tripById)(tasks.filter(t => t.assignees.includes(me) && !isQueued(t, tripById)))
  const list = filter.apply(all)
  return (
    <div className="view">
      <div className="task-tools">
        <StatusFilter filter={filter} tasks={all} />
        <span className="push" />
        <SearchBox value={q} onChange={setQ} />
        <LayoutToggle value={layout} onChange={setLayout} />
      </div>
      <FilterPin.Provider value={filter}>
        {layout === 'board' && all.length
          ? <TaskBoard tasks={list} tripById={tripById}
              hidden={Object.fromEntries(STATUSES.map(st => [st, all.filter(t => t.status === st).length - list.filter(t => t.status === st).length]))} teamById={teamById} onStatus={onStatus} onNote={onNote} />
          : list.length ? <Groups list={list} tripById={tripById} teamById={teamById} onStatus={onStatus} onNote={onNote} />
          : <Empty>{all.length ? 'No tasks match this filter.' : q.trim() ? `No tasks match “${q.trim()}”.` : 'Nothing assigned to you.'}</Empty>}
      </FilterPin.Provider>
    </div>
  )
}

// Which team member's tasks Team Tasks shows ('' = everyone). Remembered in this browser.
const WHO_KEY = 'labs.teamFilter'
function useWho() {
  const [who, setWhoState] = useState(() => { try { return localStorage.getItem(WHO_KEY) || '' } catch { return '' } })
  const setWho = v => { setWhoState(v); try { localStorage.setItem(WHO_KEY, v) } catch { /* fine */ } }
  return [who, setWho]
}

export function TeamTasks({ tasks, team, tripById, teamById, onStatus, onNote }) {
  const filter = useStatusFilter('team')
  const [who, setWho] = useWho()
  const [q, setQ] = useState('')
  const all = textFilter(q, tripById)(tasks.filter(t => !isQueued(t, tripById)))
  const live = filter.apply(all)
  const active = team.filter(m => m.active)
  const sel = active.some(m => m.id === who) ? who : ''      // a saved pick for someone no longer active = everyone
  const searching = q.trim() !== ''
  // While searching "Everyone", skip people with no matching tasks.
  const shown = sel ? active.filter(m => m.id === sel) : searching ? active.filter(m => live.some(t => t.assignees.includes(m.id))) : active
  return (
    <div className="view">
      <StatusFilter filter={filter} tasks={all} />
      <div className="status-filter who-filter" role="group" aria-label="Filter by team member">
        <span className="muted small">Team member</span>
        <button className={'who-chip' + (!sel ? ' on' : '')} aria-pressed={!sel} onClick={() => setWho('')}>Everyone</button>
        {active.map(m => (
          <button key={m.id} className={'who-chip' + (sel === m.id ? ' on' : '')} aria-pressed={sel === m.id} onClick={() => setWho(sel === m.id ? '' : m.id)}>
            <Avatar member={m} sm />{m.name.split(/\s+/)[0]} <span className="sf-n">{live.filter(t => t.assignees.includes(m.id)).length}</span>
          </button>
        ))}
        <span className="push" />
        <SearchBox value={q} onChange={setQ} />
      </div>
      <FilterPin.Provider value={filter}>
      {searching && !shown.length && <Empty>No tasks match “{q.trim()}”.</Empty>}
      {shown.map(m => {
        const list = live.filter(t => t.assignees.includes(m.id))
        const overdue = list.filter(t => dueBucket(t) === 'overdue').length
        return (
          <div className="card" key={m.id}>
            <div className="card-h"><h2>{m.name}</h2><span className="muted small">{list.length} shown{overdue ? ` · ${overdue} overdue` : ''}</span></div>
            {list.length ? list.map(t => <TaskRow key={t.id} task={t} trip={tripById[t.trip_id]} teamById={teamById} onStatus={onStatus} onNote={onNote} />) : <Empty>{all.some(t => t.assignees.includes(m.id)) ? 'Nothing matches this filter.' : q.trim() ? `No tasks match “${q.trim()}”.` : 'All clear.'}</Empty>}
          </div>
        )
      })}
      </FilterPin.Provider>
    </div>
  )
}
