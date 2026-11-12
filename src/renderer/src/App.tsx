import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { initialContent } from '@shared/content'
import { collectImages } from '@shared/content'
import { planCopy } from '@shared/copy'
import type { SearchHit } from '@shared/search'
import type { DocMeta } from '@shared/model'
import { childrenOf, isDescendant, newId, orderAt, subtree } from '@shared/model'
import type { ProjectSnapshot, SavedServerInfo } from './env'
import { focusKey, requestFocus } from './lib/focus'
import { loadTheme, saveTheme, watchSystemTheme, type ThemeSettings } from './lib/theme'
import { loadPref, savePref, UiContext, type UiApi } from './lib/hooks'
import type { Library, LibraryKind } from './lib/library'
import { useLibraryState } from './lib/library'
import { LocalLibrary } from './lib/localLibrary'
import { ServerLibrary, serverLabel, type ConnectOptions } from './lib/serverLibrary'
import { Fiche } from './components/Fiche'
import { ProjectHome, Welcome, type RecentProject } from './components/Home'
import { ConfirmModal, ConnectModal, NewDocModal, SettingsModal, type ConnectInitial } from './components/Modals'
import { GlobalSearch } from './components/Search'
import { Tree, type DragSource, type DropPos } from './components/Tree'
import { TypesScreen } from './components/TypesScreen'
import { Workspace, type TabLabel, type Zone } from './components/Workspace'
import * as ws from './lib/workspace'
import type { View, WsNode } from './lib/workspace'


type ModalState =
  | { kind: 'new-doc'; lib: LibraryKind; parentId: string | null }
  | { kind: 'connect'; initial?: ConnectInitial }
  | { kind: 'settings' }
  | { kind: 'search' }
  | {
      kind: 'confirm'
      title: string
      message: string
      confirmLabel?: string
      danger?: boolean
      resolve: (ok: boolean) => void
    }

interface Toast {
  id: number
  message: string
  kind: 'info' | 'error'
}

const RECENTS_KEY = 'kotari.recents'

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}

/** Parent et ordre pour un dépôt sur `refId` à la position `pos`. */
function dropTarget(docs: DocMeta[], dragId: string | null, refId: string | null, pos: DropPos) {
  const sib = (parentId: string | null) => childrenOf(docs, parentId).filter((d) => d.id !== dragId)
  const ref = refId ? docs.find((d) => d.id === refId) : undefined
  if (!ref || pos === 'end') {
    const s = sib(null)
    return { parentId: null, order: orderAt(s, s.length) }
  }
  if (pos === 'inside') {
    const s = sib(ref.id)
    return { parentId: ref.id, order: orderAt(s, s.length) }
  }
  const s = sib(ref.parentId)
  let idx = s.findIndex((d) => d.id === ref.id)
  if (pos === 'after') idx++
  return { parentId: ref.parentId, order: orderAt(s, idx) }
}

export function App() {
  const [local, setLocal] = useState<LocalLibrary | null>(null)
  const [server, setServer] = useState<ServerLibrary | null>(null)
  // Panneaux et onglets.
  const [root, setRoot] = useState<WsNode>(() => ws.newPane())
  const [focused, setFocused] = useState<string>(() => (root as ws.PaneNode).id)
  const rootRef = useRef(root)
  rootRef.current = root
  const focusedRef = useRef(focused)
  focusedRef.current = focused
  /** Panneau actif (celui qui a le focus, ou le premier). */
  const focusPane = () => ws.findPane(rootRef.current, focusedRef.current) ?? ws.panes(rootRef.current)[0]
  const updateRoot = (f: (r: WsNode) => WsNode) => {
    const next = f(rootRef.current)
    rootRef.current = next
    setRoot(next)
    if (!ws.findPane(next, focusedRef.current)) {
      const first = ws.panes(next)[0]
      focusedRef.current = first.id
      setFocused(first.id)
    }
  }
  const focusOn = (id: string) => {
    focusedRef.current = id
    setFocused(id)
  }
  const openView = (v: View, mode: 'tab' | 'replace' = 'tab') => updateRoot((r) => ws.openIn(r, focusPane().id, v, mode))
  const goHome = () => updateRoot((r) => ws.activate(r, focusPane().id, null))
  const dropViews = (pred: (v: View) => boolean) => updateRoot((r) => ws.dropViews(r, pred))
  const currentPane = ws.findPane(root, focused) ?? ws.panes(root)[0]
  const currentView = currentPane.tabs.find((t) => t.key === currentPane.active)?.view ?? null
  const [modal, setModal] = useState<ModalState | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [filter, setFilter] = useState('')
  const [recents, setRecents] = useState<RecentProject[]>(() => loadPref(RECENTS_KEY, []))
  const [savedServers, setSavedServers] = useState<SavedServerInfo[]>([])
  const [connecting, setConnecting] = useState<string | null>(null)
  const [theme, setTheme] = useState<ThemeSettings>(loadTheme)
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  // Séparation réglable entre l'arbre local et l'arbre serveur.
  const [split, setSplit] = useState<number>(() => loadPref('kotari.split', 0.5))
  const libsRef = useRef<HTMLDivElement>(null)
  const startSplit = (e: React.PointerEvent) => {
    const box = libsRef.current?.getBoundingClientRect()
    if (!box) return
    e.preventDefault()
    const ratio = (y: number) => Math.min(0.88, Math.max(0.12, (y - box.top) / box.height))
    let last = split
    const move = (ev: PointerEvent) => setSplit((last = ratio(ev.clientY)))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('resizing-v')
      savePref('kotari.split', last)
    }
    document.body.classList.add('resizing-v')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  useEffect(() => {
    void window.kotari.updateStatus().then((v) => v && setUpdateVersion(v))
    window.kotari.onUpdateReady(setUpdateVersion)
  }, [])
  const themeRef = useRef(theme)
  themeRef.current = theme

  useEffect(() => watchSystemTheme(() => themeRef.current), [])
  const refreshServers = () => window.kotari.listServers().then(setSavedServers).catch(() => {})
  useEffect(() => {
    void refreshServers()
  }, [])

  // Ctrl+Maj+F : recherche globale.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setModal((m) => (m && m.kind !== 'search' ? m : { kind: 'search' }))
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const localRef = useRef(local)
  localRef.current = local
  const serverRef = useRef(server)
  serverRef.current = server

  const localState = useLibraryState(local)
  const serverState = useLibraryState(server)

  const ui: UiApi = useMemo(
    () => ({
      toast(message, kind = 'info') {
        const id = Date.now() + Math.random()
        setToasts((t) => [...t, { id, message, kind }])
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500)
      },
      confirm(opts) {
        return new Promise((resolve) => setModal({ kind: 'confirm', ...opts, resolve }))
      }
    }),
    []
  )

  const libOf = useCallback(
    (k: LibraryKind): Library | null => (k === 'local' ? local : server),
    [local, server]
  )

  // Fermeture de la fenêtre : on écrit ce qui reste en attente.
  useEffect(() => {
    window.kotari.onFlushRequest(async () => {
      await localRef.current?.flush()
    })
  }, [])

  // ---------- Projet local ----------

  const rememberRecent = (snap: ProjectSnapshot) => {
    const next = [{ path: snap.path, name: snap.name }, ...recents.filter((r) => r.path !== snap.path)].slice(0, 8)
    setRecents(next)
    savePref(RECENTS_KEY, next)
  }

  const useProject = async (snap: ProjectSnapshot | null) => {
    if (!snap) return
    await localRef.current?.flush()
    const lib = new LocalLibrary(snap)
    lib.onError = (m) => ui.toast(m, 'error')
    setLocal(lib)
    rememberRecent(snap)
    dropViews((v) => v.lib === 'local')
  }

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (e) {
      ui.toast(errMsg(e), 'error')
    }
  }

  const closeProject = async () => {
    await local?.flush()
    await window.kotari.closeProject()
    setLocal(null)
    dropViews((v) => v.lib === 'local')
  }

  // ---------- Serveur ----------

  const connect = async (opts: ConnectOptions, rememberPassword: boolean | 'keep' = 'keep') => {
    serverRef.current?.destroy()
    const lib = await ServerLibrary.connect(opts)
    await window.kotari
      .rememberServer(
        { host: opts.host, port: opts.port, secure: !!opts.secure, name: opts.name },
        rememberPassword === 'keep' ? undefined : rememberPassword ? opts.password : null
      )
      .catch(() => {})
    void refreshServers()
    lib.onLost = (reason) => {
      setServer(null)
      dropViews((v) => v.lib === 'server')
      ui.toast(reason, 'error')
    }
    setServer(lib)
    setModal(null)
    ui.toast(`Connecté à ${lib.label}.`)
  }

  const quickConnect = async (s: SavedServerInfo) => {
    const initial: ConnectInitial = { host: s.host, port: s.port, secure: !!s.secure, name: s.name }
    const password = s.hasPassword ? await window.kotari.serverPassword(s.id) : null
    if (password === null) return setModal({ kind: 'connect', initial })
    setConnecting(s.id)
    try {
      await connect({ host: s.host, port: s.port, secure: !!s.secure, name: s.name, password })
    } catch (e) {
      setModal({ kind: 'connect', initial: { ...initial, error: errMsg(e) } })
    } finally {
      setConnecting(null)
    }
  }

  const forgetServer = async (s: SavedServerInfo) => {
    await window.kotari.forgetServer(s.id)
    void refreshServers()
  }

  const pickSearchHit = (kind: LibraryKind, hit: SearchHit, query: string) => {
    setModal(null)
    openView({ kind: 'doc', lib: kind, id: hit.docId })
    setTimeout(() => requestFocus(focusKey(hit.docId, hit.path), query, hit.nth), 0)
  }

  const disconnect = () => {
    server?.destroy()
    setServer(null)
    dropViews((v) => v.lib === 'server')
  }

  useEffect(() => () => serverRef.current?.destroy(), [])

  // ---------- Fiches ----------

  const createDoc = async (k: LibraryKind, parentId: string | null, typeId: string, title: string) => {
    const lib = libOf(k)
    if (!lib) return
    const { docs, types } = lib.getState()
    const type = types.find((t) => t.id === typeId)
    if (!type) throw new Error('Type introuvable.')
    const siblings = childrenOf(docs, parentId)
    const meta: DocMeta = { id: newId(), title, typeId, parentId, order: orderAt(siblings, siblings.length) }
    await lib.createDoc(meta, initialContent(type))
    setModal(null)
    openView({ kind: 'doc', lib: k, id: meta.id })
  }

  const deleteDoc = async (k: LibraryKind, id: string) => {
    const lib = libOf(k)
    if (!lib) return
    const tree = subtree(lib.getState().docs, id)
    if (!tree.length) return
    const extra = tree.length - 1
    const ok = await ui.confirm({
      title: `Supprimer « ${tree[0].title || 'Sans titre'} » ?`,
      message:
        (extra > 0 ? `Ses ${extra} sous-fiche${extra > 1 ? 's' : ''} seront aussi supprimées. ` : '') +
        (k === 'server' ? 'La suppression est immédiate pour tout le monde.' : 'Cette action est définitive.'),
      confirmLabel: 'Supprimer',
      danger: true
    })
    if (!ok) return
    await run(async () => {
      await lib.deleteDocs(tree.map((d) => d.id).reverse())
      const gone = new Set(tree.map((d) => d.id))
      dropViews((v) => v.kind === 'doc' && v.lib === k && gone.has(v.id))
    })
  }

  const handleDrop = async (destKind: LibraryKind, src: DragSource, refId: string | null, pos: DropPos) => {
    const dest = libOf(destKind)
    const source = libOf(src.lib)
    if (!dest || !source) return
    const destDocs = dest.getState().docs

    if (src.lib === destKind) {
      const target = dropTarget(destDocs, src.id, refId, pos)
      if (target.parentId && isDescendant(destDocs, src.id, target.parentId)) {
        ui.toast('Impossible de placer une fiche dans ses propres sous-fiches.', 'error')
        return
      }
      dest.updateMeta(src.id, target)
      return
    }

    // Entre bibliothèques : copie du sous-arbre.
    await run(async () => {
      const ids = subtree(source.getState().docs, src.id).map((d) => d.id)
      const exported = await source.exportDocs(ids)
      // Images référencées : envoyées d'abord si la destination ne les a pas.
      const hashes = [...new Set(exported.flatMap((d) => collectImages(d.content)))]
      for (const h of await dest.missingImages(hashes)) {
        const data = await source.getImage(h)
        if (data) await dest.putImage(h, data)
      }
      const target = dropTarget(destDocs, null, refId, pos)
      const plan = planCopy(exported, source.getState().types, dest.getState().types, target.parentId, target.order)
      await dest.importDocs(plan)
      const n = plan.docs.length
      ui.toast(
        `${n} fiche${n > 1 ? 's' : ''} copiée${n > 1 ? 's' : ''} ${destKind === 'server' ? 'sur le serveur' : 'en local'}.` +
          (plan.newTypes.some((t) => !source.getState().types.some((s) => s.id === t.id))
            ? ' Un type différent du même nom existait : une variante a été créée.'
            : '')
      )
    })
  }

  // ---------- Rendu ----------

  const libs = { ...(local ? { local } : {}), ...(server ? { server } : {}) }
  const sidebar = (k: LibraryKind, lib: Library) => (
    <Tree
      lib={lib}
      selectedId={currentView?.kind === 'doc' && currentView.lib === k ? currentView.id : null}
      filter={filter}
      onSelect={(id) => openView({ kind: 'doc', lib: k, id })}
      onAdd={(parentId) => setModal({ kind: 'new-doc', lib: k, parentId })}
      onDelete={(id) => void deleteDoc(k, id)}
      onDrop={(src, refId, pos) => void handleDrop(k, src, refId, pos)}
    />
  )

  const renderView = (v: View, paneId: string, active: boolean): React.ReactNode => {
    const lib = libOf(v.lib)
    if (!lib) return null
    if (v.kind === 'types') return <TypesScreen key={`types:${v.lib}`} libs={libs} initial={v.lib} />
    return (
      <Fiche
        key={`${v.lib}:${v.id}`}
        lib={lib}
        id={v.id}
        active={active}
        onOpen={(id, newTab) => updateRoot((r) => ws.openIn(r, paneId, { kind: 'doc', lib: v.lib, id }, newTab ? 'tab' : 'replace'))}
        onAddChild={(parentId) => setModal({ kind: 'new-doc', lib: v.lib, parentId })}
        onDelete={(id) => void deleteDoc(v.lib, id)}
      />
    )
  }

  const renderHome = (): React.ReactNode =>
    local ? (
      <ProjectHome
        name={local.label}
        docCount={localState.docs.length}
        typeCount={localState.types.length}
        connected={!!server}
        onNew={() => setModal({ kind: 'new-doc', lib: 'local', parentId: null })}
        onTypes={() => openView({ kind: 'types', lib: 'local' })}
        onReveal={() => void window.kotari.revealProject()}
      />
    ) : (
      <Welcome
        recents={recents}
        connected={!!server}
        onCreate={(name, tpl) => run(async () => useProject(await window.kotari.createProject(name, tpl)))}
        onOpen={() => run(async () => useProject(await window.kotari.openProject()))}
        onOpenRecent={(r) => run(async () => useProject(await window.kotari.openProjectPath(r.path)))}
        onForget={(r) => {
          const next = recents.filter((x) => x.path !== r.path)
          setRecents(next)
          savePref(RECENTS_KEY, next)
        }}
        onConnect={() => setModal({ kind: 'connect' })}
      />
    )

  const tabLabel = (v: View): TabLabel => {
    const st = v.lib === 'local' ? localState : serverState
    if (v.kind === 'types') return { title: `Types · ${v.lib === 'local' ? 'local' : 'serveur'}`, lib: v.lib }
    const d = st.docs.find((x) => x.id === v.id)
    return d ? { title: d.title || 'Sans titre', lib: v.lib } : { title: 'Supprimée', lib: v.lib, missing: true }
  }

  const onPaneDrop = (paneId: string, zone: Zone, v: View, fromTab: { pane: string; key: string } | null, index?: number) => {
    if (zone === 'center') {
      updateRoot((r) => {
        if (fromTab) return ws.moveTab(r, fromTab.pane, fromTab.key, paneId, index)
        const next = ws.openIn(r, paneId, v, 'tab')
        // Dépôt sur la barre d'onglets : à la position visée.
        return index === undefined ? next : ws.moveTab(next, paneId, ws.viewKey(v), paneId, index)
      })
      focusOn(paneId)
      return
    }
    let created = ''
    updateRoot((r) => {
      // Un onglet glissé hors de son panneau le quitte ; une fiche de l'arbre s'ouvre en plus.
      const base = fromTab && !(fromTab.pane === paneId && ws.findPane(r, paneId)!.tabs.length === 1) ? ws.closeTab(r, fromTab.pane, fromTab.key) : r
      const target = ws.findPane(base, paneId) ? paneId : ws.panes(base)[0].id
      const res = ws.splitWith(base, target, zone, v)
      created = res.paneId
      return res.root
    })
    if (created) focusOn(created)
  }

  // Ctrl+W : ferme l'onglet du panneau actif.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'w') {
        e.preventDefault()
        const p = focusPane()
        if (p.active) updateRoot((r) => ws.closeTab(r, p.id, p.active!))
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  const main = (
    <Workspace
      root={root}
      focused={focused}
      onFocus={(id) => id !== focusedRef.current && focusOn(id)}
      renderView={renderView}
      renderHome={renderHome}
      tabLabel={tabLabel}
      onActivate={(paneId, key) => updateRoot((r) => ws.activate(r, paneId, key))}
      onClose={(paneId, key) => updateRoot((r) => ws.closeTab(r, paneId, key))}
      onDrop={onPaneDrop}
      onRatio={(id, ratio) => updateRoot((r) => ws.setRatio(r, id, ratio))}
    />
  )

  const searchLibs = useMemo(
    () => [...(local ? [{ kind: 'local' as const, lib: local as Library }] : []), ...(server ? [{ kind: 'server' as const, lib: server as Library }] : [])],
    [local, server]
  )

  const newDocLib = modal?.kind === 'new-doc' ? libOf(modal.lib) : null
  const newDocState = modal?.kind === 'new-doc' ? (modal.lib === 'local' ? localState : serverState) : null

  return (
    <UiContext.Provider value={ui}>
      <div className="app">
        <aside className="sidebar">
          <div className="brand-row">
            <div className="brand" onClick={goHome} title="Accueil">
              Kotari
            </div>
            {(local || server) && (
              <button className="icon-btn" title="Rechercher partout (Ctrl+Maj+F)" onClick={() => setModal({ kind: 'search' })}>
                ⌕
              </button>
            )}
            <button className="icon-btn" title="Réglages" onClick={() => setModal({ kind: 'settings' })}>
              ⚙
            </button>
          </div>
          {(local || server) && (
            <input
              className="input filter"
              placeholder="Filtrer par titre…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          )}

          <div className="libs" ref={libsRef}>
          <div className="lib-section" style={{ flex: `${split} 1 0` }}>
            <div className="lib-head">
              <span className="lib-name" title={local?.path}>
                {local ? local.label : 'Local'}
              </span>
              {local && (
                <span className="lib-actions">
                  <button
                    className="icon-btn"
                    title="Nouvelle fiche"
                    onClick={() => setModal({ kind: 'new-doc', lib: 'local', parentId: null })}
                  >
                    +
                  </button>
                  <button className="btn ghost tiny" onClick={() => openView({ kind: 'types', lib: 'local' })}>
                    Types
                  </button>
                  <button className="btn ghost tiny" title="Fermer le projet" onClick={() => void closeProject()}>
                    Fermer
                  </button>
                </span>
              )}
            </div>
            {local ? (
              sidebar('local', local)
            ) : (
              <div className="lib-placeholder">
                {recents.length > 0 && (
                  <ul className="side-recents">
                    {recents.slice(0, 6).map((r) => (
                      <li key={r.path}>
                        <button
                          className="side-recent"
                          title={r.path}
                          onClick={() => run(async () => useProject(await window.kotari.openProjectPath(r.path)))}
                        >
                          <span className="side-recent-name">{r.name}</span>
                          <span className="muted small side-recent-sub">{r.path}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <button className="btn small" onClick={goHome}>
                  Ouvrir ou créer un projet…
                </button>
              </div>
            )}
          </div>

          <div
            className="lib-split"
            title="Glisser pour redimensionner · double-clic : moitié-moitié"
            onPointerDown={startSplit}
            onDoubleClick={() => {
              setSplit(0.5)
              savePref('kotari.split', 0.5)
            }}
          />
          <div className="lib-section" style={{ flex: `${1 - split} 1 0` }}>
            <div className="lib-head">
              <span className="lib-name">
                {server ? (
                  <>
                    <span className={`dot ${server.status}`} title={server.status === 'connected' ? 'Connecté' : 'Reconnexion…'} />
                    Serveur
                  </>
                ) : (
                  'Serveur'
                )}
              </span>
              {server && (
                <span className="lib-actions">
                  <button
                    className="icon-btn"
                    title="Nouvelle fiche sur le serveur"
                    onClick={() => setModal({ kind: 'new-doc', lib: 'server', parentId: null })}
                  >
                    +
                  </button>
                  <button className="btn ghost tiny" onClick={() => openView({ kind: 'types', lib: 'server' })}>
                    Types
                  </button>
                  <button className="btn ghost tiny" onClick={disconnect}>
                    Quitter
                  </button>
                </span>
              )}
            </div>
            {server ? (
              <>
                <div className="peers">
                  <span className="muted small">{server.label}</span>
                  {server.status !== 'connected' && <span className="small warn">Reconnexion…</span>}
                  <span className="peer-list">
                    {server.peers.map((p) => (
                      <span key={p.clientId} className="peer" style={{ background: p.color }} title={p.name}>
                        {p.name}
                      </span>
                    ))}
                  </span>
                </div>
                {sidebar('server', server)}
              </>
            ) : (
              <div className="lib-placeholder">
                {savedServers.length > 0 && (
                  <ul className="side-recents">
                    {savedServers.map((sv) => (
                      <li key={sv.id}>
                        <button
                          className="side-recent"
                          disabled={!!connecting}
                          title={sv.hasPassword ? 'Se reconnecter' : 'Se reconnecter (mot de passe demandé)'}
                          onClick={() => void quickConnect(sv)}
                        >
                          <span className="side-recent-name">
                            {serverLabel(sv.host, sv.port, !!sv.secure)}
                            {sv.secure && <span className="muted small"> · HTTPS</span>}
                            {connecting === sv.id && <span className="muted small"> · connexion…</span>}
                          </span>
                          <span className="muted small side-recent-sub">
                            {sv.name}
                            {sv.hasPassword ? ' · mot de passe retenu' : ''}
                          </span>
                        </button>
                        <button className="icon-btn" title="Oublier ce serveur" onClick={() => void forgetServer(sv)}>
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <button className="btn small" onClick={() => setModal({ kind: 'connect' })}>
                  {savedServers.length ? 'Autre serveur…' : 'Se connecter à un serveur'}
                </button>
              </div>
            )}
          </div>
          </div>
          {updateVersion && (
            <div className="update-banner">
              <span>Kotari {updateVersion} est prête.</span>
              <button
                className="btn primary small"
                onClick={async () => {
                  await localRef.current?.flush()
                  await window.kotari.installUpdate()
                }}
              >
                Redémarrer
              </button>
            </div>
          )}
        </aside>

        <main className="main">{main}</main>

        {modal?.kind === 'new-doc' && newDocLib && newDocState && (
          <NewDocModal
            types={newDocState.types}
            where={modal.lib === 'server' ? `serveur ${newDocLib.label}` : `projet local « ${newDocLib.label} »`}
            parentTitle={
              modal.parentId ? (newDocState.docs.find((d) => d.id === modal.parentId)?.title || 'Sans titre') : null
            }
            onCreate={(typeId, title) => createDoc(modal.lib, modal.parentId, typeId, title)}
            onManageTypes={() => {
              setModal(null)
              openView({ kind: 'types', lib: modal.lib })
            }}
            onClose={() => setModal(null)}
          />
        )}
        {modal?.kind === 'connect' && (
          <ConnectModal initial={modal.initial} onConnect={(o, r) => connect(o, r)} onClose={() => setModal(null)} />
        )}
        {modal?.kind === 'settings' && (
          <SettingsModal
            theme={theme}
            onTheme={(t) => {
              setTheme(t)
              saveTheme(t)
            }}
            onClose={() => setModal(null)}
          />
        )}
        {modal?.kind === 'search' && (local || server) && (
          <GlobalSearch
            libs={searchLibs}
            onPick={pickSearchHit}
            onClose={() => setModal(null)}
          />
        )}
        {modal?.kind === 'confirm' && (
          <ConfirmModal
            title={modal.title}
            message={modal.message}
            confirmLabel={modal.confirmLabel}
            danger={modal.danger}
            onAnswer={(ok) => {
              setModal(null)
              modal.resolve(ok)
            }}
          />
        )}

        <div className="toasts">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.kind}`}>
              {t.message}
            </div>
          ))}
        </div>
      </div>
    </UiContext.Provider>
  )
}
