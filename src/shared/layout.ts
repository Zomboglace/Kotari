// Disposition des sous-fiches dans leur fiche parente, enregistrée dans le Y.Doc du parent
// (donc partagée sur le serveur) : une liste de lignes, chacune avec ses cartes et sa hauteur.

import * as Y from 'yjs'
import { newId } from './model'

export interface LayoutRow {
  id: string
  items: string[]
  /** Hauteur des cartes en px, 0 = automatique. */
  h: number
}

export const DEFAULT_PER_ROW = 2

export function layoutOf(doc: Y.Doc): Y.Array<Y.Map<unknown>> {
  return doc.getArray('layout')
}

export function readLayout(doc: Y.Doc): LayoutRow[] {
  const out: LayoutRow[] = []
  for (const m of layoutOf(doc).toArray()) {
    if (!(m instanceof Y.Map)) continue
    const items = m.get('items')
    out.push({
      id: typeof m.get('id') === 'string' ? (m.get('id') as string) : newId(),
      items: Array.isArray(items) ? items.filter((x): x is string => typeof x === 'string') : [],
      h: typeof m.get('h') === 'number' ? (m.get('h') as number) : 0
    })
  }
  return out
}

/** Lignes à afficher : ignore les fiches disparues, ajoute les nouvelles à la fin. */
export function resolveRows(stored: LayoutRow[], childIds: string[]): LayoutRow[] {
  const exists = new Set(childIds)
  const seen = new Set<string>()
  const rows: LayoutRow[] = []
  for (const r of stored) {
    const items = r.items.filter((id) => exists.has(id) && !seen.has(id))
    items.forEach((id) => seen.add(id))
    if (items.length) rows.push({ ...r, items })
  }
  const rest = childIds.filter((id) => !seen.has(id))
  for (let i = 0; i < rest.length; i += DEFAULT_PER_ROW) {
    const items = rest.slice(i, i + DEFAULT_PER_ROW)
    rows.push({ id: `auto-${items[0]}`, items, h: 0 })
  }
  return rows
}

export function writeLayout(doc: Y.Doc, rows: LayoutRow[]): void {
  const arr = layoutOf(doc)
  doc.transact(() => {
    arr.delete(0, arr.length)
    arr.push(
      rows
        .filter((r) => r.items.length)
        .map((r) => {
          const m = new Y.Map<unknown>()
          m.set('id', r.id.startsWith('auto-') ? newId() : r.id)
          m.set('items', [...r.items])
          m.set('h', r.h)
          return m
        })
    )
  })
}
