// Structure du contenu Yjs d'un document.
//
//   doc.getMap('fields')
//     <fieldId> -> Y.Text          (texte)
//               -> number | null   (nombre)
//               -> Y.XmlFragment   (texte riche, branché sur TipTap)
//               -> Y.Array<Y.Map>  (liste ; chaque élément : 'id' + un sous-champ par clé)

import * as Y from 'yjs'
import type { Field, SubField, TypeDef } from './model'
import { newId } from './model'

export function fieldsOf(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('fields')
}

function emptyValue(kind: Field['kind']): unknown {
  switch (kind) {
    case 'text':
      return new Y.Text()
    case 'richtext':
      return new Y.XmlFragment()
    case 'list':
      return new Y.Array<Y.Map<unknown>>()
    case 'number':
      return null
  }
}

function hasRightShape(value: unknown, kind: Field['kind']): boolean {
  switch (kind) {
    case 'text':
      return value instanceof Y.Text
    case 'richtext':
      return value instanceof Y.XmlFragment
    case 'list':
      return value instanceof Y.Array
    case 'number':
      return value === null || typeof value === 'number'
  }
}

/** Crée les valeurs manquantes (champ ajouté au type après coup). */
export function ensureFields(doc: Y.Doc, type: TypeDef): void {
  const map = fieldsOf(doc)
  const missing = type.fields.filter((f) => !map.has(f.id) || !hasRightShape(map.get(f.id), f.kind))
  if (!missing.length) return
  doc.transact(() => {
    for (const f of missing) map.set(f.id, emptyValue(f.kind))
  }, 'init')
}

export function newListItem(subfields: SubField[]): Y.Map<unknown> {
  const item = new Y.Map<unknown>()
  item.set('id', newId())
  for (const s of subfields) item.set(s.id, emptyValue(s.kind))
  return item
}

/** Complète un élément de liste dont le type a gagné des sous-champs. */
export function ensureListItem(item: Y.Map<unknown>, subfields: SubField[]): void {
  const missing = subfields.filter((s) => !item.has(s.id) || !hasRightShape(item.get(s.id), s.kind))
  if (!missing.length) return
  item.doc?.transact(() => {
    for (const s of missing) item.set(s.id, emptyValue(s.kind))
  }, 'init')
}

/** État initial d'un nouveau document du type donné. */
export function initialContent(type: TypeDef): Uint8Array {
  const doc = new Y.Doc()
  ensureFields(doc, type)
  const update = Y.encodeStateAsUpdate(doc)
  doc.destroy()
  return update
}

/** Lit un nombre de champ (null si vide). */
export function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
