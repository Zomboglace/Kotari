// Messages « stateless » échangés avec kotari-server sur la room de l'arbre,
// en plus de la synchronisation Yjs gérée par Hocuspocus.

import type { DocMeta, TypeDef } from './model'
import type { SearchHit } from './search'

export const TREE_ROOM = '__tree'
export const docRoom = (id: string) => `doc:${id}`
export const roomDocId = (room: string) => (room.startsWith('doc:') ? room.slice(4) : null)

/** Contenu Yjs encodé en base64 pour voyager dans un message texte. */
export interface WireDoc {
  meta: DocMeta
  content: string
}

export type ClientMessage =
  | { kind: 'import'; requestId: string; docs: WireDoc[]; types: TypeDef[] }
  | { kind: 'export'; requestId: string; ids: string[] }
  | { kind: 'search'; requestId: string; query: string; ids?: string[] }
  | { kind: 'image-put'; requestId: string; hash: string; data: string }
  | { kind: 'image-get'; requestId: string; hash: string }
  | { kind: 'image-missing'; requestId: string; hashes: string[] }

export type ServerMessage = { requestId: string; error?: string } & (
  | { kind: 'import-done' }
  | { kind: 'export-done'; docs?: WireDoc[] }
  | { kind: 'search-done'; hits?: SearchHit[] }
  | { kind: 'image-put-done' }
  | { kind: 'image-get-done'; data?: string | null }
  | { kind: 'image-missing-done'; hashes?: string[] }
)

export interface AuthToken {
  password: string
  name: string
}

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(s)
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
