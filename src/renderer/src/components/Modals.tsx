import { useEffect, useState } from 'react'
import type { TypeDef } from '@shared/model'
import { loadPref, savePref } from '../lib/hooks'
import type { ConnectOptions } from '../lib/serverLibrary'

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
  name: string
}

export function ConnectModal({
  onConnect,
  onClose
}: {
  onConnect: (opts: ConnectOptions) => Promise<void>
  onClose: () => void
}) {
  const saved = loadPref<SavedConnection>('kotari.connection', { host: '', port: '4321', name: '' })
  const [host, setHost] = useState(saved.host)
  const [port, setPort] = useState(saved.port)
  const [password, setPassword] = useState('')
  const [name, setName] = useState(saved.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const p = Number(port)
    const h = host.trim().replace(/^wss?:\/\//, '').replace(/\/.*$/, '')
    if (!h) return setError("Indique l'adresse du serveur.")
    if (!Number.isInteger(p) || p < 1 || p > 65535) return setError('Port invalide.')
    if (!name.trim()) return setError('Indique ton prénom (affiché à côté de ton curseur).')
    setBusy(true)
    setError(null)
    // Le mot de passe n'est jamais mémorisé.
    savePref('kotari.connection', { host: h, port: String(p), name: name.trim() })
    try {
      await onConnect({ host: h, port: p, password, name: name.trim() })
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
            <input className="input" autoFocus={!host} value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.20" />
          </label>
          <label className="form-row port">
            <span>Port</span>
            <input className="input" value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" />
          </label>
        </div>
        <label className="form-row">
          <span>Mot de passe</span>
          <input
            className="input"
            type="password"
            autoFocus={!!host}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="form-row">
          <span>Ton prénom</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Affiché à côté de ton curseur" />
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
