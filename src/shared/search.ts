// Recherche plein texte dans le contenu des fiches (client et serveur).

import * as Y from 'yjs'
import type { DocMeta, Field, TypeDef } from './model'
import { fieldsOf, richPlain } from './content'

export interface TextEntry {
  /** Chemin du champ : "fieldId" ou "listeId/itemId/sousChampId"…, "__title" pour le titre. */
  path: string
  label: string
  text: string
}

export interface SearchHit {
  docId: string
  title: string
  path: string
  label: string
  /** Rang de l'occurrence dans ce champ (0 = première). */
  nth: number
  before: string
  match: string
  after: string
}

/** Minuscules sans accents, même longueur que l'original (positions conservées). */
export function fold(s: string): string {
  let out = ''
  for (const ch of s) {
    const f = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    out += f.length === ch.length ? f : ch.toLowerCase().length === ch.length ? ch.toLowerCase() : ch
  }
  return out
}

/** Positions des occurrences de `query` dans `text`. */
export function findAll(text: string, query: string): number[] {
  const q = fold(query.trim())
  if (!q) return []
  const t = fold(text)
  const out: number[] = []
  let i = t.indexOf(q)
  while (i !== -1 && out.length < 500) {
    out.push(i)
    i = t.indexOf(q, i + q.length)
  }
  return out
}

function walk(map: Y.Map<unknown>, fields: Field[], prefix: string, labelPrefix: string, out: TextEntry[], depth: number) {
  if (depth > 20) return
  for (const f of fields) {
    const v = map.get(f.id)
    const path = prefix ? `${prefix}/${f.id}` : f.id
    const label = labelPrefix ? `${labelPrefix} › ${f.name}` : f.name
    if (v instanceof Y.Text) out.push({ path, label, text: v.toString() })
    else if (v instanceof Y.XmlFragment) out.push({ path, label, text: richPlain(v) })
    else if (typeof v === 'string' && f.kind === 'select') out.push({ path, label, text: v })
    else if (v instanceof Y.Array && f.kind === 'list') {
      v.toArray().forEach((item, i) => {
        if (!(item instanceof Y.Map)) return
        const id = item.get('id')
        if (typeof id !== 'string') return
        walk(item, f.subfields ?? [], `${path}/${id}`, `${label} ${i + 1}`, out, depth + 1)
      })
    }
  }
}

/** Tous les textes d'un document, dans l'ordre d'affichage. */
export function collectTexts(doc: Y.Doc, type: TypeDef | undefined, title?: string): TextEntry[] {
  const out: TextEntry[] = []
  if (title !== undefined) out.push({ path: '__title', label: 'Titre', text: title })
  if (type) walk(fieldsOf(doc), type.fields, '', '', out, 0)
  return out
}

const CONTEXT = 36

export function hitsIn(meta: DocMeta, entries: TextEntry[], query: string, limit = 200): SearchHit[] {
  const qlen = query.trim().length
  const out: SearchHit[] = []
  for (const e of entries) {
    findAll(e.text, query).forEach((pos, nth) => {
      if (out.length >= limit) return
      const start = Math.max(0, pos - CONTEXT)
      const end = Math.min(e.text.length, pos + qlen + CONTEXT)
      out.push({
        docId: meta.id,
        title: meta.title,
        path: e.path,
        label: e.label,
        nth,
        before: (start > 0 ? '…' : '') + e.text.slice(start, pos).replace(/\s+/g, ' '),
        match: e.text.slice(pos, pos + qlen),
        after: e.text.slice(pos + qlen, end).replace(/\s+/g, ' ') + (end < e.text.length ? '…' : '')
      })
    })
  }
  return out
}

/** Recherche dans un ensemble de documents. */
export async function searchDocs(
  docs: DocMeta[],
  types: TypeDef[],
  getContent: (id: string) => Promise<Uint8Array | null>,
  query: string,
  limit = 300
): Promise<SearchHit[]> {
  const byType = new Map(types.map((t) => [t.id, t]))
  const out: SearchHit[] = []
  for (const meta of docs) {
    if (out.length >= limit) break
    const doc = new Y.Doc()
    try {
      const data = await getContent(meta.id)
      if (data) Y.applyUpdate(doc, data)
      out.push(...hitsIn(meta, collectTexts(doc, byType.get(meta.typeId), meta.title), query, limit - out.length))
    } catch {
      /* document illisible : ignoré */
    } finally {
      doc.destroy()
    }
  }
  return out
}
