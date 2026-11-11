// Modèle de données Kotari, partagé par le client (main + rendu) et le serveur.

export const FORMAT_VERSION = 1

export type FieldKind =
  | 'text'
  | 'number'
  | 'ability'
  | 'gauge'
  | 'checkbox'
  | 'select'
  | 'richtext'
  | 'image'
  | 'list'

export type Rounding = 'floor' | 'round' | 'ceil'

/** Modificateur d'une caractéristique : arrondi((valeur − base) / diviseur) + décalage. */
export interface AbilityConfig {
  base: number
  divisor: number
  rounding: Rounding
  offset: number
}

export const DEFAULT_ABILITY: AbilityConfig = { base: 10, divisor: 2, rounding: 'floor', offset: 0 }

export interface Field {
  id: string
  name: string
  kind: FieldKind
  /** kind === 'list' : champs de chaque élément (listes imbriquées autorisées). */
  subfields?: Field[]
  /** kind === 'select' : choix proposés. */
  options?: string[]
  /** kind === 'ability'. */
  ability?: AbilityConfig
}

/** Compatibilité : un sous-champ est un champ comme un autre. */
export type SubField = Field
export type SubFieldKind = FieldKind

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
  ability: 'Caractéristique (+x)',
  gauge: 'Jauge (actuel / max)',
  checkbox: 'Case à cocher',
  select: 'Choix dans une liste',
  richtext: 'Texte riche',
  image: 'Image',
  list: 'Liste'
}

export const FIELD_KINDS: FieldKind[] = ['text', 'number', 'ability', 'gauge', 'checkbox', 'select', 'richtext', 'image', 'list']

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

export function abilityModifier(value: number, cfg: AbilityConfig = DEFAULT_ABILITY): number {
  const div = cfg.divisor || 1
  const raw = (value - cfg.base) / div
  const r = cfg.rounding === 'round' ? Math.round(raw) : cfg.rounding === 'ceil' ? Math.ceil(raw) : Math.floor(raw)
  return r + (cfg.offset || 0)
}

export function formatModifier(m: number): string {
  return m >= 0 ? `+${m}` : `${m}`
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

function shape(fields: Field[]): unknown {
  return fields.map((f) => ({ id: f.id, kind: f.kind, sub: f.kind === 'list' ? shape(f.subfields ?? []) : undefined }))
}

/** Compare deux définitions de type (structure des champs, hors noms et réglages d'affichage). */
export function sameFields(a: TypeDef, b: TypeDef): boolean {
  return JSON.stringify(shape(a.fields)) === JSON.stringify(shape(b.fields))
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

function isField(f: Field, depth: number): boolean {
  if (!f || !isSafeId(f.id) || typeof f.name !== 'string' || !FIELD_KINDS.includes(f.kind)) return false
  if (f.kind === 'list') {
    if (depth > 20 || !Array.isArray(f.subfields)) return false
    if (!f.subfields.every((s) => isField(s, depth + 1))) return false
  }
  if (f.options !== undefined && !(Array.isArray(f.options) && f.options.every((o) => typeof o === 'string'))) return false
  if (f.ability !== undefined) {
    const a = f.ability
    if (typeof a !== 'object' || ![a.base, a.divisor, a.offset].every((n) => typeof n === 'number' && Number.isFinite(n))) return false
    if (!['floor', 'round', 'ceil'].includes(a.rounding)) return false
  }
  return true
}

export function isTypeDef(v: unknown): v is TypeDef {
  const t = v as TypeDef
  if (!t || !isSafeId(t.id) || typeof t.name !== 'string' || typeof t.order !== 'number') return false
  return Array.isArray(t.fields) && t.fields.every((f) => isField(f, 0))
}

export function pickMeta(d: DocMeta): DocMeta {
  return { id: d.id, title: d.title, typeId: d.typeId, parentId: d.parentId, order: d.order }
}
