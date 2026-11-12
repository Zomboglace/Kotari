// Construit kotari-server en un seul fichier JS (dépendances incluses),
// plus les fichiers d'accompagnement, dans dist-server/kotari-server/.
import { build } from 'esbuild'
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(root, 'dist-server/kotari-server')

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

await build({
  entryPoints: [resolve(root, 'src/server/index.ts')],
  outfile: resolve(out, 'kotari-server.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // Certaines dépendances utilisent require() : on le fournit en ESM.
  banner: { js: "import { createRequire as __kotariCreateRequire } from 'node:module'; const require = __kotariCreateRequire(import.meta.url);" },
  define: { __KOTARI_VERSION__: JSON.stringify(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version) },
  legalComments: 'none',
  logLevel: 'warning',
  // Modules natifs optionnels de ws : absents, ws utilise sa version JS.
  external: ['bufferutil', 'utf-8-validate']
})

cpSync(resolve(root, 'server-dist-files'), out, { recursive: true })
console.log('kotari-server construit dans', out)
