import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import * as Y from 'yjs'
import type { CopyPlan, ExportedDoc } from '@shared/copy'
import type { DocMeta, TypeDef } from '@shared/model'
import { isDocMeta, isTypeDef, newId, pickMeta } from '@shared/model'
import type { AuthToken, ClientMessage, ServerMessage } from '@shared/protocol'
import { TREE_ROOM, docRoom, fromBase64, toBase64 } from '@shared/protocol'
import type { SearchHit } from '@shared/search'
import { Emitter, type Library, type LibraryState, type OpenedDoc } from './library'

/** Adresse affichée : le port est omis quand c'est celui par défaut. */
export function serverLabel(host: string, port: number, secure: boolean): string {
  return (secure && port === 443) || (!secure && port === 80) ? host : `${host}:${port}`
}

export interface ConnectOptions {
  /** wss:// (via HTTPS, ex. derrière Caddy) plutôt que ws://. */
  secure?: boolean
  host: string
  port: number
  password: string
  name: string
}

export interface Peer {
  clientId: number
  name: string
  color: string
}

export type ServerStatus = 'connected' | 'reconnecting'

const COLORS = ['#c2410c', '#0f766e', '#7c3aed', '#be123c', '#1d4ed8', '#a16207', '#15803d', '#9d174d']

export function colorFor(name: string): string {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0
  return COLORS[Math.abs(h) % COLORS.length]
}

const REQUEST_TIMEOUT = 60_000
const KEEP_OPEN_MS = 30_000

/**
 * Bibliothèque hébergée par kotari-server.
 * Room `__tree` : map `docs` (métas) et map `types`. Une room par document ouvert.
 * Création et copie passent par un message au serveur, qui écrit le contenu
 * avant d'ajouter les métas à l'arbre.
 */
export class ServerLibrary implements Library {
  readonly kind = 'server' as const
  readonly label: string
  readonly user: { name: string; color: string }
  private socket: HocuspocusProviderWebsocket
  private tree: HocuspocusProvider
  private treeDoc = new Y.Doc()
  private state: LibraryState = { docs: [], types: [] }
  private emitter = new Emitter()
  private pending = new Map<string, { resolve: (m: ServerMessage) => void; reject: (e: Error) => void }>()
  private token: string
  private destroyed = false
  peers: Peer[] = []
  status: ServerStatus = 'connected'
  onLost: (reason: string) => void = () => {}

  private constructor(opts: ConnectOptions) {
    this.label = serverLabel(opts.host, opts.port, !!opts.secure)
    this.user = { name: opts.name, color: colorFor(opts.name) }
    const auth: AuthToken = { password: opts.password, name: opts.name }
    this.token = JSON.stringify(auth)
    this.socket = new HocuspocusProviderWebsocket({
      // Coupure réseau : reconnexion automatique, Yjs fusionne au retour.
      url: `${opts.secure ? 'wss' : 'ws'}://${opts.host}:${opts.port}`
    })
    this.tree = new HocuspocusProvider({
      websocketProvider: this.socket,
      name: TREE_ROOM,
      document: this.treeDoc,
      token: this.token,
      onStateless: ({ payload }) => this.handleStateless(payload)
    })
    this.tree.setAwarenessField('user', this.user)

    const docsMap = this.treeDoc.getMap<DocMeta>('docs')
    const typesMap = this.treeDoc.getMap<TypeDef>('types')
    const refresh = () => {
      this.state = {
        docs: [...docsMap.values()].filter(isDocMeta).map(pickMeta),
        types: [...typesMap.values()].filter(isTypeDef).sort((a, b) => a.order - b.order)
      }
      this.emitter.emit()
    }
    docsMap.observe(refresh)
    typesMap.observe(refresh)

    this.tree.awareness?.on('change', () => {
      const states = this.tree.awareness?.getStates() ?? new Map()
      this.peers = [...states.entries()]
        .map(([clientId, s]) => ({ clientId, ...(s.user ?? {}) }))
        .filter((p): p is Peer => typeof p.name === 'string')
      this.state = { ...this.state }
      this.emitter.emit()
    })

    this.socket.on('status', ({ status }: { status: string }) => {
      const next: ServerStatus = status === 'connected' ? 'connected' : 'reconnecting'
      if (next !== this.status) {
        this.status = next
        this.state = { ...this.state }
        this.emitter.emit()
      }
    })
  }

  /** Se connecte et attend la première synchronisation de l'arbre. */
  static connect(opts: ConnectOptions): Promise<ServerLibrary> {
    const lib = new ServerLibrary(opts)
    return new Promise((resolve, reject) => {
      let settled = false
      const fail = (msg: string) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        lib.destroy()
        reject(new Error(msg))
      }
      const timer = setTimeout(
        () => fail(`Impossible de joindre ${lib.label}. Vérifie l'adresse, le port, et que le serveur est démarré.`),
        8000
      )
      lib.tree.on('authenticationFailed', () => fail('Mot de passe refusé.'))
      lib.tree.on('synced', () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        lib.tree.on('authenticationFailed', () => lib.lose('Le serveur a refusé la connexion.'))
        resolve(lib)
      })
      lib.tree.attach()
    })
  }

  private lose(reason: string) {
    if (this.destroyed) return
    this.destroy()
    this.onLost(reason)
  }

  getState = () => this.state
  subscribe = (cb: () => void) => this.emitter.subscribe(cb)

  private handleStateless(payload: string) {
    let msg: ServerMessage
    try {
      msg = JSON.parse(payload)
    } catch {
      return
    }
    const p = this.pending.get(msg.requestId)
    if (!p) return
    this.pending.delete(msg.requestId)
    if (msg.error) p.reject(new Error(msg.error))
    else p.resolve(msg)
  }

  private request(msg: ClientMessage): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(msg.requestId)
        reject(new Error('Le serveur ne répond pas.'))
      }, REQUEST_TIMEOUT)
      this.pending.set(msg.requestId, {
        resolve: (m) => {
          clearTimeout(timer)
          resolve(m)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        }
      })
      this.tree.sendStateless(JSON.stringify(msg))
    })
  }

  async createDoc(meta: DocMeta, content: Uint8Array) {
    await this.importDocs({ docs: [{ meta, content }], newTypes: [] })
  }

  updateMeta(id: string, patch: Partial<Omit<DocMeta, 'id'>>) {
    const docs = this.treeDoc.getMap<DocMeta>('docs')
    const cur = docs.get(id)
    if (cur) docs.set(id, pickMeta({ ...cur, ...patch }))
  }

  async deleteDocs(ids: string[]) {
    const docs = this.treeDoc.getMap<DocMeta>('docs')
    this.treeDoc.transact(() => {
      for (const id of ids) docs.delete(id)
    })
  }

  async saveType(t: TypeDef) {
    this.treeDoc.getMap<TypeDef>('types').set(t.id, structuredClone(t))
  }

  async deleteType(id: string) {
    if (this.state.docs.some((d) => d.typeId === id)) throw new Error('Ce type est encore utilisé.')
    this.treeDoc.getMap<TypeDef>('types').delete(id)
  }

  /**
   * Un seul fournisseur par document, partagé (fiche + carte, fermeture puis réouverture rapide).
   * Deux fournisseurs du même document sur une même connexion, ou un document rouvert pendant que
   * le serveur traite sa fermeture, se désynchronisent : la saisie n'atteint plus le serveur.
   */
  private docs = new Map<
    string,
    { ydoc: Y.Doc; provider: HocuspocusProvider; refs: number; ready: Promise<void>; release: ReturnType<typeof setTimeout> | null }
  >()
  private closedAt = new Map<string, number>()

  async openDoc(id: string): Promise<OpenedDoc> {
    let entry = this.docs.get(id)
    if (!entry) {
      // Fermé il y a un instant : laisse le serveur finir avant de rouvrir.
      const since = Date.now() - (this.closedAt.get(id) ?? 0)
      if (since < 1500) await new Promise((r) => setTimeout(r, 1500 - since))
      entry = this.docs.get(id)
    }
    if (!entry) {
      const ydoc = new Y.Doc()
      const provider = new HocuspocusProvider({
        websocketProvider: this.socket,
        name: docRoom(id),
        document: ydoc,
        token: this.token
      })
      provider.setAwarenessField('user', this.user)
      const ready = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Le document n'a pas pu être chargé.")), 15000)
        provider.on('synced', () => {
          clearTimeout(timer)
          resolve()
        })
        provider.on('authenticationFailed', () => {
          clearTimeout(timer)
          reject(new Error('Accès refusé à ce document.'))
        })
        provider.attach()
      })
      const e = { ydoc, provider, refs: 0, ready, release: null }
      this.docs.set(id, e)
      entry = e
      ready.catch(() => {
        if (this.docs.get(id) === e) this.docs.delete(id)
        provider.destroy()
        ydoc.destroy()
      })
    }
    const current = entry
    current.refs++
    if (current.release) {
      clearTimeout(current.release)
      current.release = null
    }
    try {
      await current.ready
    } catch (err) {
      current.refs--
      throw err
    }
    let closed = false
    return {
      ydoc: current.ydoc,
      awareness: current.provider.awareness,
      provider: current.provider,
      close: () => {
        if (closed) return
        closed = true
        current.refs--
        if (current.refs > 0) return
        // Garde le document ouvert un moment : revenir sur la fiche ne le recharge pas.
        current.release = setTimeout(() => {
          if (current.refs > 0 || this.docs.get(id) !== current) return
          this.docs.delete(id)
          this.closedAt.set(id, Date.now())
          current.provider.destroy()
          current.ydoc.destroy()
        }, KEEP_OPEN_MS)
      }
    }
  }

  async exportDocs(ids: string[]): Promise<ExportedDoc[]> {
    const res = await this.request({ kind: 'export', requestId: newId(), ids })
    if (res.kind !== 'export-done' || !res.docs) throw new Error('Réponse inattendue du serveur.')
    return res.docs.map((d) => ({ meta: d.meta, content: fromBase64(d.content) }))
  }

  async importDocs(plan: CopyPlan) {
    await this.request({
      kind: 'import',
      requestId: newId(),
      types: plan.newTypes,
      docs: plan.docs.map((d) => ({ meta: d.meta, content: toBase64(d.content) }))
    })
  }

  async search(query: string, ids?: string[]): Promise<SearchHit[]> {
    const res = await this.request({ kind: 'search', requestId: newId(), query, ids })
    return res.kind === 'search-done' ? (res.hits ?? []) : []
  }

  async getImage(hash: string): Promise<Uint8Array | null> {
    const res = await this.request({ kind: 'image-get', requestId: newId(), hash })
    return res.kind === 'image-get-done' && res.data ? fromBase64(res.data) : null
  }

  async putImage(hash: string, data: Uint8Array): Promise<void> {
    await this.request({ kind: 'image-put', requestId: newId(), hash, data: toBase64(data) })
  }

  async missingImages(hashes: string[]): Promise<string[]> {
    if (!hashes.length) return []
    const res = await this.request({ kind: 'image-missing', requestId: newId(), hashes })
    return res.kind === 'image-missing-done' ? (res.hashes ?? []) : hashes
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    for (const p of this.pending.values()) p.reject(new Error('Déconnecté.'))
    this.pending.clear()
    for (const e of this.docs.values()) {
      if (e.release) clearTimeout(e.release)
      e.provider.destroy()
      e.ydoc.destroy()
    }
    this.docs.clear()
    this.tree.destroy()
    this.socket.destroy()
    this.treeDoc.destroy()
  }
}
