import { useEffect, useMemo, useState } from 'react'
import type { DocMeta } from '@shared/model'
import { childrenOf } from '@shared/model'
import type { Library, LibraryKind } from '../lib/library'
import { useLibraryState } from '../lib/library'

export type DropPos = 'before' | 'after' | 'inside' | 'end'

export interface DragSource {
  lib: LibraryKind
  id: string
}

// Un seul glisser à la fois dans l'app : état partagé entre les deux arbres.
let currentDrag: DragSource | null = null
const dragListeners = new Set<(d: DragSource | null) => void>()
/** Fiche en cours de glisser depuis un arbre (pour la déposer dans un panneau). */
export function getTreeDrag(): DragSource | null {
  return currentDrag
}
export function endTreeDrag() {
  setDrag(null)
}
function setDrag(d: DragSource | null) {
  currentDrag = d
  for (const l of dragListeners) l(d)
}
function useDrag() {
  const [d, setD] = useState(currentDrag)
  useEffect(() => {
    dragListeners.add(setD)
    return () => void dragListeners.delete(setD)
  }, [])
  return d
}

interface Props {
  lib: Library
  selectedId: string | null
  filter: string
  onSelect: (id: string) => void
  onAdd: (parentId: string | null) => void
  onDelete: (id: string) => void
  onDrop: (src: DragSource, refId: string | null, pos: DropPos) => void
}

export function Tree({ lib, selectedId, filter, onSelect, onAdd, onDelete, onDrop }: Props) {
  const { docs, types } = useLibraryState(lib)
  const drag = useDrag()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [hint, setHint] = useState<{ id: string | null; pos: DropPos } | null>(null)

  const typeName = useMemo(() => new Map(types.map((t) => [t.id, t.name])), [types])

  // Ouvre les ancêtres de la fiche sélectionnée.
  useEffect(() => {
    if (!selectedId) return
    const byId = new Map(docs.map((d) => [d.id, d]))
    let cur = byId.get(selectedId)?.parentId
    const add: string[] = []
    while (cur && add.length < 50) {
      add.push(cur)
      cur = byId.get(cur)?.parentId ?? null
    }
    if (add.some((a) => !expanded.has(a))) setExpanded((s) => new Set([...s, ...add]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, docs])

  // Filtre sur le titre : les correspondances et leurs ancêtres.
  const visible = useMemo(() => {
    const q = filter.trim().toLocaleLowerCase('fr')
    if (!q) return null
    const byId = new Map(docs.map((d) => [d.id, d]))
    const keep = new Set<string>()
    for (const d of docs) {
      if (!d.title.toLocaleLowerCase('fr').includes(q)) continue
      let cur: DocMeta | undefined = d
      while (cur && !keep.has(cur.id)) {
        keep.add(cur.id)
        cur = cur.parentId ? byId.get(cur.parentId) : undefined
      }
    }
    return keep
  }, [docs, filter])

  const sameLib = drag?.lib === lib.kind
  const crossLib = !!drag && !sameLib

  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const handleDrop = (e: React.DragEvent, refId: string | null, pos: DropPos) => {
    e.preventDefault()
    e.stopPropagation()
    const src = currentDrag
    setHint(null)
    setDrag(null)
    if (!src) return
    if (src.lib === lib.kind && src.id === refId) return
    if (pos === 'inside' && refId) setExpanded((s) => new Set([...s, refId]))
    onDrop(src, refId, pos)
  }

  const renderNode = (d: DocMeta, depth: number): React.ReactNode => {
    if (visible && !visible.has(d.id)) return null
    const kids = childrenOf(docs, d.id)
    const open = visible ? true : expanded.has(d.id)
    const isHint = hint?.id === d.id
    return (
      <li key={d.id}>
        <div
          className={[
            'node',
            selectedId === d.id ? 'selected' : '',
            isHint ? `drop-${hint!.pos}` : '',
            drag?.lib === lib.kind && drag.id === d.id ? 'dragging' : ''
          ].join(' ')}
          style={{ paddingLeft: 6 + depth * 14 }}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', d.title)
            e.dataTransfer.effectAllowed = 'copyMove'
            setDrag({ lib: lib.kind, id: d.id })
          }}
          onDragEnd={() => {
            setDrag(null)
            setHint(null)
          }}
          onDragOver={(e) => {
            if (!currentDrag) return
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = currentDrag.lib === lib.kind ? 'move' : 'copy'
            const r = e.currentTarget.getBoundingClientRect()
            const y = (e.clientY - r.top) / r.height
            const pos: DropPos = y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside'
            if (hint?.id !== d.id || hint.pos !== pos) setHint({ id: d.id, pos })
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setHint((h) => (h?.id === d.id ? null : h))
          }}
          onDrop={(e) => handleDrop(e, d.id, hint?.id === d.id ? hint.pos : 'inside')}
          onClick={() => onSelect(d.id)}
        >
          <button
            className={`caret ${kids.length ? '' : 'invisible'}`}
            onClick={(e) => {
              e.stopPropagation()
              toggle(d.id)
            }}
            tabIndex={-1}
          >
            {open ? '▾' : '▸'}
          </button>
          <span className="node-title">{d.title || 'Sans titre'}</span>
          <span className="node-type">{typeName.get(d.typeId) ?? '?'}</span>
          <span className="node-actions">
            <button
              className="icon-btn"
              title="Ajouter une sous-fiche"
              onClick={(e) => {
                e.stopPropagation()
                onAdd(d.id)
              }}
            >
              +
            </button>
            <button
              className="icon-btn danger"
              title="Supprimer"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(d.id)
              }}
            >
              ×
            </button>
          </span>
        </div>
        {open && kids.length > 0 && <ul>{kids.map((k) => renderNode(k, depth + 1))}</ul>}
      </li>
    )
  }

  const roots = childrenOf(docs, null)

  return (
    <div
      className={`tree ${crossLib ? 'accept-copy' : ''}`}
      onDragOver={(e) => {
        if (!currentDrag) return
        e.preventDefault()
        e.dataTransfer.dropEffect = currentDrag.lib === lib.kind ? 'move' : 'copy'
        if (!(hint && hint.id === null)) setHint({ id: null, pos: 'end' })
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setHint(null)
      }}
      onDrop={(e) => handleDrop(e, null, 'end')}
    >
      {roots.length === 0 && !drag && <div className="tree-empty">Aucune fiche.</div>}
      <ul>{roots.map((d) => renderNode(d, 0))}</ul>
      {drag && (
        <div className={`drop-end ${hint?.id === null ? 'active' : ''}`}>
          {crossLib ? 'Déposer ici pour copier à la racine' : 'Déposer ici pour mettre à la racine'}
        </div>
      )}
      {visible && visible.size === 0 && <div className="tree-empty">Aucun résultat.</div>}
    </div>
  )
}
