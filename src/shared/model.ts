// Modèle de données Kotari, partagé par le client (main + rendu) et le serveur.

export const FORMAT_VERSION = 1

export type FieldKind = 'text' | 'number' | 'richtext' | 'list'
export type SubFieldKind = Exclude<FieldKind, 'list'>

export interface SubField {
  id: string
  name: string
  kind: SubFieldKind
}

export interface Field {
  id: string
  name: string
  kind: FieldKind
  /** Uniquement pour kind === 'list'. */
  subfields?: SubField[]
}

export interface TypeDef {
  id: string
  name: string
  order: number
  fields: Field[]
}

export interface DocMeta {
  id: string
  title: string
  typeId: string
  parentId: string | null
  order: number
}

export interface ProjectInfo {
  name: string
  formatVersion: number
}

export const FIELD_KIND_LABELS: Record<FieldKind, string> = {
  text: 'Texte',
  number: 'Nombre',
  richtext: 'Texte riche',
  list: 'Liste'
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** Identifiant court, sûr pour un nom de fichier. */
export function newId(): string {
  const bytes = new Uint8Array(14)
  globalThis.crypto.getRandomValues(bytes)
  let s = ''
  for (const b of bytes) s += ID_ALPHABET[b % ID_ALPHABET.length]
  return s
}

const SAFE_ID = /^[a-zA-Z0-9_-]{1,64}$/

export function isSafeId(id: unknown): id is string {
  return typeof id === 'string' && SAFE_ID.test(id)
}

/** Enfants triés d'un parent. */
export function childrenOf(docs: DocMeta[], parentId: string | null): DocMeta[] {
  return docs
    .filter((d) => d.parentId === parentId)
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'fr'))
}

/** Le document et tous ses descendants, parents d'abord. */
export function subtree(docs: DocMeta[], rootId: string): DocMeta[] {
  const byParent = new Map<string | null, DocMeta[]>()
  for (const d of docs) {
    const list = byParent.get(d.parentId) ?? []
    list.push(d)
    byParent.set(d.parentId, list)
  }
  const root = docs.find((d) => d.id === rootId)
  if (!root) return []
  const out: DocMeta[] = []
  const queue = [root]
  while (queue.length) {
    const cur = queue.shift()!
    out.push(cur)
    queue.push(...(byParent.get(cur.id) ?? []))
  }
  return out
}

export function isDescendant(docs: DocMeta[], ancestorId: string, id: string | null): boolean {
  const byId = new Map(docs.map((d) => [d.id, d]))
  let cur = id
  const seen = new Set<string>()
  while (cur && !seen.has(cur)) {
    if (cur === ancestorId) return true
    seen.add(cur)
    cur = byId.get(cur)?.parentId ?? null
  }
  return false
}

/** Ordre à donner à un élément inséré à la position `index` parmi `siblings` (triés). */
export function orderAt(siblings: DocMeta[], index: number): number {
  const before = siblings[index - 1]?.order
  const after = siblings[index]?.order
  if (before === undefined && after === undefined) return 1
  if (before === undefined) return after! - 1
  if (after === undefined) return before + 1
  return (before + after) / 2
}

/** Compare deux définitions de type (hors nom d'affichage et ordre). */
export function sameFields(a: TypeDef, b: TypeDef): boolean {
  const norm = (t: TypeDef) =>
    JSON.stringify(
      t.fields.map((f) => ({
        id: f.id,
        kind: f.kind,
        subfields: (f.subfields ?? []).map((s) => ({ id: s.id, kind: s.kind }))
      }))
    )
  return norm(a) === norm(b)
}

/** Validation défensive des données lues sur disque ou reçues du réseau. */
export function isDocMeta(v: unknown): v is DocMeta {
  const d = v as DocMeta
  return (
    !!d &&
    isSafeId(d.id) &&
    typeof d.title === 'string' &&
    isSafeId(d.typeId) &&
    (d.parentId === null || isSafeId(d.parentId)) &&
    typeof d.order === 'number' &&
    Number.isFinite(d.order)
  )
}

const KINDS: FieldKind[] = ['text', 'number', 'richtext', 'list']

export function isTypeDef(v: unknown): v is TypeDef {
  const t = v as TypeDef
  if (!t || !isSafeId(t.id) || typeof t.name !== 'string' || typeof t.order !== 'number') return false
  if (!Array.isArray(t.fields)) return false
  return t.fields.every(
    (f) =>
      isSafeId(f.id) &&
      typeof f.name === 'string' &&
      KINDS.includes(f.kind) &&
      (f.kind !== 'list' ||
        (Array.isArray(f.subfields) &&
          f.subfields.every((s) => isSafeId(s.id) && typeof s.name === 'string' && (s.kind as string) !== 'list' && KINDS.includes(s.kind))))
  )
}

export function pickMeta(d: DocMeta): DocMeta {
  return { id: d.id, title: d.title, typeId: d.typeId, parentId: d.parentId, order: d.order }
}
