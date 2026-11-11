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

const DEFAULT_PORT = 4321

interface ServerConfig {
  port: number
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
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else flags[key] = true
    } else positional.push(a)
  }
  return { positional, flags }
}

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    if (hidden) {
      const rlAny = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream }
      rlAny._writeToOutput = (s: string) => {
        if (s.includes(question)) rlAny.output.write(s)
        else if (s === '\r\n' || s === '\n') rlAny.output.write(s)
        else rlAny.output.write('*'.repeat(s.length))
      }
    }
    rl.question(question, (answer) => {
      rl.close()
      if (hidden) process.stdout.write('\n')
      resolve(answer)
    })
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

  const password = typeof flags.password === 'string' ? flags.password : await askPassword()
  await writeConfig(dir, { port, passwordHash: await hashPassword(password) })
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
  const srv = await startServer({ dir, port: c.port, passwordHash: c.passwordHash })

  console.log(`\nKotari Serveur — projet « ${info.name} »`)
  console.log(`Dossier : ${path.resolve(dir)}`)
  console.log(`Port    : ${srv.port}`)
  const ips = lanAddresses()
  if (ips.length) console.log(`Adresse à saisir dans Kotari : ${ips.join('  ou  ')}`)
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
