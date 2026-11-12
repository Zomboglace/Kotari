import { useState } from 'react'

export interface RecentProject {
  path: string
  name: string
}

export function Welcome({
  recents,
  onCreate,
  onOpen,
  onOpenRecent,
  onForget,
  onConnect,
  connected
}: {
  recents: RecentProject[]
  onCreate: (name: string, withTemplates: boolean) => Promise<void>
  onOpen: () => Promise<void>
  onOpenRecent: (r: RecentProject) => Promise<void>
  onForget: (r: RecentProject) => void
  onConnect: () => void
  connected: boolean
}) {
  const [name, setName] = useState('')
  const [withTemplates, setWithTemplates] = useState(true)

  return (
    <div className="welcome">
      <div className="welcome-brand">
        <h1>Kotari</h1>
        <p className="muted">Fiches imbriquées pour tes mondes, tes personnages et leurs inventaires.</p>
      </div>

      <div className="welcome-grid">
        <section className="card">
          <h2>Nouveau projet</h2>
          <p className="muted small">Un projet est un dossier sur ton ordinateur.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim()) void onCreate(name.trim(), withTemplates)
            }}
          >
            <input
              className="input"
              placeholder="Nom du projet (ex. Mon monde)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <label className="check">
              <input type="checkbox" checked={withTemplates} onChange={(e) => setWithTemplates(e.target.checked)} />
              Inclure les modèles Note, Lieu, Personnage, Inventaire
            </label>
            <button className="btn primary" type="submit" disabled={!name.trim()}>
              Choisir l'emplacement et créer
            </button>
          </form>
        </section>

        <section className="card">
          <h2>Ouvrir</h2>
          <button className="btn" onClick={() => void onOpen()}>
            Ouvrir un dossier de projet…
          </button>
          {recents.length > 0 && (
            <>
              <h3>Récents</h3>
              <ul className="recents">
                {recents.map((r) => (
                  <li key={r.path}>
                    <button className="recent" onClick={() => void onOpenRecent(r)} title={r.path}>
                      <strong>{r.name}</strong>
                      <span className="muted small">{r.path}</span>
                    </button>
                    <button className="icon-btn" title="Retirer de la liste" onClick={() => onForget(r)}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {!connected && (
          <section className="card">
            <h2>Serveur</h2>
            <p className="muted small">
              Pour éditer à plusieurs, connecte-toi à un kotari-server de ton réseau local. Tu peux le faire avec ou sans
              projet local ouvert.
            </p>
            <button className="btn" onClick={onConnect}>
              Se connecter à un serveur…
            </button>
          </section>
        )}
      </div>
    </div>
  )
}

export function ProjectHome({
  name,
  docCount,
  typeCount,
  connected,
  onNew,
  onTypes,
  onReveal
}: {
  name: string
  docCount: number
  typeCount: number
  connected: boolean
  onNew: () => void
  onTypes: () => void
  onReveal: () => void
}) {
  return (
    <div className="welcome">
      <div className="welcome-brand">
        <h1>{name}</h1>
        <p className="muted">
          {docCount} fiche{docCount > 1 ? 's' : ''} · {typeCount} type{typeCount > 1 ? 's' : ''}
        </p>
      </div>
      <div className="welcome-actions">
        <button className="btn primary" onClick={onNew}>
          + Nouvelle fiche
        </button>
        <button className="btn" onClick={onTypes}>
          Gérer les types
        </button>
        <button className="btn ghost" onClick={onReveal}>
          Ouvrir le dossier
        </button>
      </div>
      <ul className="tips muted">
        <li>Glisse une fiche sur une autre pour en faire une sous-fiche, ou entre deux fiches pour la réordonner.</li>
        <li>Chaque fiche peut contenir des sous-fiches : un Inventaire sous un Personnage, des Lieux sous une Région…</li>
        {connected ? (
          <li>Glisse une fiche de l’arbre local vers l’arbre serveur (ou l’inverse) pour en faire une copie, sous-fiches comprises.</li>
        ) : (
          <li>Connecte-toi à un serveur pour partager des fiches et les éditer à plusieurs en temps réel.</li>
        )}
        <li>
          Glisse une fiche de l’arbre sur la zone principale : au centre elle s’ouvre dans un onglet, sur un bord elle
          s’affiche à côté de la fiche actuelle (gauche, droite, haut ou bas). Les onglets se glissent de la même façon.
        </li>
        <li>Ctrl+W ferme l’onglet, clic molette aussi ; Ctrl+clic sur un lien ouvre un nouvel onglet.</li>
        <li>Tout est enregistré automatiquement.</li>
      </ul>
    </div>
  )
}
