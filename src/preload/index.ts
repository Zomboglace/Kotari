import { contextBridge, ipcRenderer } from 'electron'

// API minimale exposée au rendu. Aucun chemin de fichier n'est accepté
// en écriture : le main sait quel dossier est ouvert.
const api = {
  createProject: (name: string, withTemplates: boolean) =>
    ipcRenderer.invoke('project:create', name, withTemplates),
  openProject: () => ipcRenderer.invoke('project:open'),
  openProjectPath: (p: string) => ipcRenderer.invoke('project:openPath', p),
  closeProject: () => ipcRenderer.invoke('project:close'),
  revealProject: () => ipcRenderer.invoke('project:reveal'),
  writeType: (t: unknown) => ipcRenderer.invoke('type:write', t),
  deleteType: (id: string) => ipcRenderer.invoke('type:delete', id),
  writeMeta: (m: unknown) => ipcRenderer.invoke('doc:writeMeta', m),
  deleteDoc: (id: string) => ipcRenderer.invoke('doc:delete', id),
  readContent: (id: string) => ipcRenderer.invoke('doc:read', id),
  writeContent: (id: string, data: Uint8Array) => ipcRenderer.invoke('doc:write', id, data),
  readImage: (hash: string) => ipcRenderer.invoke('image:get', hash),
  writeImage: (hash: string, data: Uint8Array) => ipcRenderer.invoke('image:put', hash, data),
  missingImages: (hashes: string[]) => ipcRenderer.invoke('image:missing', hashes),
  search: (query: string, ids?: string[]) => ipcRenderer.invoke('project:search', query, ids),
  listServers: () => ipcRenderer.invoke('servers:list'),
  rememberServer: (entry: unknown, password: string | null | undefined) =>
    ipcRenderer.invoke('servers:remember', entry, password),
  serverPassword: (id: string) => ipcRenderer.invoke('servers:password', id),
  forgetServer: (id: string) => ipcRenderer.invoke('servers:forget', id),
  onFlushRequest: (cb: () => Promise<void>) => {
    ipcRenderer.on('app:flush', async () => {
      try {
        await cb()
      } finally {
        ipcRenderer.send('app:flushed')
      }
    })
  }
}

contextBridge.exposeInMainWorld('kotari', api)

export type KotariApi = typeof api
