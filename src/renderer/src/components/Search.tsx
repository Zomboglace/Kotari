import { useEffect, useRef, useState } from 'react'
import type * as Y from 'yjs'
import type { DocMeta, TypeDef } from '@shared/model'
import type { SearchHit } from '@shared/search'
import { collectTexts, hitsIn } from '@shared/search'
import { loadPref, savePref } from '../lib/hooks'
import type { Library, LibraryKind } from '../lib/library'
import { Modal } from './Modals'

function Snippet({ h }: { h: SearchHit }) {
  return (
    <span className="snippet">
      {h.before}
      <mark>{h.match}</mark>
      {h.after}
    </span>
  )
}

/** Barre Ctrl+F : la fiche ouverte, et en option ses sous-fiches. */
export function DocSearchBar({
  lib,
  meta,
  ydoc,
  type,
  descendantIds,
  onGo,
  onClose
}: {
  lib: Library
  meta: DocMeta
  ydoc: Y.Doc | null
  type: TypeDef | undefined
  descendantIds: string[]
  onGo: (hit: SearchHit, query: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [withSub, setWithSub] = useState(() => loadPref('kotari.search.sub', true))
  const [hits, setHits] = useState<SearchHit[]>([])
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => input.current?.focus(), [])
  useEffect(() => {
    const h = () => input.current?.select()
    window.addEventListener('kotari:focus-search', h)
    return () => window.removeEventListener('kotari:focus-search', h)
  }, [])

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setHits([])
      return
    }
    let alive = true
    const t = setTimeout(async () => {
      const own = ydoc ? hitsIn(meta, collectTexts(ydoc, type, meta.title), q) : []
      let sub: SearchHit[] = []
      if (withSub && descendantIds.length) {
        setBusy(true)
        try {
          sub = await lib.search(q, descendantIds)
        } catch {
          sub = []
        }
        if (alive) setBusy(false)
      }
      if (!alive) return
      setHits([...own, ...sub])
      setActive(0)
    }, 200)
    return () => {
      alive = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, withSub, meta.id, ydoc, descendantIds.join(',')])

  const visited = useRef(false)
  useEffect(() => {
    visited.current = false
  }, [hits])

  const go = (i: number) => {
    if (!hits.length) return
    visited.current = true
    const k = (i + hits.length) % hits.length
    setActive(k)
    onGo(hits[k], query)
  }

  return (
    <div className="docsearch">
      <div className="docsearch-row">
        <input
          ref={input}
          className="input"
          placeholder="Rechercher dans cette fiche…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              // Première Entrée : premier résultat ; ensuite, le suivant.
              go(e.shiftKey ? active - 1 : visited.current ? active + 1 : active)
            } else if (e.key === 'Escape') onClose()
          }}
        />
        <span className="muted small count">
          {busy ? '…' : query.trim() ? (hits.length ? `${active + 1} / ${hits.length}` : 'Aucun résultat') : ''}
        </span>
        <button className="icon-btn" title="Précédent (Maj+Entrée)" disabled={!hits.length} onClick={() => go(active - 1)}>
          ↑
        </button>
        <button className="icon-btn" title="Suivant" disabled={!hits.length} onClick={() => go(active + 1)}>
          ↓
        </button>
        <label className="check small">
          <input
            type="checkbox"
            checked={withSub}
            onChange={(e) => {
              setWithSub(e.target.checked)
              savePref('kotari.search.sub', e.target.checked)
            }}
          />
          Sous-fiches
        </label>
        <button className="icon-btn" title="Fermer (Échap)" onClick={onClose}>
          ×
        </button>
      </div>
      {hits.length > 0 && (
        <ul className="hits">
          {hits.map((h, i) => (
            <li key={`${h.docId}${h.path}${h.nth}`}>
              <button className={`hit ${i === active ? 'on' : ''}`} onClick={() => go(i)}>
                <span className="hit-where">
                  {h.docId !== meta.id && <strong>{h.title || 'Sans titre'} · </strong>}
                  {h.label}
                </span>
                <Snippet h={h} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Ctrl+Maj+F : tout le projet local et le serveur. */
export function GlobalSearch({
  libs,
  onPick,
  onClose
}: {
  libs: { kind: LibraryKind; lib: Library }[]
  onPick: (kind: LibraryKind, hit: SearchHit, query: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState(() => loadPref('kotari.search.last', ''))
  const [results, setResults] = useState<{ kind: LibraryKind; hits: SearchHit[]; error?: string }[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const q = query.trim()
    savePref('kotari.search.last', query)
    if (!q) {
      setResults([])
      return
    }
    let alive = true
    const t = setTimeout(async () => {
      setBusy(true)
      const out = await Promise.all(
        libs.map(async ({ kind, lib }) => {
          try {
            return { kind, hits: await lib.search(q) }
          } catch (e) {
            return { kind, hits: [], error: e instanceof Error ? e.message : String(e) }
          }
        })
      )
      if (!alive) return
      setResults(out)
      setBusy(false)
    }, 250)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [query, libs])

  const total = results.reduce((n, r) => n + r.hits.length, 0)

  return (
    <Modal title="Rechercher dans tout le projet" onClose={onClose} wide>
      <input
        className="input big"
        autoFocus
        placeholder="Titre ou contenu…"
        value={query}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="muted small search-status">
        {busy ? 'Recherche…' : query.trim() ? `${total} résultat${total > 1 ? 's' : ''}` : 'Cherche dans les titres, textes, textes riches, listes et choix.'}
      </div>
      <div className="global-results">
        {results.map((r) => (
          <section key={r.kind}>
            {libs.length > 1 && <h3>{r.kind === 'local' ? 'Local' : 'Serveur'}</h3>}
            {r.error && <div className="alert">{r.error}</div>}
            {!r.error && r.hits.length === 0 && query.trim() && <div className="muted small">Aucun résultat.</div>}
            <ul className="hits">
              {r.hits.map((h) => (
                <li key={`${h.docId}${h.path}${h.nth}`}>
                  <button className="hit" onClick={() => onPick(r.kind, h, query)}>
                    <span className="hit-where">
                      <strong>{h.title || 'Sans titre'}</strong> · {h.label}
                    </span>
                    <Snippet h={h} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  )
}
