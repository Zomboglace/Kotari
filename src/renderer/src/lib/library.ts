import { useSyncExternalStore } from 'react'
import type * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'
import type { CopyPlan, ExportedDoc } from '@shared/copy'
import type { DocMeta, TypeDef } from '@shared/model'

export type LibraryKind = 'local' | 'server'

export interface LibraryState {
  docs: DocMeta[]
  types: TypeDef[]
}

/** Un document ouvert : son Y.Doc, et l'awareness (curseurs) s'il est partagé. */
export interface OpenedDoc {
  ydoc: Y.Doc
  awareness: Awareness | null
  /** Fournisseur Hocuspocus, pour les curseurs TipTap. */
  provider: unknown | null
  close(): void
}

/** Interface commune à la bibliothèque locale et à celle du serveur. */
export interface Library {
  readonly kind: LibraryKind
  readonly label: string
  getState(): LibraryState
  subscribe(cb: () => void): () => void
  createDoc(meta: DocMeta, content: Uint8Array): Promise<void>
  updateMeta(id: string, patch: Partial<Omit<DocMeta, 'id'>>): void
  deleteDocs(ids: string[]): Promise<void>
  saveType(t: TypeDef): Promise<void>
  deleteType(id: string): Promise<void>
  openDoc(id: string): Promise<OpenedDoc>
  /** Exporte les documents (contenu à jour, y compris ceux ouverts). */
  exportDocs(ids: string[]): Promise<ExportedDoc[]>
  importDocs(plan: CopyPlan): Promise<void>
}

export class Emitter {
  private listeners = new Set<() => void>()
  subscribe = (cb: () => void) => {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  emit() {
    for (const l of this.listeners) l()
  }
}

const EMPTY: LibraryState = { docs: [], types: [] }

export function useLibraryState(lib: Library | null): LibraryState {
  return useSyncExternalStore(
    (cb) => (lib ? lib.subscribe(cb) : () => {}),
    () => (lib ? lib.getState() : EMPTY)
  )
}
