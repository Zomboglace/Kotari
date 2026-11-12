// Compile et lance tests/run.ts.
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outfile = resolve(root, 'dist-server/tests.mjs')
await build({
  entryPoints: [resolve(root, 'tests/run.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  alias: { '@shared': resolve(root, 'src/shared') },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  external: ['bufferutil', 'utf-8-validate'],
  define: { __KOTARI_VERSION__: '"test"' },
  logLevel: 'warning'
})
execFileSync(process.execPath, [outfile], { stdio: 'inherit' })
