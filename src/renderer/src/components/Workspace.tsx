import { useRef, useState } from 'react'
import type { LibraryKind } from '../lib/library'
import type { PaneNode, Side, SplitNode, View, WsNode } from '../lib/workspace'
import { getCardDrag } from './SubGrid'
import { endTreeDrag, getTreeDrag } from './Tree'

export type Zone = Side | 'center'

export interface TabLabel {
  title: string
  lib: LibraryKind
  missing?: boolean
}

export interface WorkspaceProps {
  root: WsNode
  focused: string
  onFocus: (paneId: string) => void
  renderView: (view: View, paneId: string, active: boolean) => React.ReactNode
  renderHome: (paneId: string) => React.ReactNode
  tabLabel: (view: View) => TabLabel
  onActivate: (paneId: string, key: string | null) => void
  onClose: (paneId: string, key: string) => void
  /** Dépôt d'une fiche (venant d'un arbre ou d'un onglet) sur une zone d'un panneau. */
  onDrop: (paneId: string, zone: Zone, view: View, fromTab: { pane: string; key: string } | null, index?: number) => void
  onRatio: (splitId: string, ratio: number) => void
}

// Onglet en cours de glisser (les données du glisser ne sont pas lisibles pendant le survol).
let tabDrag: { pane: string; key: string; view: View } | null = null

function dragged(): { view: View; fromTab: { pane: string; key: string } | null; card?: boolean } | null {
  if (tabDrag) return { view: tabDrag.view, fromTab: { pane: tabDrag.pane, key: tabDrag.key } }
  const t = getTreeDrag()
  if (t) return { view: { kind: 'doc', lib: t.lib, id: t.id }, fromTab: null }
  const c = getCardDrag()
  // Une carte de sous-fiche : seulement sur les bords (le centre sert à ranger les cartes).
  return c ? { view: { kind: 'doc', lib: c.lib, id: c.id }, fromTab: null, card: true } : null
}

const ZONE_LABEL: Record<Zone, string> = {
  center: 'Ouvrir ici, dans un onglet',
  left: 'Ouvrir à gauche',
  right: 'Ouvrir à droite',
  top: 'Ouvrir au-dessus',
  bottom: 'Ouvrir en dessous'
}

/**
 * Zone visée : le bord le plus proche s'il est à moins de 25 % du panneau, sinon le centre.
 * Pour une carte de sous-fiche, seule une bande étroite le long des bords compte
 * (le reste sert à ranger les cartes).
 */
function zoneAt(e: React.DragEvent, el: HTMLElement, narrow = false): Zone {
  const r = el.getBoundingClientRect()
  const d = [
    ['left', e.clientX - r.left, r.width],
    ['right', r.right - e.clientX, r.width],
    ['top', e.clientY - r.top, r.height],
    ['bottom', r.bottom - e.clientY, r.height]
  ] as [Side, number, number][]
  d.sort((a, b) => a[1] / a[2] - b[1] / b[2])
  const [side, dist, size] = d[0]
  const limit = narrow ? Math.min(32, size * 0.08) : size * 0.25
  return dist < limit ? side : 'center'
}

export function Workspace(props: WorkspaceProps) {
  return <Node node={props.root} {...props} />
}

function Node(props: WorkspaceProps & { node: WsNode }) {
  return props.node.type === 'pane' ? <Pane {...props} pane={props.node} /> : <Split {...props} split={props.node} />
}

function Split(props: WorkspaceProps & { split: SplitNode }) {
  const { split } = props
  const box = useRef<HTMLDivElement>(null)
  const [live, setLive] = useState<number | null>(null)
  const ratio = live ?? split.ratio
  const row = split.dir === 'row'

  const start = (e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect()
    if (!r) return
    e.preventDefault()
    let last = split.ratio
    const calc = (ev: PointerEvent) => Math.min(0.85, Math.max(0.15, row ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height))
    const move = (ev: PointerEvent) => setLive((last = calc(ev)))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove(row ? 'resizing-h' : 'resizing-v')
      setLive(null)
      props.onRatio(split.id, last)
    }
    document.body.classList.add(row ? 'resizing-h' : 'resizing-v')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div ref={box} className={`ws-split ${split.dir}`}>
      <div className="ws-cell" style={{ flex: `${ratio} 1 0` }}>
        <Node {...props} node={split.a} />
      </div>
      <div
        className={`ws-gutter ${split.dir}`}
        onPointerDown={start}
        onDoubleClick={() => props.onRatio(split.id, 0.5)}
        title="Glisser pour redimensionner · double-clic : moitié-moitié"
      />
      <div className="ws-cell" style={{ flex: `${1 - ratio} 1 0` }}>
        <Node {...props} node={split.b} />
      </div>
    </div>
  )
}

function Pane(props: WorkspaceProps & { pane: PaneNode }) {
  const { pane, focused } = props
  const [zone, setZone] = useState<Zone | null>(null)
  const [tabIndex, setTabIndex] = useState<number | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const isFocused = pane.id === focused
  const activeTab = pane.tabs.find((t) => t.key === pane.active) ?? null

  const finish = () => {
    setZone(null)
    setTabIndex(null)
  }

  const drop = (z: Zone, index?: number) => {
    const d = dragged()
    finish()
    tabDrag = null
    endTreeDrag()
    if (!d) return
    props.onDrop(pane.id, z, d.view, d.fromTab, index)
  }

  return (
    <div className={`ws-pane ${isFocused ? 'focused' : ''}`} onMouseDownCapture={() => props.onFocus(pane.id)}>
      <div
        className="ws-tabs"
        onDragOver={(e) => {
          if (!dragged()) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setZone(null)
          if (tabIndex === null) setTabIndex(pane.tabs.length)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setTabIndex(null)
        }}
        onDrop={(e) => {
          e.preventDefault()
          drop('center', tabIndex ?? undefined)
        }}
      >
        {pane.tabs.map((t, i) => {
          const label = props.tabLabel(t.view)
          return (
            <div
              key={t.key}
              className={[
                'ws-tab',
                t.key === pane.active ? 'on' : '',
                label.missing ? 'missing' : '',
                tabIndex === i ? 'drop-before' : '',
                tabIndex === pane.tabs.length && i === pane.tabs.length - 1 ? 'drop-after' : ''
              ].join(' ')}
              title={label.title}
              draggable
              onDragStart={(e) => {
                tabDrag = { pane: pane.id, key: t.key, view: t.view }
                e.dataTransfer.setData('application/x-kotari-tab', t.key)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={() => {
                tabDrag = null
                finish()
              }}
              onDragOver={(e) => {
                if (!dragged()) return
                const r = e.currentTarget.getBoundingClientRect()
                const idx = e.clientX < r.left + r.width / 2 ? i : i + 1
                if (idx !== tabIndex) setTabIndex(idx)
              }}
              onClick={() => props.onActivate(pane.id, t.key)}
              onAuxClick={(e) => {
                if (e.button === 1) props.onClose(pane.id, t.key)
              }}
            >
              <span className={`ws-tab-dot ${label.lib}`} />
              <span className="ws-tab-title">{label.title}</span>
              <button
                className="ws-tab-close"
                title="Fermer (Ctrl+W)"
                onClick={(e) => {
                  e.stopPropagation()
                  props.onClose(pane.id, t.key)
                }}
              >
                ×
              </button>
            </div>
          )
        })}
        <button
          className={`ws-tab-new ${pane.active === null ? 'on' : ''}`}
          title="Accueil"
          onClick={() => props.onActivate(pane.id, null)}
        >
          +
        </button>
      </div>

      <div
        ref={body}
        className="ws-body"
        // Capture : passe avant l'éditeur de texte, qui accepterait sinon le glisser comme du texte.
        onDragOverCapture={(e) => {
          const d = dragged()
          if (!d || [...e.dataTransfer.types].includes('Files')) return
          const z = zoneAt(e, body.current!, d.card)
          if (d.card && z === 'center') {
            if (zone) setZone(null)
            return
          }
          e.preventDefault()
          e.stopPropagation()
          e.dataTransfer.dropEffect = 'move'
          if (z !== zone) setZone(z)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setZone(null)
        }}
        onDropCapture={(e) => {
          const d = dragged()
          if (!d || [...e.dataTransfer.types].includes('Files')) return
          const z = zoneAt(e, body.current!, d.card)
          if (d.card && z === 'center') return
          e.preventDefault()
          e.stopPropagation()
          drop(z)
        }}
      >
        <div className="ws-scroll">
          {activeTab ? props.renderView(activeTab.view, pane.id, isFocused) : props.renderHome(pane.id)}
        </div>
        {zone && (
          <div className={`ws-drop-preview ${zone}`}>
            <span>{ZONE_LABEL[zone]}</span>
          </div>
        )}
      </div>
    </div>
  )
}
