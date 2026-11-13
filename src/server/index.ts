#!/usr/bin/env node
// Point d'entrée en ligne de commande de kotari-server.
//
//   kotari-server init <dossier>     prépare le dossier, demande port et mot de passe
//   kotari-server start <dossier>    démarre le serveur
//   kotari-server password <dossier> change le mot de passe

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { atomicWrite, ProjectStore } from '../shared/fsproject'
import { TEMPLATES } from '../shared/templates'
import { hashPassword } from './password'
import { startServer, timestamp } from './server'

declare const __KOTARI_VERSION__: string
const VERSION = typeof __KOTARI_VERSION__ === 'string' ? __KOTARI_VERSION__ : 'dev'
const DEFAULT_PORT = 4321

interface ServerConfig {
  port: number
  /** Adresse d'écoute : 0.0.0.0 (réseau) ou 127.0.0.1 (derrière Caddy). */
  host?: string
  passwordHash: string
}

function usage(): never {
  console.log(`kotari-server — héberge un projet Kotari pour l'édition à plusieurs

Utilisation :
  kotari-server init <dossier>       prépare le dossier (projet existant ou vide),
                                     demande le port et le mot de passe
  kotari-server start <dossier>      démarre le serveur
  kotari-server password <dossier>   change le mot de passe

Options de init (pour éviter les questions) :
  --port <n>          port d'écoute (défaut ${DEFAULT_PORT})
  --host <adresse>    adresse d'écoute (défaut 0.0.0.0 ; 127.0.0.1 derrière un proxy HTTPS)
  --password <texte>  mot de passe
  --name <texte>      nom du projet s'il est créé
  --templates         ajoute les modèles Note, Lieu, Personnage, Inventaire`)
  process.exit(1)
}

function parseArgs(argv: string[]) {
  const positional: string[] = []
  const flags: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const option = a.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[option] = next
        i++
      } else flags[option] = true
    } else positional.push(a)
  }
  return { positional, flags }
}

function ask(question: string, hidden = false): Promise<string> {
  if (hidden && process.stdin.isTTY) return askHidden(question)
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

/** Saisie masquée (une étoile par caractère), en lisant le clavier directement. */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin
    process.stdout.write(question)
    stdin.setRawMode(true)
    stdin.setEncoding('utf8')
    stdin.resume()
    let value = ''
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.off('data', onData)
          process.stdout.write('\n')
          resolve(value)
          return
        } else if (ch === '\u0003') {
          stdin.setRawMode(false)
          process.stdout.write('\n')
          process.exit(130)
        } else if (ch === '\u007f' || ch === '\b') {
          if (value.length) {
            value = value.slice(0, -1)
            process.stdout.write('\b \b')
          }
        } else if (ch >= ' ') {
          value += ch
          process.stdout.write('*')
        }
      }
    }
    stdin.on('data', onData)
  })
}

async function askPassword(): Promise<string> {
  for (;;) {
    const p1 = await ask('Mot de passe : ', true)
    if (p1.length < 6) {
      console.log('Au moins 6 caractères.')
      continue
    }
    const p2 = await ask('Confirmer : ', true)
    if (p1 === p2) return p1
    console.log('Les deux saisies diffèrent.')
  }
}

const configPath = (dir: string) => path.join(dir, 'server.json')

async function readConfig(dir: string): Promise<ServerConfig> {
  try {
    const c = JSON.parse(await fs.readFile(configPath(dir), 'utf8')) as ServerConfig
    if (typeof c.port !== 'number' || typeof c.passwordHash !== 'string') throw new Error()
    return c
  } catch {
    console.error(`Pas de configuration serveur dans ${dir}. Lance d'abord : kotari-server init "${dir}"`)
    process.exit(1)
  }
}

async function writeConfig(dir: string, c: ServerConfig) {
  await atomicWrite(configPath(dir), JSON.stringify(c, null, 2))
}

function lanAddresses(): string[] {
  const out: string[] = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address)
  }
  return out
}

async function cmdInit(dir: string, flags: Record<string, string | true>) {
  await fs.mkdir(dir, { recursive: true })
  if (await ProjectStore.isProject(dir)) {
    console.log(`Projet Kotari existant : ${dir}`)
  } else {
    const entries = (await fs.readdir(dir)).filter((n) => n !== 'server.json')
    if (entries.length) {
      console.error("Ce dossier n'est ni vide ni un projet Kotari. Choisis un dossier vide ou un projet existant.")
      process.exit(1)
    }
    const name =
      typeof flags.name === 'string' ? flags.name : (await ask(`Nom du projet [${path.basename(dir)}] : `)) || path.basename(dir)
    const withTemplates =
      flags.templates === true ||
      (flags.password === undefined && !/^n/i.test(await ask('Ajouter les modèles Note, Lieu, Personnage, Inventaire ? [O/n] ')))
    await ProjectStore.init(dir, name, withTemplates ? TEMPLATES : [])
    console.log(`Projet « ${name} » créé.`)
  }

  let port = DEFAULT_PORT
  if (typeof flags.port === 'string') port = Number(flags.port)
  else if (flags.password === undefined) {
    const p = await ask(`Port [${DEFAULT_PORT}] : `)
    if (p.trim()) port = Number(p)
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('Port invalide.')
    process.exit(1)
  }

  const host = typeof flags.host === 'string' ? flags.host : undefined
  const password = typeof flags.password === 'string' ? flags.password : await askPassword()
  await writeConfig(dir, { port, host, passwordHash: await hashPassword(password) })
  console.log(`\nConfiguration enregistrée dans ${configPath(dir)} (mot de passe haché).`)
  console.log(`Démarrer :  kotari-server start "${dir}"`)
}

async function cmdPassword(dir: string) {
  const c = await readConfig(dir)
  c.passwordHash = await hashPassword(await askPassword())
  await writeConfig(dir, c)
  console.log('Mot de passe changé. Redémarre le serveur pour l’appliquer.')
}

async function cmdStart(dir: string) {
  if (!(await ProjectStore.isProject(dir))) {
    console.error(`Pas de projet Kotari dans ${dir}. Lance d'abord : kotari-server init "${dir}"`)
    process.exit(1)
  }
  const c = await readConfig(dir)
  const info = await new ProjectStore(dir).readInfo()
  const srv = await startServer({ dir, port: c.port, host: c.host, passwordHash: c.passwordHash })

  console.log(`\nKotari Serveur ${VERSION} — projet « ${info.name} »`)
  console.log(`Dossier : ${path.resolve(dir)}`)
  console.log(`Port    : ${srv.port}`)
  const ips = lanAddresses()
  if (c.host === '127.0.0.1' || c.host === 'localhost') console.log('Écoute en local uniquement (derrière un proxy HTTPS comme Caddy).')
  else if (ips.length) console.log(`Adresse à saisir dans Kotari : ${ips.join('  ou  ')}`)
  console.log('Ctrl+C pour arrêter.\n')

  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    console.log(`[${timestamp()}] Arrêt : enregistrement en cours…`)
    await srv.stop().catch((e) => console.error(e))
    console.log(`[${timestamp()}] Arrêté.`)
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2))
  const [cmd, dirArg] = positional
  if (cmd === 'version' || flags.version) {
    console.log(VERSION)
    return
  }
  if (!cmd || !dirArg) usage()
  const dir = path.resolve(dirArg)
  if (cmd === 'init') await cmdInit(dir, flags)
  else if (cmd === 'start') await cmdStart(dir)
  else if (cmd === 'password') await cmdPassword(dir)
  else usage()
}

main().catch((err) => {
  if (err?.code === 'EADDRINUSE') console.error('Ce port est déjà utilisé. Choisis-en un autre avec init --port.')
  else console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
