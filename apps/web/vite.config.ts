import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), {
    name: 'prototype-directory-entry',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split('?')[0]
        if (pathname === '/prototype' || pathname === '/prototype/') {
          res.statusCode = 302
          res.setHeader('Location', '/prototype/index.html')
          res.end()
          return
        }
        next()
      })
    },
  }],
})
