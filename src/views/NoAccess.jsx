import { useSession } from '../lib/session'

export default function NoAccess() {
  const { user, signOut, error } = useSession()
  return (
    <div className="center-screen">
      <div className="card signin">
        <h1>No access yet</h1>
        <p className="muted">You're signed in as <b>{user?.email}</b>, but this account hasn't been invited to a workspace.
          Ask your administrator to invite this email, then sign in again.</p>
        {error && <p className="err">{error}</p>}
        <button className="btn ghost" onClick={signOut}>Sign out</button>
      </div>
    </div>
  )
}
