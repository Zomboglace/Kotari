import { useEffect, useMemo, useRef, useState } from 'react'
import type * as Y from 'yjs'
import { fieldsOf } from '@shared/content'
import type { DocMeta, TypeDef } from '@shared/model'
import { childrenOf, newId } from '@shared/model'
import { layoutOf, readLayout, resolveRows, writeLayout, type LayoutRow } from '@shared/layout'
import { focusKey, registerFocus } from '../lib/focus'
import type { Library } from '../lib/library'
import type { ServerLibrary } from '../lib/serverLibrary'
import { useOpenedDoc } from '../lib/useDoc'
import { FieldsForm, selectInInput } from './Fields'

interface Props {
  lib: Library
  parentDoc: Y.Doc
  parentId: string
  docs: DocMeta[]
  types: TypeDef[]
  onOpen: (id: string) => void
  onDelete: (id: string) => void
}

type DropTarget = { row: number; index: number } | { newRow: number } | null

const CARD_MIME = 'application/x-kotari-card'

/** Sous-fiches affichées en cartes éditables, rangées en lignes (disposition partagée). */
export function SubGrid({ lib, parentDoc, parentId, docs, types, onOpen, onDelete }: Props) {
  const children = useMemo(() => childrenOf(docs, parentId), [docs, parentId])
  const [stored, setStored] = useState<LayoutRow[]>(() => readLayout(parentDoc))
  const [dragId, setDragId] = useState<string | null>(null)
  const [target, setTarget] = useState<DropTarget>(null)
  const [liveHeight, setLiveHeight] = useState<{ row: number; h: number } | null>(null)

  useEffect(() => {
    const arr = layoutOf(parentDoc)
    const h = () => setStored(readLayout(parentDoc))
    h()
    arr.observeDeep(h)
    return () => arr.unobserveDeep(h)
  }, [parentDoc])

  const rows = useMemo(() => resolveRows(stored, children.map((c) => c.id)), [stored, children])
  const byId = useMemo(() => new Map(children.map((c) => [c.id, c])), [children])

  const commit = (next: LayoutRow[]) => writeLayout(parentDoc, next.filter((r) => r.items.length))
  const clone = () => rows.map((r) => ({ ...r, items: [...r.items] }))

  const drop = () => {
    const id = dragId
    const t = target
    setDragId(null)
    setTarget(null)
    if (!id || !t) return
    const next = clone()
    // Position d'origine, pour corriger l'index si on reste dans la même ligne.
    let fromRow = -1
    let fromIdx = -1
    next.forEach((r, ri) => {
      const i = r.items.indexOf(id)
      if (i !== -1) {
        fromRow = ri
        fromIdx = i
      }
    })
    if (fromRow === -1) return
    if ('newRow' in t) {
      next[fromRow].items.splice(fromIdx, 1)
      next.splice(t.newRow, 0, { id: `new-${id}`, items: [id], h: next[fromRow].h })
      commit(next.map((r) => (r.id.startsWith('new-') ? { ...r, id: newId() } : r)))
      return
    }
    let index = t.index
    if (t.row === fromRow && fromIdx < index) index--
    next[fromRow].items.splice(fromIdx, 1)
    next[t.row].items.splice(index, 0, id)
    commit(next)
  }

  /** − : la dernière carte passe sur une nouvelle ligne en dessous. + : prend la première de la ligne suivante. */
  const changeCount = (ri: number, delta: 1 | -1) => {
    const next = clone()
    const row = next[ri]
    if (delta === -1) {
      if (row.items.length < 2) return
      const last = row.items.pop()!
      next.splice(ri + 1, 0, { id: newId(), items: [last], h: row.h })
    } else {
      const below = next[ri + 1]
      if (!below) return
      row.items.push(below.items.shift()!)
    }
    commit(next)
  }

  const startResize = (ri: number, e: React.PointerEvent, start: number) => {
    e.preventDefault()
    const y0 = e.clientY
    const move = (ev: PointerEvent) => setLiveHeight({ row: ri, h: Math.max(80, Math.round(start + ev.clientY - y0)) })
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setLiveHeight(null)
      const next = clone()
      next[ri].h = Math.max(80, Math.round(start + ev.clientY - y0))
      commit(next)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const setAuto = (ri: number) => {
    const next = clone()
    next[ri].h = 0
    commit(next)
  }

  if (!children.length) return null

  // Toujours présentes (pas de décalage de la mise en page au début du glisser).
  const newRowZone = (at: number) => (
    <div
      className={`row-drop ${dragId ? 'show' : ''} ${target && 'newRow' in target && target.newRow === at ? 'active' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(CARD_MIME)) return
        e.preventDefault()
        setTarget({ newRow: at })
      }}
      onDrop={(e) => {
        e.preventDefault()
        drop()
      }}
    >
      {dragId && <span>Nouvelle ligne</span>}
    </div>
  )

  return (
    <div className="subgrid">
      {newRowZone(0)}
      {rows.map((row, ri) => {
        const h = liveHeight?.row === ri ? liveHeight.h : row.h
        return (
          <div key={row.id} className="subrow-wrap">
            <div className="subrow" style={{ gridTemplateColumns: `repeat(${row.items.length}, minmax(0, 1fr))` }}>
              {row.items.map((id, ci) => {
                const meta = byId.get(id)!
                const isTarget = target && 'row' in target && target.row === ri
                return (
                  <div
                    key={id}
                    className={[
                      'card-slot',
                      dragId === id ? 'dragging' : '',
                      isTarget && target.index === ci ? 'drop-before' : '',
                      isTarget && target.index === ci + 1 && ci === row.items.length - 1 ? 'drop-after' : ''
                    ].join(' ')}
                    onDragOver={(e) => {
                      if (!e.dataTransfer.types.includes(CARD_MIME)) return
                      e.preventDefault()
                      const r = e.currentTarget.getBoundingClientRect()
                      const index = e.clientX < r.left + r.width / 2 ? ci : ci + 1
                      setTarget({ row: ri, index })
                    }}
                    onDrop={(e) => {
                      if (!e.dataTransfer.types.includes(CARD_MIME)) return
                      e.preventDefault()
                      drop()
                    }}
                  >
                    <ChildCard
                      lib={lib}
                      meta={meta}
                      type={types.find((t) => t.id === meta.typeId)}
                      docs={docs}
                      types={types}
                      height={h}
                      onOpen={onOpen}
                      onDelete={onDelete}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(CARD_MIME, id)
                        e.dataTransfer.effectAllowed = 'move'
                        setDragId(id)
                      }}
                      onDragEnd={() => {
                        setDragId(null)
                        setTarget(null)
                      }}
                    />
                  </div>
                )
              })}
            </div>
            <div className="row-tools">
              <span className="muted small">
                {row.items.length} par ligne
              </span>
              <button className="icon-btn" title="Une carte de moins sur cette ligne" disabled={row.items.length < 2} onClick={() => changeCount(ri, -1)}>
                −
              </button>
              <button className="icon-btn" title="Une carte de plus (prise sur la ligne suivante)" disabled={!rows[ri + 1]} onClick={() => changeCount(ri, 1)}>
                +
              </button>
              <span className="tool-sep" />
              <span className="muted small">Hauteur : {h ? `${h} px` : 'auto'}</span>
              {h > 0 && (
                <button className="btn tiny ghost" onClick={() => setAuto(ri)}>
                  Auto
                </button>
              )}
            </div>
            <div
              className="row-resize"
              title="Tirer pour régler la hauteur des cartes · double-clic : auto"
              onPointerDown={(e) => {
                const card = e.currentTarget.parentElement?.querySelector('.card-body') as HTMLElement | null
                startResize(ri, e, h || card?.getBoundingClientRect().height || 240)
              }}
              onDoubleClick={() => setAuto(ri)}
            />
            {newRowZone(ri + 1)}
          </div>
        )
      })}
    </div>
  )
}

function ChildCard({
  lib,
  meta,
  type,
  docs,
  types,
  height,
  onOpen,
  onDelete,
  onDragStart,
  onDragEnd
}: {
  lib: Library
  meta: DocMeta
  type: TypeDef | undefined
  docs: DocMeta[]
  types: TypeDef[]
  height: number
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
}) {
  const { opened, error } = useOpenedDoc(lib, meta.id, true, type)
  const user = lib.kind === 'server' ? (lib as ServerLibrary).user : null
  const grandChildren = childrenOf(docs, meta.id)
  const titleRef = useRef<HTMLInputElement>(null)
  useEffect(() => registerFocus(focusKey(meta.id, '__title'), (q, n) => selectInInput(titleRef.current, q, n)), [meta.id])

  return (
    <div className="card-child">
      <div className="card-head">
        <span className="card-grip" draggable onDragStart={onDragStart} onDragEnd={onDragEnd} title="Glisser pour déplacer la carte">
          ⠿
        </span>
        <input
          ref={titleRef}
          className="card-title"
          value={meta.title}
          placeholder="Sans titre"
          onChange={(e) => lib.updateMeta(meta.id, { title: e.target.value })}
        />
        <span className="type-pill small">{type?.name ?? '?'}</span>
        <button className="icon-btn" title="Ouvrir la fiche" onClick={() => onOpen(meta.id)}>
          ↗
        </button>
        <button className="icon-btn danger" title="Supprimer" onClick={() => onDelete(meta.id)}>
          ×
        </button>
      </div>
      <div className="card-body" style={height ? { height, overflow: 'auto' } : undefined}>
        {error && <div className="alert">{error}</div>}
        {!type && <div className="muted small">Type introuvable.</div>}
        {opened && type && (
          <FieldsForm
            key={opened.ydoc.guid}
            fieldsMap={fieldsOf(opened.ydoc)}
            fields={type.fields}
            ctx={{ lib, docId: meta.id, provider: opened.provider, user }}
          />
        )}
        {!opened && !error && <div className="muted small">Chargement…</div>}
        {grandChildren.length > 0 && (
          <div className="card-children">
            {grandChildren.map((g) => (
              <button key={g.id} className="chip" onClick={() => onOpen(g.id)}>
                {g.title || 'Sans titre'}
                <span className="muted"> · {types.find((t) => t.id === g.typeId)?.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
