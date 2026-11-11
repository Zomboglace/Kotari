import { useEffect, useMemo, useRef, useState } from 'react'
import { fieldsOf } from '@shared/content'
import { childrenOf, subtree } from '@shared/model'
import type { SearchHit } from '@shared/search'
import { focusKey, registerFocus, requestFocus } from '../lib/focus'
import type { Library } from '../lib/library'
import { useLibraryState } from '../lib/library'
import type { ServerLibrary } from '../lib/serverLibrary'
import { useOpenedDoc } from '../lib/useDoc'
import { FieldsForm, selectInInput } from './Fields'
import { DocSearchBar } from './Search'
import { SubGrid } from './SubGrid'

interface Props {
  lib: Library
  id: string
  onOpen: (id: string) => void
  onAddChild: (parentId: string) => void
  onDelete: (id: string) => void
}

export function Fiche({ lib, id, onOpen, onAddChild, onDelete }: Props) {
  const { docs, types } = useLibraryState(lib)
  const meta = docs.find((d) => d.id === id)
  const type = types.find((t) => t.id === meta?.typeId)
  const { opened, error } = useOpenedDoc(lib, id, !!meta, type)
  const [searching, setSearching] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => registerFocus(focusKey(id, '__title'), (q, n) => selectInInput(titleRef.current, q, n)), [id])

  // Ctrl+F : recherche dans la fiche.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setSearching(true)
        window.dispatchEvent(new Event('kotari:focus-search'))
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const ancestors = useMemo(() => {
    const out = []
    const byId = new Map(docs.map((d) => [d.id, d]))
    let cur = meta?.parentId ? byId.get(meta.parentId) : undefined
    while (cur && out.length < 50) {
      out.unshift(cur)
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
    return out
  }, [docs, meta?.parentId])

  const children = useMemo(() => childrenOf(docs, id), [docs, id])
  const descendantIds = useMemo(() => subtree(docs, id).slice(1).map((d) => d.id), [docs, id])

  if (!meta) {
    return (
      <div className="fiche empty-state">
        <h2>Cette fiche n'existe plus</h2>
        <p className="muted">Elle a été supprimée{lib.kind === 'server' ? ' par une autre personne' : ''}.</p>
      </div>
    )
  }

  const user = lib.kind === 'server' ? (lib as ServerLibrary).user : null

  const goToHit = (hit: SearchHit, query: string) => {
    const key = focusKey(hit.docId, hit.path)
    const shown = hit.docId === id || children.some((c) => c.id === hit.docId)
    if (!requestFocus(key, query, hit.nth) && !shown) onOpen(hit.docId)
  }

  return (
    <div className="fiche">
      <div className="fiche-head">
        <div className="crumbs">
          <span className={`lib-tag ${lib.kind}`}>{lib.kind === 'server' ? 'Serveur' : 'Local'}</span>
          {ancestors.map((a) => (
            <span key={a.id}>
              <button className="crumb" onClick={() => onOpen(a.id)}>
                {a.title || 'Sans titre'}
              </button>
              <span className="crumb-sep">›</span>
            </span>
          ))}
        </div>
        <div className="title-row">
          <input
            ref={titleRef}
            className="title-input"
            value={meta.title}
            placeholder="Sans titre"
            onChange={(e) => lib.updateMeta(id, { title: e.target.value })}
          />
          <span className="type-pill">{type?.name ?? 'Type inconnu'}</span>
          <button className="btn ghost small" title="Rechercher (Ctrl+F)" onClick={() => setSearching((s) => !s)}>
            Rechercher
          </button>
          <button className="btn ghost small danger" onClick={() => onDelete(id)}>
            Supprimer
          </button>
        </div>
        {searching && (
          <DocSearchBar
            lib={lib}
            meta={meta}
            ydoc={opened?.ydoc ?? null}
            type={type}
            descendantIds={descendantIds}
            onGo={goToHit}
            onClose={() => setSearching(false)}
          />
        )}
      </div>

      <div className="fiche-body">
        {error && <div className="alert">{error}</div>}
        {!type && <div className="alert">Le type de cette fiche est introuvable dans cette bibliothèque.</div>}
        {opened && type && (
          <FieldsForm
            key={opened.ydoc.guid}
            fieldsMap={fieldsOf(opened.ydoc)}
            fields={type.fields}
            ctx={{ lib, docId: id, provider: opened.provider, user }}
          />
        )}
        {!opened && !error && <div className="muted">Chargement…</div>}

        <section className="children">
          <div className="children-head">
            <h3>Sous-fiches</h3>
            <button className="btn ghost small" onClick={() => onAddChild(id)}>
              + Ajouter une sous-fiche
            </button>
          </div>
          {children.length === 0 ? (
            <div className="muted small">Aucune. Par exemple, un Inventaire sous un Personnage.</div>
          ) : (
            opened && (
              <SubGrid
                lib={lib}
                parentDoc={opened.ydoc}
                parentId={id}
                docs={docs}
                types={types}
                onOpen={onOpen}
                onDelete={onDelete}
              />
            )
          )}
        </section>
      </div>
    </div>
  )
}
