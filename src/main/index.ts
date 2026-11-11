import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ProjectStore } from '@shared/fsproject'
import type { DocMeta, TypeDef } from '@shared/model'
import { isDocMeta, isSafeId, isTypeDef } from '@shared/model'
import { TEMPLATES } from '@shared/templates'

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

function registerIpc() {
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
    if (flushed || !win) return
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
  createWindow()
})

app.on('window-all-closed', () => app.quit())
