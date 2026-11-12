import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ProjectStore } from '@shared/fsproject'
import type { DocMeta, TypeDef } from '@shared/model'
import { isDocMeta, isSafeId, isTypeDef } from '@shared/model'
import { TEMPLATES } from '@shared/templates'
import { atomicWrite } from '@shared/fsproject'
import { isImageHash } from '@shared/images'
import { searchDocs } from '@shared/search'

// Le rendu ne voit jamais de chemin : seul le main connaît le dossier ouvert,
// et toutes les écritures passent par ProjectStore (identifiants validés).
let store: ProjectStore | null = null
let win: BrowserWindow | null = null

export interface ProjectSnapshot {
  path: string
  name: string
  types: TypeDef[]
  docs: DocMeta[]
}

async function snapshot(s: ProjectStore): Promise<ProjectSnapshot> {
  const info = await s.readInfo()
  await s.ensureDirs()
  return { path: s.root, name: info.name, types: await s.listTypes(), docs: await s.listDocs() }
}

function requireStore(): ProjectStore {
  if (!store) throw new Error('Aucun projet ouvert.')
  return store
}

async function isEmptyDir(dir: string): Promise<boolean> {
  try {
    return (await fs.readdir(dir)).length === 0
  } catch {
    return true
  }
}

// ---- Serveurs récents : mot de passe chiffré avec le compte Windows (safeStorage) ----

interface SavedServer {
  id: string
  host: string
  port: number
  secure?: boolean
  name: string
  password?: string
  lastUsed: number
}

const serversFile = () => path.join(app.getPath('userData'), 'servers.json')

async function readServers(): Promise<SavedServer[]> {
  try {
    const list = JSON.parse(await fs.readFile(serversFile(), 'utf8'))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

async function writeServers(list: SavedServer[]) {
  await fs.mkdir(path.dirname(serversFile()), { recursive: true })
  await atomicWrite(serversFile(), JSON.stringify(list, null, 2))
}

function registerIpc() {
  ipcMain.handle('servers:list', async () =>
    (await readServers())
      .sort((a, b) => b.lastUsed - a.lastUsed)
      .map(({ password, ...rest }) => ({ ...rest, hasPassword: !!password }))
  )

  ipcMain.handle('servers:remember', async (_e, entry: unknown, password: unknown) => {
    const e = entry as Partial<SavedServer>
    if (typeof e?.host !== 'string' || typeof e.port !== 'number' || typeof e.name !== 'string') throw new Error('Serveur invalide.')
    const list = await readServers()
    const secure = e.secure === true
    const id = `${secure ? 'wss' : 'ws'}://${e.host}:${e.port}`
    const prev = list.find((x) => x.id === id)
    let enc = prev?.password
    if (typeof password === 'string') {
      enc = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(password).toString('base64') : undefined
    } else if (password === null) enc = undefined
    const next: SavedServer = { id, host: e.host, port: e.port, secure, name: e.name, password: enc, lastUsed: Date.now() }
    await writeServers([next, ...list.filter((x) => x.id !== id)].slice(0, 10))
  })

  ipcMain.handle('servers:password', async (_e, id: unknown) => {
    const s = (await readServers()).find((x) => x.id === id)
    if (!s?.password || !safeStorage.isEncryptionAvailable()) return null
    try {
      return safeStorage.decryptString(Buffer.from(s.password, 'base64'))
    } catch {
      return null
    }
  })

  ipcMain.handle('servers:forget', async (_e, id: unknown) => {
    await writeServers((await readServers()).filter((x) => x.id !== id))
  })

  ipcMain.handle('image:get', async (_e, hash: unknown) => {
    if (!isImageHash(hash)) return null
    return requireStore().readImage(hash)
  })

  ipcMain.handle('image:put', async (_e, hash: unknown, data: unknown) => {
    if (!isImageHash(hash) || !(data instanceof Uint8Array)) throw new Error('Image invalide.')
    await requireStore().writeImage(hash, data)
  })

  ipcMain.handle('image:missing', async (_e, hashes: unknown) => {
    if (!Array.isArray(hashes)) return []
    const s = requireStore()
    const out: string[] = []
    for (const h of hashes) if (isImageHash(h) && !(await s.hasImage(h))) out.push(h)
    return out
  })

  ipcMain.handle('project:search', async (_e, query: unknown, ids: unknown) => {
    if (typeof query !== 'string' || !query.trim()) return []
    const s = requireStore()
    let docs = await s.listDocs()
    if (Array.isArray(ids)) {
      const want = new Set(ids)
      docs = docs.filter((d) => want.has(d.id))
    }
    return searchDocs(docs, await s.listTypes(), (id) => s.readContent(id), query.slice(0, 200))
  })

  ipcMain.handle('project:create', async (_e, name: unknown, withTemplates: unknown) => {
    if (typeof name !== 'string' || !name.trim()) throw new Error('Nom de projet manquant.')
    const res = await dialog.showOpenDialog(win!, {
      title: 'Où créer le projet ?',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || !res.filePaths[0]) return null
    const safeName = name.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80)
    let dir = path.join(res.filePaths[0], safeName)
    if (await ProjectStore.isProject(dir)) throw new Error('Un projet Kotari existe déjà à cet endroit.')
    if (!(await isEmptyDir(dir))) throw new Error(`Le dossier « ${safeName} » existe déjà et n'est pas vide.`)
    store = await ProjectStore.init(dir, name.trim(), withTemplates ? TEMPLATES : [])
    return snapshot(store)
  })

  ipcMain.handle('project:open', async () => {
    const res = await dialog.showOpenDialog(win!, {
      title: 'Ouvrir un projet Kotari',
      properties: ['openDirectory']
    })
    if (res.canceled || !res.filePaths[0]) return null
    const dir = res.filePaths[0]
    if (!(await ProjectStore.isProject(dir))) {
      throw new Error("Ce dossier n'est pas un projet Kotari (kotari.json introuvable).")
    }
    store = new ProjectStore(dir)
    return snapshot(store)
  })

  ipcMain.handle('project:openPath', async (_e, dir: unknown) => {
    if (typeof dir !== 'string') throw new Error('Chemin invalide.')
    if (!(await ProjectStore.isProject(dir))) throw new Error('Projet introuvable : ' + dir)
    store = new ProjectStore(dir)
    return snapshot(store)
  })

  ipcMain.handle('project:close', () => {
    store = null
  })

  ipcMain.handle('project:reveal', () => {
    if (store) void shell.openPath(store.root)
  })

  ipcMain.handle('type:write', async (_e, t: unknown) => {
    if (!isTypeDef(t)) throw new Error('Type invalide.')
    await requireStore().writeType(t)
  })

  ipcMain.handle('type:delete', async (_e, id: unknown) => {
    if (!isSafeId(id)) throw new Error('Identifiant invalide.')
    await requireStore().deleteType(id)
  })

  ipcMain.handle('doc:writeMeta', async (_e, meta: unknown) => {
    if (!isDocMeta(meta)) throw new Error('Document invalide.')
    await requireStore().writeMeta(meta)
  })

  ipcMain.handle('doc:delete', async (_e, id: unknown) => {
    if (!isSafeId(id)) throw new Error('Identifiant invalide.')
    await requireStore().deleteDoc(id)
  })

  ipcMain.handle('doc:read', async (_e, id: unknown) => {
    if (!isSafeId(id)) throw new Error('Identifiant invalide.')
    return requireStore().readContent(id)
  })

  ipcMain.handle('doc:write', async (_e, id: unknown, data: unknown) => {
    if (!isSafeId(id)) throw new Error('Identifiant invalide.')
    if (!(data instanceof Uint8Array)) throw new Error('Contenu invalide.')
    await requireStore().writeContent(id, data)
  })
}

// ---- Mises à jour automatiques (GitHub Releases) ----

let updateReady: string | null = null
let installing = false

function setupUpdater() {
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('update:status', () => updateReady)
  ipcMain.handle('update:install', () => {
    if (!updateReady) return
    installing = true
    autoUpdater.quitAndInstall(false, true)
  })
  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) return 'dev'
    try {
      const r = await autoUpdater.checkForUpdates()
      return r?.isUpdateAvailable ? 'available' : 'none'
    } catch (e) {
      return 'error'
    }
  })
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-downloaded', (info) => {
    updateReady = info.version
    win?.webContents.send('update:ready', info.version)
  })
  autoUpdater.on('error', () => {
    /* hors ligne ou GitHub injoignable : on réessaiera au prochain lancement */
  })
  void autoUpdater.checkForUpdates().catch(() => {})
  // Puis toutes les 4 heures si l'app reste ouverte.
  setInterval(() => void autoUpdater.checkForUpdates().catch(() => {}), 4 * 3600 * 1000)
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 560,
    title: 'Kotari',
    backgroundColor: '#f6f4ef',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win?.show())
  // Correcteur orthographique en français.
  try {
    win.webContents.session.setSpellCheckerLanguages(['fr'])
  } catch {
    /* dictionnaire indisponible */
  }

  // Aucune navigation ni nouvelle fenêtre depuis le rendu.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') {
      win?.webContents.toggleDevTools()
    }
  })

  // Avant de fermer, le rendu écrit les fiches en attente de sauvegarde.
  let flushed = false
  win.on('close', (e) => {
    if (flushed || installing || !win) return
    e.preventDefault()
    const done = () => {
      flushed = true
      win?.close()
    }
    const timer = setTimeout(done, 3000)
    ipcMain.once('app:flushed', () => {
      clearTimeout(timer)
      done()
    })
    win.webContents.send('app:flush')
  })
  win.on('closed', () => {
    win = null
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  registerIpc()
  setupUpdater()
  createWindow()
})

app.on('window-all-closed', () => app.quit())
