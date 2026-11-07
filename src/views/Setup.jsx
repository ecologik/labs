export default function Setup() {
  return (
    <div className="center-screen">
      <div className="card signin">
        <h1>Supabase isn't configured</h1>
        <p className="muted">Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to <code>.env.local</code> and restart <code>npm run dev</code>.</p>
      </div>
    </div>
  )
}
