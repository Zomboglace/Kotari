import { useEffect, useMemo, useState } from 'react'
import { ensureFields, fieldsOf } from '@shared/content'
import { childrenOf } from '@shared/model'
import { ABILITY_FIELD_IDS } from '@shared/templates'
import type { Library, OpenedDoc } from '../lib/library'
import { useLibraryState } from '../lib/library'
import type { ServerLibrary } from '../lib/serverLibrary'
import { FieldsForm } from './Fields'

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
  const [opened, setOpened] = useState<OpenedDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const exists = !!meta

  useEffect(() => {
    if (!exists) return
    let alive = true
    let od: OpenedDoc | null = null
    setError(null)
    lib
      .openDoc(id)
      .then((o) => {
        if (!alive) return o.close()
        od = o
        setOpened(o)
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
      od?.close()
      setOpened(null)
    }
  }, [lib, id, exists])

  // Champs ajoutés au type après la création de la fiche.
  useEffect(() => {
    if (opened && type) ensureFields(opened.ydoc, type)
  }, [opened, type])

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

  if (!meta) {
    return (
      <div className="fiche empty-state">
        <h2>Cette fiche n'existe plus</h2>
        <p className="muted">Elle a été supprimée{lib.kind === 'server' ? ' par une autre personne' : ''}.</p>
      </div>
    )
  }

  const user = lib.kind === 'server' ? (lib as ServerLibrary).user : null
  const isCharacter = meta.typeId === 'modele-personnage'

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
            className="title-input"
            value={meta.title}
            placeholder="Sans titre"
            onChange={(e) => lib.updateMeta(id, { title: e.target.value })}
          />
          <span className="type-pill">{type?.name ?? 'Type inconnu'}</span>
          <button className="btn ghost small danger" onClick={() => onDelete(id)}>
            Supprimer
          </button>
        </div>
      </div>

      <div className="fiche-body">
        {error && <div className="alert">{error}</div>}
        {!type && <div className="alert">Le type de cette fiche est introuvable dans cette bibliothèque.</div>}
        {opened && type && (
          <FieldsForm
            key={opened.ydoc.guid}
            fieldsMap={fieldsOf(opened.ydoc)}
            fields={type.fields}
            ctx={{
              provider: opened.provider,
              user,
              abilityIds: isCharacter ? ABILITY_FIELD_IDS : undefined
            }}
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
            <ul className="child-list">
              {children.map((c) => (
                <li key={c.id}>
                  <button className="child-link" onClick={() => onOpen(c.id)}>
                    <span>{c.title || 'Sans titre'}</span>
                    <span className="muted small">{types.find((t) => t.id === c.typeId)?.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
