// Espace de travail : panneaux côte à côte (arbre de découpes), chacun avec ses onglets.

import type { LibraryKind } from './library'

export type View = { kind: 'doc'; lib: LibraryKind; id: string } | { kind: 'types'; lib: LibraryKind }

export interface Tab {
  key: string
  view: View
}

export interface PaneNode {
  type: 'pane'
  id: string
  tabs: Tab[]
  /** Onglet affiché ; null = page d'accueil. */
  active: string | null
}

export interface SplitNode {
  type: 'split'
  id: string
  /** row : côte à côte ; column : l'un au-dessus de l'autre. */
  dir: 'row' | 'column'
  /** Part du premier enfant (0..1). */
  ratio: number
  a: WsNode
  b: WsNode
}

export type WsNode = PaneNode | SplitNode
export type Side = 'left' | 'right' | 'top' | 'bottom'

export const MAX_TABS = 15

let seq = 0
const uid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`

export const viewKey = (v: View) => (v.kind === 'doc' ? `doc:${v.lib}:${v.id}` : `types:${v.lib}`)

export function newPane(views: View[] = []): PaneNode {
  const tabs = views.map((view) => ({ key: viewKey(view), view }))
  return { type: 'pane', id: uid('p'), tabs, active: tabs[0]?.key ?? null }
}

export function panes(n: WsNode): PaneNode[] {
  return n.type === 'pane' ? [n] : [...panes(n.a), ...panes(n.b)]
}

export function findPane(n: WsNode, id: string): PaneNode | null {
  return panes(n).find((p) => p.id === id) ?? null
}

function mapNode(n: WsNode, f: (p: PaneNode) => WsNode): WsNode {
  if (n.type === 'pane') return f(n)
  return { ...n, a: mapNode(n.a, f), b: mapNode(n.b, f) }
}

function updatePane(root: WsNode, id: string, f: (p: PaneNode) => PaneNode): WsNode {
  return mapNode(root, (p) => (p.id === id ? f(p) : p))
}

/** Retire les panneaux vides (sauf s'il n'en reste qu'un). */
export function collapse(n: WsNode): WsNode {
  if (n.type === 'pane') return n
  const a = collapse(n.a)
  const b = collapse(n.b)
  const empty = (x: WsNode) => x.type === 'pane' && x.tabs.length === 0
  if (empty(a) && !empty(b)) return b
  if (empty(b) && !empty(a)) return a
  if (empty(a) && empty(b)) return a
  return { ...n, a, b }
}

/** Ouvre une vue dans un panneau : nouvel onglet (ou l'existant), ou à la place de l'onglet courant. */
export function openIn(root: WsNode, paneId: string, view: View, mode: 'tab' | 'replace' = 'tab'): WsNode {
  const key = viewKey(view)
  return updatePane(root, paneId, (p) => {
    if (p.tabs.some((t) => t.key === key)) return { ...p, active: key }
    let tabs = [...p.tabs]
    const idx = tabs.findIndex((t) => t.key === p.active)
    if (mode === 'replace' && idx !== -1) tabs[idx] = { key, view }
    else tabs.splice(idx === -1 ? tabs.length : idx + 1, 0, { key, view })
    // Trop d'onglets : on retire les plus anciens (sauf l'actif).
    while (tabs.length > MAX_TABS) {
      const drop = tabs.findIndex((t) => t.key !== key)
      tabs = tabs.filter((_, i) => i !== drop)
    }
    return { ...p, tabs, active: key }
  })
}

export function activate(root: WsNode, paneId: string, key: string | null): WsNode {
  return updatePane(root, paneId, (p) => ({ ...p, active: key }))
}

export function closeTab(root: WsNode, paneId: string, key: string): WsNode {
  const next = updatePane(root, paneId, (p) => {
    const idx = p.tabs.findIndex((t) => t.key === key)
    if (idx === -1) return p
    const tabs = p.tabs.filter((t) => t.key !== key)
    const active = p.active === key ? (tabs[idx]?.key ?? tabs[idx - 1]?.key ?? null) : p.active
    return { ...p, tabs, active }
  })
  return collapse(next)
}

/** Place une vue à côté d'un panneau, dans un nouveau panneau. Renvoie l'id du nouveau panneau. */
export function splitWith(root: WsNode, paneId: string, side: Side, view: View): { root: WsNode; paneId: string } {
  const fresh = newPane([view])
  const replace = (n: WsNode): WsNode => {
    if (n.type === 'pane') {
      if (n.id !== paneId) return n
      const dir = side === 'left' || side === 'right' ? 'row' : 'column'
      const first = side === 'left' || side === 'top'
      return { type: 'split', id: uid('s'), dir, ratio: 0.5, a: first ? fresh : n, b: first ? n : fresh }
    }
    return { ...n, a: replace(n.a), b: replace(n.b) }
  }
  return { root: replace(root), paneId: fresh.id }
}

/** Déplace un onglet vers un autre panneau (ou une autre position du même). */
export function moveTab(root: WsNode, fromPane: string, key: string, toPane: string, index?: number): WsNode {
  const tab = findPane(root, fromPane)?.tabs.find((t) => t.key === key)
  if (!tab) return root
  let next = root
  if (fromPane !== toPane) next = updatePane(next, fromPane, (p) => {
    const tabs = p.tabs.filter((t) => t.key !== key)
    return { ...p, tabs, active: p.active === key ? (tabs[tabs.length - 1]?.key ?? null) : p.active }
  })
  next = updatePane(next, toPane, (p) => {
    const tabs = p.tabs.filter((t) => t.key !== key)
    const i = index === undefined ? tabs.length : Math.max(0, Math.min(tabs.length, index))
    tabs.splice(i, 0, tab)
    return { ...p, tabs, active: key }
  })
  return collapse(next)
}

export function setRatio(root: WsNode, splitId: string, ratio: number): WsNode {
  if (root.type === 'pane') return root
  if (root.id === splitId) return { ...root, ratio: Math.min(0.85, Math.max(0.15, ratio)) }
  return { ...root, a: setRatio(root.a, splitId, ratio), b: setRatio(root.b, splitId, ratio) }
}

/** Ferme partout les onglets dont la vue ne doit plus exister (fiche supprimée, déconnexion…). */
export function dropViews(root: WsNode, pred: (v: View) => boolean): WsNode {
  const next = mapNode(root, (p) => {
    const tabs = p.tabs.filter((t) => !pred(t.view))
    if (tabs.length === p.tabs.length) return p
    const active = tabs.some((t) => t.key === p.active) ? p.active : (tabs[tabs.length - 1]?.key ?? null)
    return { ...p, tabs, active }
  })
  return collapse(next)
}
