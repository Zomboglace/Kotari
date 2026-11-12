import { useEffect, useRef, useState } from 'react'
import type { TypeDef } from '@shared/model'
import { loadPref, savePref } from '../lib/hooks'
import type { ConnectOptions } from '../lib/serverLibrary'
import { isDark, PALETTES, type ThemeMode, type ThemeSettings } from '../lib/theme'

export function Modal({
  title,
  onClose,
  children,
  wide
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirmer',
  danger,
  onAnswer
}: {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onAnswer: (ok: boolean) => void
}) {
  return (
    <Modal title={title} onClose={() => onAnswer(false)}>
      <p className="modal-text">{message}</p>
      <div className="modal-actions">
        <button className="btn ghost" onClick={() => onAnswer(false)}>
          Annuler
        </button>
        <button className={`btn ${danger ? 'danger-solid' : 'primary'}`} autoFocus onClick={() => onAnswer(true)}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}

export function NewDocModal({
  types,
  parentTitle,
  where,
  onCreate,
  onManageTypes,
  onClose
}: {
  types: TypeDef[]
  parentTitle: string | null
  where: string
  onCreate: (typeId: string, title: string) => Promise<void>
  onManageTypes: () => void
  onClose: () => void
}) {
  const [typeId, setTypeId] = useState(types[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!typeId) return
    setBusy(true)
    try {
      await onCreate(typeId, title.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <Modal title={parentTitle ? `Nouvelle sous-fiche de « ${parentTitle} »` : 'Nouvelle fiche'} onClose={onClose}>
      <p className="muted small">Dans : {where}</p>
      {types.length === 0 ? (
        <>
          <p className="modal-text">Il faut d'abord au moins un type (Personnage, Lieu…).</p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={onClose}>
              Fermer
            </button>
            <button className="btn primary" onClick={onManageTypes}>
              Gérer les types
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={submit}>
          <label className="form-row">
            <span>Titre</span>
            <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sans titre" />
          </label>
          <div className="form-row">
            <span>Type</span>
            <div className="type-grid">
              {types.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  className={`type-choice ${t.id === typeId ? 'on' : ''}`}
                  onClick={() => setTypeId(t.id)}
                >
                  <strong>{t.name}</strong>
                  <span className="muted small">
                    {t.fields.length} champ{t.fields.length > 1 ? 's' : ''}
                  </span>
                </button>
              ))}
            </div>
          </div>
          {error && <div className="alert">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn primary" disabled={busy || !typeId}>
              Créer
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}

interface SavedConnection {
  host: string
  port: string
  secure?: boolean
  name: string
}

export interface ConnectInitial {
  host: string
  port: number
  secure?: boolean
  name: string
  error?: string
}

export function ConnectModal({
  initial,
  onConnect,
  onClose
}: {
  initial?: ConnectInitial
  onConnect: (opts: ConnectOptions, rememberPassword: boolean) => Promise<void>
  onClose: () => void
}) {
  const saved = loadPref<SavedConnection>('kotari.connection', { host: '', port: '4321', name: '' })
  const [host, setHost] = useState(initial?.host ?? saved.host)
  const [port, setPort] = useState(initial ? String(initial.port) : saved.port)
  const [secure, setSecure] = useState(initial?.secure ?? saved.secure ?? false)
  const portTouched = useRef(false)

  // Un nom de domaine passe par HTTPS (port 443) ; une adresse IP du réseau local, non.
  const onHost = (v: string) => {
    setHost(v)
    const h = v.trim().replace(/^(https|wss):\/\//, '')
    const isDomain = /[a-z]/i.test(h) && h.includes('.') && !/^localhost$/i.test(h)
    if (/^(https|wss):\/\//.test(v.trim()) || isDomain) {
      setSecure(true)
      if (!portTouched.current) setPort('443')
    } else if (/^[\d.]+$/.test(h) || /^localhost$/i.test(h)) {
      setSecure(false)
      if (!portTouched.current && port === '443') setPort('4321')
    }
  }
  const [password, setPassword] = useState('')
  const [name, setName] = useState(initial?.name ?? saved.name)
  const [rememberPw, setRememberPw] = useState(() => loadPref('kotari.rememberPassword', true))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(initial?.error ?? null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const p = Number(port)
    const h = host.trim().replace(/^(wss?|https?):\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '')
    if (!h) return setError("Indique l'adresse du serveur.")
    if (!Number.isInteger(p) || p < 1 || p > 65535) return setError('Port invalide.')
    if (!name.trim()) return setError('Indique ton prénom (affiché à côté de ton curseur).')
    setBusy(true)
    setError(null)
    savePref('kotari.connection', { host: h, port: String(p), secure, name: name.trim() })
    savePref('kotari.rememberPassword', rememberPw)
    try {
      await onConnect({ host: h, port: p, secure, password, name: name.trim() }, rememberPw)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <Modal title="Se connecter à un serveur" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label className="form-row">
            <span>Adresse</span>
            <input
              className="input"
              autoFocus={!host}
              value={host}
              onChange={(e) => onHost(e.target.value)}
              placeholder="kotari.mondomaine.fr ou 192.168.1.20"
            />
          </label>
          <label className="form-row port">
            <span>Port</span>
            <input
              className="input"
              value={port}
              onChange={(e) => {
                portTouched.current = true
                setPort(e.target.value)
              }}
              inputMode="numeric"
            />
          </label>
        </div>
        <label className="form-row">
          <span>Mot de passe</span>
          <input className="input" type="password" autoFocus={!!host} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label className="form-row">
          <span>Ton prénom</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Affiché à côté de ton curseur" />
        </label>
        <label className="check small">
          <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} />
          Connexion sécurisée (HTTPS) : pour un serveur sur Internet avec un nom de domaine
        </label>
        <label className="check small">
          <input type="checkbox" checked={rememberPw} onChange={(e) => setRememberPw(e.target.checked)} />
          Retenir le mot de passe (chiffré avec ton compte Windows)
        </label>
        {error && <div className="alert">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Connexion…' : 'Se connecter'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function VersionSection() {
  const [version, setVersion] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  useEffect(() => {
    void window.kotari.appVersion().then(setVersion)
  }, [])
  const check = async () => {
    setStatus('Recherche…')
    const r = await window.kotari.checkUpdate()
    setStatus(
      r === 'available'
        ? 'Une nouvelle version se télécharge. Un bouton « Redémarrer » apparaîtra en bas à gauche.'
        : r === 'none'
          ? 'Tu as la dernière version.'
          : r === 'dev'
            ? 'Mises à jour désactivées en mode développement.'
            : 'Impossible de joindre GitHub pour le moment.'
    )
  }
  return (
    <>
      <h3 className="settings-h">Version</h3>
      <div className="version-row">
        <span>Kotari {version}</span>
        <button className="btn small" onClick={check}>
          Rechercher une mise à jour
        </button>
        {status && <span className="muted small">{status}</span>}
      </div>
    </>
  )
}

export function SettingsModal({
  theme,
  onTheme,
  onClose
}: {
  theme: ThemeSettings
  onTheme: (t: ThemeSettings) => void
  onClose: () => void
}) {
  const modes: [ThemeMode, string][] = [
    ['light', 'Clair'],
    ['dark', 'Sombre'],
    ['system', 'Comme Windows']
  ]
  const dark = isDark(theme)
  return (
    <Modal title="Réglages" onClose={onClose} wide>
      <h3 className="settings-h">Apparence</h3>
      <div className="tabs inline">
        {modes.map(([m, label]) => (
          <button key={m} className={`tab ${theme.mode === m ? 'on' : ''}`} onClick={() => onTheme({ ...theme, mode: m })}>
            {label}
          </button>
        ))}
      </div>

      <h3 className="settings-h">Couleur d'accent</h3>
      <div className="swatches">
        {PALETTES.map((p) => (
          <button
            key={p.id}
            className={`swatch ${theme.palette === p.id ? 'on' : ''}`}
            onClick={() => onTheme({ ...theme, palette: p.id })}
            title={p.name}
          >
            <span className="swatch-dot" style={{ background: dark ? p.dark : p.light }} />
            {p.name}
          </button>
        ))}
        <label className={`swatch ${theme.palette === 'custom' ? 'on' : ''}`} title="Couleur personnalisée">
          <input
            type="color"
            value={theme.custom}
            onChange={(e) => onTheme({ ...theme, palette: 'custom', custom: e.target.value })}
            onClick={() => theme.palette !== 'custom' && onTheme({ ...theme, palette: 'custom' })}
          />
          Perso
        </label>
      </div>

      <h3 className="settings-h">Mise en forme du texte riche</h3>
      <p className="muted small">Pas de barre d'outils : tape directement ces raccourcis au début d'une ligne ou autour d'un mot.</p>
      <table className="md-help">
        <tbody>
          <tr><td><code># </code> <code>## </code> <code>### </code></td><td>Titre, sous-titre…</td></tr>
          <tr><td><code>**gras**</code> ou Ctrl+B</td><td><strong>gras</strong></td></tr>
          <tr><td><code>*italique*</code> ou Ctrl+I</td><td><em>italique</em></td></tr>
          <tr><td><code>~~barré~~</code></td><td><s>barré</s></td></tr>
          <tr><td><code>`code`</code></td><td><code>code</code></td></tr>
          <tr><td><code>- </code> ou <code>* </code></td><td>Liste à puces</td></tr>
          <tr><td><code>1. </code></td><td>Liste numérotée</td></tr>
          <tr><td><code>&gt; </code></td><td>Citation</td></tr>
          <tr><td><code>---</code></td><td>Ligne de séparation</td></tr>
          <tr><td>Ctrl+Z / Ctrl+Y</td><td>Annuler / rétablir</td></tr>
        </tbody>
      </table>

      <VersionSection />

      <h3 className="settings-h">Raccourcis</h3>
      <table className="md-help">
        <tbody>
          <tr><td>Ctrl+F</td><td>Rechercher dans la fiche (et ses sous-fiches)</td></tr>
          <tr><td>Ctrl+Maj+F</td><td>Rechercher dans tout le projet et sur le serveur</td></tr>
          <tr><td>Ctrl+W · clic molette</td><td>Fermer l'onglet</td></tr>
          <tr><td>Ctrl+clic sur un lien</td><td>Ouvrir dans un nouvel onglet</td></tr>
          <tr><td>Glisser une fiche sur un bord</td><td>L'afficher à côté (gauche, droite, haut, bas)</td></tr>
        </tbody>
      </table>
      <div className="modal-actions">
        <button className="btn primary" onClick={onClose}>
          Fermer
        </button>
      </div>
    </Modal>
  )
}
