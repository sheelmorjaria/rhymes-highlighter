import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The Express backend (npm start) serves /api on 3001; proxying here keeps
    // the frontend's relative /api/... URLs working in local development.
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
