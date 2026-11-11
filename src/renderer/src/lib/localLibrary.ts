import * as Y from 'yjs'
import type { CopyPlan, ExportedDoc } from '@shared/copy'
import type { DocMeta, TypeDef } from '@shared/model'
import { pickMeta } from '@shared/model'
import type { ProjectSnapshot } from '../env'
import { Emitter, type Library, type LibraryState, type OpenedDoc } from './library'

const SAVE_DELAY = 500

interface OpenEntry {
  ydoc: Y.Doc
  refs: number
  timer: ReturnType<typeof setTimeout> | null
  dirty: boolean
  save: () => Promise<void>
}

/** Bibliothèque d'un dossier local, via l'API du preload. */
export class LocalLibrary implements Library {
  readonly kind = 'local' as const
  readonly label: string
  readonly path: string
  private state: LibraryState
  private emitter = new Emitter()
  private open = new Map<string, OpenEntry>()
  private metaTimers = new Map<string, ReturnType<typeof setTimeout>>()
  onError: (msg: string) => void = () => {}

  constructor(snap: ProjectSnapshot) {
    this.label = snap.name
    this.path = snap.path
    this.state = { docs: snap.docs, types: snap.types }
  }

  getState = () => this.state
  subscribe = (cb: () => void) => this.emitter.subscribe(cb)

  private set(next: Partial<LibraryState>) {
    this.state = { ...this.state, ...next }
    this.emitter.emit()
  }

  private report(err: unknown) {
    this.onError(err instanceof Error ? err.message : String(err))
  }

  async createDoc(meta: DocMeta, content: Uint8Array) {
    await window.kotari.writeContent(meta.id, content)
    await window.kotari.writeMeta(pickMeta(meta))
    this.set({ docs: [...this.state.docs, pickMeta(meta)] })
  }

  updateMeta(id: string, patch: Partial<Omit<DocMeta, 'id'>>) {
    const docs = this.state.docs.map((d) => (d.id === id ? { ...d, ...patch } : d))
    this.set({ docs })
    // Le titre change à chaque frappe : on regroupe les écritures.
    clearTimeout(this.metaTimers.get(id))
    this.metaTimers.set(
      id,
      setTimeout(() => {
        this.metaTimers.delete(id)
        const meta = this.state.docs.find((d) => d.id === id)
        if (meta) window.kotari.writeMeta(meta).catch((e) => this.report(e))
      }, 300)
    )
  }

  async deleteDocs(ids: string[]) {
    const set = new Set(ids)
    for (const id of ids) {
      const entry = this.open.get(id)
      if (entry) {
        if (entry.timer) clearTimeout(entry.timer)
        entry.dirty = false
      }
      clearTimeout(this.metaTimers.get(id))
      await window.kotari.deleteDoc(id)
    }
    this.set({ docs: this.state.docs.filter((d) => !set.has(d.id)) })
  }

  async saveType(t: TypeDef) {
    await window.kotari.writeType(t)
    const exists = this.state.types.some((x) => x.id === t.id)
    const types = exists ? this.state.types.map((x) => (x.id === t.id ? t : x)) : [...this.state.types, t]
    this.set({ types: types.sort((a, b) => a.order - b.order) })
  }

  async deleteType(id: string) {
    if (this.state.docs.some((d) => d.typeId === id)) throw new Error('Ce type est encore utilisé.')
    await window.kotari.deleteType(id)
    this.set({ types: this.state.types.filter((t) => t.id !== id) })
  }

  async openDoc(id: string): Promise<OpenedDoc> {
    let entry = this.open.get(id)
    if (!entry) {
      const ydoc = new Y.Doc()
      const data = await window.kotari.readContent(id)
      if (data) Y.applyUpdate(ydoc, data)
      const e: OpenEntry = {
        ydoc,
        refs: 0,
        timer: null,
        dirty: false,
        save: async () => {
          if (e.timer) clearTimeout(e.timer)
          e.timer = null
          if (!e.dirty) return
          e.dirty = false
          if (!this.state.docs.some((d) => d.id === id)) return // supprimé entre-temps
          try {
            await window.kotari.writeContent(id, Y.encodeStateAsUpdate(ydoc))
          } catch (err) {
            e.dirty = true
            this.report(err)
          }
        }
      }
      ydoc.on('update', () => {
        e.dirty = true
        if (e.timer) clearTimeout(e.timer)
        e.timer = setTimeout(() => void e.save(), SAVE_DELAY)
      })
      // Un autre appel a pu ouvrir le même document pendant la lecture.
      const again = this.open.get(id)
      if (again) {
        ydoc.destroy()
        entry = again
      } else {
        this.open.set(id, e)
        entry = e
      }
    }
    const current = entry
    current.refs++
    let closed = false
    return {
      ydoc: current.ydoc,
      awareness: null,
      provider: null,
      close: () => {
        if (closed) return
        closed = true
        current.refs--
        if (current.refs > 0) return
        void current.save().finally(() => {
          if (current.refs === 0 && this.open.get(id) === current) {
            this.open.delete(id)
            current.ydoc.destroy()
          }
        })
      }
    }
  }

  async exportDocs(ids: string[]): Promise<ExportedDoc[]> {
    const out: ExportedDoc[] = []
    for (const id of ids) {
      const meta = this.state.docs.find((d) => d.id === id)
      if (!meta) continue
      const entry = this.open.get(id)
      const content = entry ? Y.encodeStateAsUpdate(entry.ydoc) : await window.kotari.readContent(id)
      out.push({ meta, content: content ?? new Uint8Array() })
    }
    return out
  }

  async importDocs(plan: CopyPlan) {
    for (const t of plan.newTypes) await this.saveType(t)
    for (const d of plan.docs) {
      await window.kotari.writeContent(d.meta.id, d.content)
      await window.kotari.writeMeta(d.meta)
    }
    this.set({ docs: [...this.state.docs, ...plan.docs.map((d) => d.meta)] })
  }

  async search(query: string, ids?: string[]) {
    await this.flush()
    return window.kotari.search(query, ids)
  }

  getImage(hash: string) {
    return window.kotari.readImage(hash)
  }

  putImage(hash: string, data: Uint8Array) {
    return window.kotari.writeImage(hash, data)
  }

  missingImages(hashes: string[]) {
    return hashes.length ? window.kotari.missingImages(hashes) : Promise.resolve([])
  }

  /** Écrit tout ce qui est en attente (fermeture de la fenêtre, changement de projet). */
  async flush() {
    for (const [id, t] of this.metaTimers) {
      clearTimeout(t)
      const meta = this.state.docs.find((d) => d.id === id)
      if (meta) await window.kotari.writeMeta(meta).catch((e) => this.report(e))
    }
    this.metaTimers.clear()
    await Promise.all([...this.open.values()].map((e) => e.save()))
  }
}
