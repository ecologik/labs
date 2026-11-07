import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// Always 5174: Google sign-in returns here, and the TWF dashboard holds 5173.
// strictPort stops Vite drifting to 5175 if something else has the port.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true },
})
