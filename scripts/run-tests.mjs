// Lance les tests : `npm test`.
//
// 1. esbuild compile chaque fichier tests/*.test.ts et *.test.tsx (TypeScript,
//    JSX, alias @shared) en un fichier JavaScript dans dist-server/tests/.
// 2. Le lanceur de tests intégré à Node (node:test) les exécute et affiche
//    le résultat de chaque test, groupé par thème.
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { readdirSync, rmSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const testsDir = resolve(root, 'tests')
const outDir = resolve(root, 'dist-server/tests')

const sources = readdirSync(testsDir)
  .filter((f) => /\.test\.tsx?$/.test(f))
  .sort()
  .map((f) => resolve(testsDir, f))

rmSync(outDir, { recursive: true, force: true })

// Chaque fichier est compilé séparément : si l'un ne compile pas (par exemple
// parce qu'il teste une fonctionnalité pas encore écrite), les autres tournent quand même.
const compiled = []
const failed = []
for (const source of sources) {
  const outfile = resolve(outDir, basename(source).replace(/\.tsx?$/, '.mjs'))
  try {
    await build({
      entryPoints: [source],
      outfile,
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'esm',
      jsx: 'automatic',
      alias: { '@shared': resolve(root, 'src/shared') },
      banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
      external: ['bufferutil', 'utf-8-validate'],
      define: { __KOTARI_VERSION__: '"test"' },
      logLevel: 'silent'
    })
    compiled.push(outfile)
  } catch (err) {
    failed.push(basename(source))
    console.error(`\nNE COMPILE PAS : tests/${basename(source)}`)
    for (const e of err.errors ?? []) {
      const where = e.location ? `${e.location.file}:${e.location.line}` : ''
      console.error(`  ${where}  ${e.text}`)
    }
  }
}

const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', '--test-force-exit', ...compiled], {
  stdio: 'inherit'
})

if (failed.length) {
  console.error(`\n${failed.length} fichier(s) de tests ne compilent pas : ${failed.join(', ')}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
