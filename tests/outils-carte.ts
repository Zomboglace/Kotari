// Outils pour les tests des cartes et des dossiers (en plus de ./outils).

import type { TestContext } from 'node:test'
import { newFolder, newMap } from '@shared/documents'
import type { MapSession, MapView } from '@shared/carte/session'
import type { Cell, LightLevel, Token } from '@shared/carte/types'
import { aLaFin, attendre, type Client } from './outils'

/** Crée un dossier et renvoie son identifiant. */
export async function creerDossier(client: Client, titre: string, parentId: string | null = null): Promise<string> {
  const { meta, content } = newFolder(titre, parentId, client.getState().docs.length + 1)
  await client.createDoc(meta, content)
  return meta.id
}

/** Crée une carte et renvoie son identifiant. */
export async function creerCarte(
  client: Client,
  titre: string,
  options: { width?: number; height?: number; background?: string | null; ambient?: LightLevel; parentId?: string | null } = {}
): Promise<string> {
  const { parentId = null, ...reste } = options
  const { meta, content } = newMap(titre, parentId, client.getState().docs.length + 1, reste)
  await client.createDoc(meta, content)
  return meta.id
}

/** Ouvre une carte ; elle est refermée automatiquement à la fin du test. */
export async function ouvrirCarte(t: TestContext, client: Client, id: string): Promise<MapSession> {
  const session = await client.openMap(id)
  aLaFin(t, () => session.close())
  return session
}

export function vue(session: MapSession): MapView {
  return session.getView()
}

/** Le token tel que cette session le voit, ou undefined s'il ne lui est pas envoyé. */
export function tokenVu(session: MapSession, tokenId: string): Token | undefined {
  return vue(session).map.tokens.find((t) => t.id === tokenId)
}

/** Attend que le token soit (ou ne soit plus) visible dans la session. */
export async function attendreToken(session: MapSession, tokenId: string, present: boolean, quoi: string) {
  await attendre(() => (tokenVu(session, tokenId) !== undefined) === present, quoi)
}

/** Attend que le token soit arrivé sur une case, vu depuis cette session. */
export async function attendreCase(session: MapSession, tokenId: string, cell: Cell, quoi: string) {
  await attendre(() => {
    const t = tokenVu(session, tokenId)
    return !!t && t.cell.x === cell.x && t.cell.y === cell.y
  }, quoi)
}
