import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Toutes les dépendances sont regroupées dans le bundle : l'app installée
// n'embarque aucun node_modules.
export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } }
  },
  preload: {
    resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
    plugins: [
      react(),
      {
        // CSP stricte dans l'app construite ; en dev, Vite injecte des scripts inline.
        name: 'kotari-csp',
        transformIndexHtml(html, ctx) {
          const csp = ctx.server
            ? ''
            : `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:" />`
          return html.replace('<!--KOTARI_CSP-->', csp)
        }
      }
    ],
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') }
    }
  }
})
