// kotari-server : héberge un dossier de projet Kotari et synchronise les clients
// en temps réel (Hocuspocus / Yjs). Aucune interface : tout passe par la console.

import { Server, type Hocuspocus } from '@hocuspocus/server'
import * as Y from 'yjs'
import { ProjectStore } from '../shared/fsproject'
import type { DocMeta, TypeDef } from '../shared/model'
import { isDocMeta, isSafeId, isTypeDef, pickMeta } from '../shared/model'
import type { AuthToken, ClientMessage, ServerMessage, WireDoc } from '../shared/protocol'
import { TREE_ROOM, docRoom, fromBase64, roomDocId, toBase64 } from '../shared/protocol'
import { verifyPassword } from './password'
import { isImageHash } from '../shared/images'
import { searchDocs, type SearchHit } from '../shared/search'

export interface ServerOptions {
  dir: string
  port: number
  passwordHash: string
  host?: string
  log?: (msg: string) => void
  quiet?: boolean
}

interface Ctx {
  name: string
}

// Une image de 15 Mo fait ~20 Mo en base64.
const MAX_PAYLOAD = 24 * 1024 * 1024

export function timestamp(): string {
  return new Date().toLocaleTimeString('fr-FR')
}

export async function startServer(opts: ServerOptions) {
  const store = new ProjectStore(opts.dir)
  await store.readInfo()
  await store.ensureDirs()
  const log = opts.log ?? ((m: string) => console.log(`[${timestamp()}] ${m}`))

  // Ce qui est sur disque, pour n'écrire que les changements de l'arbre.
  const written = { docs: new Map<string, string>(), types: new Map<string, string>() }
  let failedLogins = 0
  let instance!: Hocuspocus<Ctx>

  async function loadTree(doc: Y.Doc) {
    const [docs, types] = await Promise.all([store.listDocs(), store.listTypes()])
    doc.transact(() => {
      const dm = doc.getMap<DocMeta>('docs')
      const tm = doc.getMap<TypeDef>('types')
      for (const d of docs) dm.set(d.id, d)
      for (const t of types) tm.set(t.id, t)
    }, 'load')
    for (const d of docs) written.docs.set(d.id, JSON.stringify(d))
    for (const t of types) written.types.set(t.id, JSON.stringify(t))
    log(`Projet chargé : ${docs.length} document(s), ${types.length} type(s).`)
  }

  function treeDoc(): Y.Doc | undefined {
    return instance.documents.get(TREE_ROOM)
  }

  function treeHas(id: string): boolean {
    const doc = treeDoc()
    return !!doc && doc.getMap('docs').has(id)
  }

  /** Écrit sur disque les métas et types modifiés, supprime ce qui a disparu. */
  async function syncTreeToDisk(doc: Y.Doc) {
    const dm = doc.getMap<DocMeta>('docs')
    const tm = doc.getMap<TypeDef>('types')

    for (const [id, value] of dm.entries()) {
      if (!isDocMeta(value) || value.id !== id) continue
      const json = JSON.stringify(pickMeta(value))
      if (written.docs.get(id) === json) continue
      await store.writeMeta(value)
      written.docs.set(id, json)
    }
    for (const id of [...written.docs.keys()]) {
      if (dm.has(id)) continue
      await store.deleteDoc(id)
      written.docs.delete(id)
      instance.closeConnections(docRoom(id))
      log(`Document supprimé : ${id}`)
    }

    for (const [id, value] of tm.entries()) {
      if (!isTypeDef(value) || value.id !== id) continue
      const json = JSON.stringify(value)
      if (written.types.get(id) === json) continue
      await store.writeType(value)
      written.types.set(id, json)
    }
    for (const id of [...written.types.keys()]) {
      if (tm.has(id)) continue
      await store.deleteType(id)
      written.types.delete(id)
    }
  }

  async function contentOf(id: string): Promise<Uint8Array> {
    const loaded = instance.documents.get(docRoom(id))
    if (loaded) return Y.encodeStateAsUpdate(loaded)
    return (await store.readContent(id)) ?? new Uint8Array()
  }

  async function handleImport(msg: Extract<ClientMessage, { kind: 'import' }>, who: string) {
    const doc = treeDoc()
    if (!doc) throw new Error('Arbre non chargé.')
    const dm = doc.getMap<DocMeta>('docs')
    const tm = doc.getMap<TypeDef>('types')
    if (!Array.isArray(msg.docs) || !Array.isArray(msg.types)) throw new Error('Message invalide.')

    const batchIds = new Set<string>()
    const decoded: { meta: DocMeta; content: Uint8Array }[] = []
    for (const d of msg.docs as WireDoc[]) {
      if (!isDocMeta(d?.meta) || typeof d.content !== 'string') throw new Error('Document invalide.')
      if (dm.has(d.meta.id) || batchIds.has(d.meta.id)) throw new Error('Identifiant déjà utilisé.')
      batchIds.add(d.meta.id)
      const content = fromBase64(d.content)
      // Vérifie que le contenu est bien un état Yjs.
      const probe = new Y.Doc()
      Y.applyUpdate(probe, content)
      probe.destroy()
      decoded.push({ meta: pickMeta(d.meta), content })
    }
    for (const { meta } of decoded) {
      if (meta.parentId !== null && !dm.has(meta.parentId) && !batchIds.has(meta.parentId)) {
        throw new Error('Parent introuvable sur le serveur.')
      }
    }
    for (const t of msg.types) if (!isTypeDef(t)) throw new Error('Type invalide.')

    // Contenu d'abord, puis l'arbre : personne n'ouvre un document sans contenu.
    for (const { meta, content } of decoded) await store.writeContent(meta.id, content)
    doc.transact(() => {
      for (const t of msg.types) if (!tm.has(t.id)) tm.set(t.id, t)
      for (const { meta } of decoded) dm.set(meta.id, meta)
    }, 'import')
    if (decoded.length) {
      const what = decoded.length === 1 ? `« ${decoded[0].meta.title} »` : `${decoded.length} documents`
      log(`${who} a ajouté ${what}.`)
    }
  }

  async function handleExport(msg: Extract<ClientMessage, { kind: 'export' }>): Promise<WireDoc[]> {
    const doc = treeDoc()
    if (!doc || !Array.isArray(msg.ids)) throw new Error('Message invalide.')
    const dm = doc.getMap<DocMeta>('docs')
    const out: WireDoc[] = []
    for (const id of msg.ids) {
      if (!isSafeId(id)) continue
      const meta = dm.get(id)
      if (!isDocMeta(meta)) continue
      out.push({ meta: pickMeta(meta), content: toBase64(await contentOf(id)) })
    }
    return out
  }

  async function handleSearch(msg: Extract<ClientMessage, { kind: 'search' }>): Promise<SearchHit[]> {
    const doc = treeDoc()
    if (!doc || typeof msg.query !== 'string' || !msg.query.trim()) return []
    const dm = doc.getMap<DocMeta>('docs')
    const types = [...doc.getMap<TypeDef>('types').values()].filter(isTypeDef)
    let docs = [...dm.values()].filter(isDocMeta).map(pickMeta)
    if (Array.isArray(msg.ids)) {
      const want = new Set(msg.ids)
      docs = docs.filter((d) => want.has(d.id))
    }
    return searchDocs(docs, types, contentOf, msg.query.slice(0, 200))
  }

  const server = new Server<Ctx>({
    port: opts.port,
    address: opts.host ?? '0.0.0.0',
    quiet: true,
    debounce: 1000,
    maxDebounce: 5000,
    stopOnSignals: false,
    websocketOptions: { maxPayload: MAX_PAYLOAD },

    async onAuthenticate({ token, documentName }) {
      let auth: Partial<AuthToken> = {}
      try {
        auth = JSON.parse(token)
      } catch {
        /* jeton illisible */
      }
      const ok = typeof auth.password === 'string' && (await verifyPassword(auth.password, opts.passwordHash))
      if (!ok) {
        // Ralentit les essais de mot de passe à répétition.
        failedLogins++
        await new Promise((r) => setTimeout(r, Math.min(5000, 500 * failedLogins)))
        if (documentName === TREE_ROOM) log('Connexion refusée : mauvais mot de passe.')
        // Message vide : Hocuspocus n'affiche pas de pile d'erreur pour un refus normal.
        throw new Error('')
      }
      failedLogins = 0
      const name = typeof auth.name === 'string' && auth.name.trim() ? auth.name.trim().slice(0, 40) : 'Anonyme'
      return { name }
    },

    async onLoadDocument({ documentName, document }) {
      if (documentName === TREE_ROOM) {
        await loadTree(document)
        return document
      }
      const id = roomDocId(documentName)
      if (!id || !isSafeId(id) || !treeHas(id)) throw new Error('Document introuvable.')
      const data = await store.readContent(id)
      if (data) Y.applyUpdate(document, data, 'load')
      return document
    },

    async onStoreDocument({ documentName, document }) {
      if (documentName === TREE_ROOM) {
        await syncTreeToDisk(document)
        return
      }
      const id = roomDocId(documentName)
      // Un document supprimé de l'arbre ne doit pas réapparaître sur disque.
      if (!id || !treeHas(id)) return
      await store.writeContent(id, Y.encodeStateAsUpdate(document))
    },

    async onStateless({ documentName, payload, connection }) {
      if (documentName !== TREE_ROOM) return
      let msg: ClientMessage
      try {
        msg = JSON.parse(payload)
      } catch {
        return
      }
      const who = (connection.context as Ctx | undefined)?.name ?? 'Quelqu’un'
      let reply: ServerMessage
      const requestId = typeof msg?.requestId === 'string' ? msg.requestId : ''
      const doneKind = `${msg?.kind}-done` as ServerMessage['kind']
      try {
        if (msg.kind === 'import') {
          await handleImport(msg, who)
          reply = { kind: 'import-done', requestId }
        } else if (msg.kind === 'export') {
          reply = { kind: 'export-done', requestId, docs: await handleExport(msg) }
        } else if (msg.kind === 'search') {
          reply = { kind: 'search-done', requestId, hits: await handleSearch(msg) }
        } else if (msg.kind === 'image-put') {
          if (typeof msg.data !== 'string') throw new Error('Image invalide.')
          await store.writeImage(msg.hash, fromBase64(msg.data))
          reply = { kind: 'image-put-done', requestId }
        } else if (msg.kind === 'image-get') {
          const data = await store.readImage(msg.hash)
          reply = { kind: 'image-get-done', requestId, data: data ? toBase64(data) : null }
        } else if (msg.kind === 'image-missing') {
          const hashes = Array.isArray(msg.hashes) ? msg.hashes.slice(0, 2000) : []
          const missing: string[] = []
          for (const h of hashes) if (isImageHash(h) && !(await store.hasImage(h))) missing.push(h)
          reply = { kind: 'image-missing-done', requestId, hashes: missing }
        } else {
          return
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        reply = { kind: doneKind, requestId, error } as ServerMessage
      }
      connection.sendStateless(JSON.stringify(reply))
    },

    async connected({ documentName, context }) {
      if (documentName === TREE_ROOM) log(`${context.name} s'est connecté(e).`)
    },

    async onDisconnect({ documentName, context }) {
      if (documentName === TREE_ROOM && context?.name) log(`${context.name} s'est déconnecté(e).`)
    }
  })

  instance = server.hocuspocus
  await server.listen()
  // Garde l'arbre chargé en permanence (il sert à valider chaque document).
  const treeConn = await instance.openDirectConnection(TREE_ROOM, { name: '' })

  return {
    port: server.address.port,
    async stop() {
      instance.flushPendingStores()
      const doc = treeDoc()
      if (doc) await syncTreeToDisk(doc)
      for (const [name, d] of instance.documents) {
        const id = roomDocId(name)
        if (id && treeHas(id)) await store.writeContent(id, Y.encodeStateAsUpdate(d))
      }
      await treeConn.disconnect()
      await server.destroy()
    }
  }
}
