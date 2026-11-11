// Messages « stateless » échangés avec kotari-server sur la room de l'arbre,
// en plus de la synchronisation Yjs gérée par Hocuspocus.

import type { DocMeta, TypeDef } from './model'

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

export type ServerMessage =
  | { kind: 'import-done'; requestId: string; error?: string }
  | { kind: 'export-done'; requestId: string; docs?: WireDoc[]; error?: string }

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
