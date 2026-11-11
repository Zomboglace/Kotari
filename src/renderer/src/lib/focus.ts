// Aller à une occurrence de recherche : chaque champ affiché s'enregistre sous
// la clé "<docId>|<chemin>" et sait sélectionner la n-ième occurrence d'un texte.

export type Focuser = (query: string, nth: number) => boolean

const registry = new Map<string, Focuser>()
let pending: { key: string; query: string; nth: number; at: number } | null = null

export const focusKey = (docId: string, path: string) => `${docId}|${path}`

export function registerFocus(key: string, fn: Focuser): () => void {
  registry.set(key, fn)
  if (pending && pending.key === key && Date.now() - pending.at < 10_000) {
    const p = pending
    // Laisse le temps à l'éditeur de s'afficher.
    setTimeout(() => {
      if (pending === p && fn(p.query, p.nth)) pending = null
    }, 120)
  }
  return () => {
    if (registry.get(key) === fn) registry.delete(key)
  }
}

/** Va à l'occurrence si le champ est affiché, sinon la garde en attente (fiche en cours d'ouverture). */
export function requestFocus(key: string, query: string, nth: number): boolean {
  const fn = registry.get(key)
  if (fn && fn(query, nth)) {
    pending = null
    return true
  }
  pending = { key, query, nth, at: Date.now() }
  return false
}

export function flash(el: Element | null) {
  const target = el?.closest('.field, .sub, .title-row, .card-title') ?? el
  if (!target) return
  target.classList.remove('flash')
  void (target as HTMLElement).offsetWidth
  target.classList.add('flash')
  setTimeout(() => target.classList.remove('flash'), 1600)
}
