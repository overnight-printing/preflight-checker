import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

const packageVersion = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
).version

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_ACTIONS ? '/overnight-preflight-tool/' : '/',
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(packageVersion),
  },
})
