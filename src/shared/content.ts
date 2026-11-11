// Structure du contenu Yjs d'un document.
//
//   doc.getMap('fields')   <fieldId> -> valeur, selon le genre :
//     text      Y.Text
//     number    number | null           ability : idem
//     checkbox  boolean
//     select    string | null
//     richtext  Y.XmlFragment (TipTap)
//     gauge     Y.Map { cur, max }
//     image     Y.Map { img: hash | null, w: largeur en % }
//     list      Y.Array<Y.Map>  (chaque élément : 'id' + un champ par clé, récursif)
//   doc.getArray('layout') disposition des sous-fiches (voir layout.ts)

import * as Y from 'yjs'
import type { Field, TypeDef } from './model'
import { newId } from './model'

export function fieldsOf(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('fields')
}

function emptyValue(f: Field): unknown {
  switch (f.kind) {
    case 'text':
      return new Y.Text()
    case 'richtext':
      return new Y.XmlFragment()
    case 'list':
      return new Y.Array<Y.Map<unknown>>()
    case 'gauge': {
      const m = new Y.Map<unknown>()
      m.set('cur', null)
      m.set('max', null)
      return m
    }
    case 'image': {
      const m = new Y.Map<unknown>()
      m.set('img', null)
      m.set('w', 60)
      return m
    }
    case 'checkbox':
      return false
    case 'number':
    case 'ability':
    case 'select':
      return null
  }
}

function hasRightShape(value: unknown, f: Field): boolean {
  switch (f.kind) {
    case 'text':
      return value instanceof Y.Text
    case 'richtext':
      return value instanceof Y.XmlFragment && !(value instanceof Y.XmlElement)
    case 'list':
      return value instanceof Y.Array
    case 'gauge':
      return value instanceof Y.Map && value.has('cur') && !value.has('img')
    case 'image':
      return value instanceof Y.Map && value.has('img')
    case 'checkbox':
      return typeof value === 'boolean'
    case 'number':
    case 'ability':
      return value === null || typeof value === 'number'
    case 'select':
      return value === null || typeof value === 'string'
  }
}

/** Texte brut d'un fragment de texte riche (un bloc par ligne). */
export function richPlain(frag: Y.XmlFragment | Y.XmlElement): string {
  const blocks: string[] = []
  const walk = (node: Y.XmlFragment | Y.XmlElement, out: string[]) => {
    let line = ''
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlText) {
        for (const op of child.toDelta() as { insert: unknown }[]) if (typeof op.insert === 'string') line += op.insert
      } else if (child instanceof Y.XmlElement) {
        const inner: string[] = []
        walk(child, inner)
        if (inner.length) {
          if (line) out.push(line)
          line = ''
          out.push(...inner)
        }
      }
    }
    if (line) out.push(line)
  }
  walk(frag, blocks)
  return blocks.join('\n')
}

/** Valeur « texte » d'une ancienne valeur, pour une conversion. */
function asText(value: unknown): string | null {
  if (value instanceof Y.Text) return value.toString()
  if (value instanceof Y.XmlFragment) return richPlain(value)
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non'
  if (value instanceof Y.Map && value.has('cur')) {
    const c = value.get('cur')
    const m = value.get('max')
    return c == null && m == null ? null : `${c ?? ''} / ${m ?? ''}`
  }
  return null
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (value instanceof Y.Map && value.has('cur')) {
    const c = value.get('cur')
    return typeof c === 'number' ? c : null
  }
  const t = asText(value)
  if (t === null) return null
  const n = Number(t.trim().replace(',', '.'))
  return t.trim() !== '' && Number.isFinite(n) ? n : null
}

/** Convertit au mieux une valeur existante vers le genre du champ (changement de genre). */
function convert(old: unknown, f: Field): unknown {
  const fresh = emptyValue(f)
  if (old === undefined) return fresh
  switch (f.kind) {
    case 'text': {
      const t = asText(old)
      if (t) (fresh as Y.Text).insert(0, t)
      return fresh
    }
    case 'richtext': {
      const t = asText(old)
      if (t) {
        const paras = t.split('\n').map((line) => {
          const p = new Y.XmlElement('paragraph')
          if (line) p.insert(0, [new Y.XmlText(line)])
          return p
        })
        ;(fresh as Y.XmlFragment).insert(0, paras)
      }
      return fresh
    }
    case 'number':
    case 'ability':
      return asNumber(old)
    case 'gauge':
      ;(fresh as Y.Map<unknown>).set('cur', asNumber(old))
      return fresh
    case 'checkbox': {
      if (typeof old === 'boolean') return old
      const t = asText(old)?.trim().toLowerCase()
      return !!t && !['', '0', 'non', 'faux', 'false', 'no'].includes(t)
    }
    case 'select': {
      const t = asText(old)?.trim()
      return t && (f.options ?? []).includes(t) ? t : null
    }
    case 'image':
    case 'list':
      return fresh
  }
}

function ensureIn(map: Y.Map<unknown>, fields: Field[]): void {
  for (const f of fields) {
    const cur = map.get(f.id)
    if (!map.has(f.id) || !hasRightShape(cur, f)) {
      map.set(f.id, convert(map.has(f.id) ? cur : undefined, f))
    }
    if (f.kind === 'list') {
      const arr = map.get(f.id) as Y.Array<Y.Map<unknown>>
      for (const item of arr.toArray()) if (item instanceof Y.Map) ensureIn(item, f.subfields ?? [])
    }
  }
}

/** Crée les valeurs manquantes et convertit celles dont le genre a changé. */
export function ensureFields(doc: Y.Doc, type: TypeDef): void {
  if (!needsEnsure(fieldsOf(doc), type.fields)) return
  doc.transact(() => ensureIn(fieldsOf(doc), type.fields), 'init')
}

function needsEnsure(map: Y.Map<unknown>, fields: Field[]): boolean {
  for (const f of fields) {
    const cur = map.get(f.id)
    if (!map.has(f.id) || !hasRightShape(cur, f)) return true
    if (f.kind === 'list') {
      for (const item of (cur as Y.Array<unknown>).toArray()) {
        if (item instanceof Y.Map && needsEnsure(item, f.subfields ?? [])) return true
      }
    }
  }
  return false
}

export function newListItem(subfields: Field[]): Y.Map<unknown> {
  const item = new Y.Map<unknown>()
  item.set('id', newId())
  for (const s of subfields) item.set(s.id, emptyValue(s))
  return item
}

/** Complète un élément de liste dont le type a changé. */
export function ensureListItem(item: Y.Map<unknown>, subfields: Field[]): void {
  if (!needsEnsure(item, subfields)) return
  const run = () => ensureIn(item, subfields)
  if (item.doc) item.doc.transact(run, 'init')
  else run()
}

/** État initial d'un nouveau document du type donné. */
export function initialContent(type: TypeDef): Uint8Array {
  const doc = new Y.Doc()
  ensureFields(doc, type)
  const update = Y.encodeStateAsUpdate(doc)
  doc.destroy()
  return update
}

export function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Empreintes des images référencées par un contenu. */
export function collectImages(content: Uint8Array): string[] {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, content)
  } catch {
    return []
  }
  const out = new Set<string>()
  const walk = (v: unknown, depth: number) => {
    if (depth > 40) return
    if (v instanceof Y.Map) {
      const img = v.get('img')
      if (typeof img === 'string') out.add(img)
      for (const x of v.values()) walk(x, depth + 1)
    } else if (v instanceof Y.Array) {
      for (const x of v.toArray()) walk(x, depth + 1)
    }
  }
  walk(fieldsOf(doc), 0)
  doc.destroy()
  return [...out]
}
