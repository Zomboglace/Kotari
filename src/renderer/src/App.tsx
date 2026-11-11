import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { initialContent } from '@shared/content'
import { planCopy } from '@shared/copy'
import type { DocMeta } from '@shared/model'
import { childrenOf, isDescendant, newId, orderAt, subtree } from '@shared/model'
import type { ProjectSnapshot } from './env'
import { loadPref, savePref, UiContext, type UiApi } from './lib/hooks'
import type { Library, LibraryKind } from './lib/library'
import { useLibraryState } from './lib/library'
import { LocalLibrary } from './lib/localLibrary'
import { ServerLibrary, type ConnectOptions } from './lib/serverLibrary'
import { Fiche } from './components/Fiche'
import { ProjectHome, Welcome, type RecentProject } from './components/Home'
import { ConfirmModal, ConnectModal, NewDocModal } from './components/Modals'
import { Tree, type DragSource, type DropPos } from './components/Tree'
import { TypesScreen } from './components/TypesScreen'

type View = { kind: 'home' } | { kind: 'doc'; lib: LibraryKind; id: string } | { kind: 'types'; lib: LibraryKind }

type ModalState =
  | { kind: 'new-doc'; lib: LibraryKind; parentId: string | null }
  | { kind: 'connect' }
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
  const [view, setView] = useState<View>({ kind: 'home' })
  const [modal, setModal] = useState<ModalState | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [filter, setFilter] = useState('')
  const [recents, setRecents] = useState<RecentProject[]>(() => loadPref(RECENTS_KEY, []))

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
    setView((v) => (v.kind === 'doc' && v.lib === 'server' ? v : { kind: 'home' }))
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
    setView((v) => (v.kind === 'doc' && v.lib === 'server' ? v : { kind: 'home' }))
  }

  // ---------- Serveur ----------

  const connect = async (opts: ConnectOptions) => {
    serverRef.current?.destroy()
    const lib = await ServerLibrary.connect(opts)
    lib.onLost = (reason) => {
      setServer(null)
      setView((v) => (v.kind !== 'home' && v.lib === 'server' ? { kind: 'home' } : v))
      ui.toast(reason, 'error')
    }
    setServer(lib)
    setModal(null)
    ui.toast(`Connecté à ${lib.label}.`)
  }

  const disconnect = () => {
    server?.destroy()
    setServer(null)
    setView((v) => (v.kind !== 'home' && v.lib === 'server' ? { kind: 'home' } : v))
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
    setView({ kind: 'doc', lib: k, id: meta.id })
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
      setView((v) => (v.kind === 'doc' && v.lib === k && tree.some((d) => d.id === v.id) ? { kind: 'home' } : v))
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
      selectedId={view.kind === 'doc' && view.lib === k ? view.id : null}
      filter={filter}
      onSelect={(id) => setView({ kind: 'doc', lib: k, id })}
      onAdd={(parentId) => setModal({ kind: 'new-doc', lib: k, parentId })}
      onDelete={(id) => void deleteDoc(k, id)}
      onDrop={(src, refId, pos) => void handleDrop(k, src, refId, pos)}
    />
  )

  let main: React.ReactNode
  if (view.kind === 'doc' && libOf(view.lib)) {
    const lib = libOf(view.lib)!
    main = (
      <Fiche
        key={`${view.lib}:${view.id}`}
        lib={lib}
        id={view.id}
        onOpen={(id) => setView({ kind: 'doc', lib: view.lib, id })}
        onAddChild={(parentId) => setModal({ kind: 'new-doc', lib: view.lib, parentId })}
        onDelete={(id) => void deleteDoc(view.lib, id)}
      />
    )
  } else if (view.kind === 'types' && (local || server)) {
    main = <TypesScreen libs={libs} initial={view.lib} />
  } else if (local) {
    main = (
      <ProjectHome
        name={local.label}
        docCount={localState.docs.length}
        typeCount={localState.types.length}
        connected={!!server}
        onNew={() => setModal({ kind: 'new-doc', lib: 'local', parentId: null })}
        onTypes={() => setView({ kind: 'types', lib: 'local' })}
        onReveal={() => void window.kotari.revealProject()}
      />
    )
  } else {
    main = (
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
  }

  const newDocLib = modal?.kind === 'new-doc' ? libOf(modal.lib) : null
  const newDocState = modal?.kind === 'new-doc' ? (modal.lib === 'local' ? localState : serverState) : null

  return (
    <UiContext.Provider value={ui}>
      <div className="app">
        <aside className="sidebar">
          <div className="brand" onClick={() => setView({ kind: 'home' })} title="Accueil">
            Kotari
          </div>
          {(local || server) && (
            <input
              className="input filter"
              placeholder="Filtrer par titre…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          )}

          <div className="lib-section">
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
                  <button className="btn ghost tiny" onClick={() => setView({ kind: 'types', lib: 'local' })}>
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
                <button className="btn small" onClick={() => setView({ kind: 'home' })}>
                  Ouvrir ou créer un projet
                </button>
              </div>
            )}
          </div>

          <div className="lib-section">
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
                  <button className="btn ghost tiny" onClick={() => setView({ kind: 'types', lib: 'server' })}>
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
                <button className="btn small" onClick={() => setModal({ kind: 'connect' })}>
                  Se connecter à un serveur
                </button>
              </div>
            )}
          </div>
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
              setView({ kind: 'types', lib: modal.lib })
            }}
            onClose={() => setModal(null)}
          />
        )}
        {modal?.kind === 'connect' && <ConnectModal onConnect={connect} onClose={() => setModal(null)} />}
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
