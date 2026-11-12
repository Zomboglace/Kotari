// Tests d'interface : les composants React affichés dans un faux navigateur
// (happy-dom), manipulés comme le ferait un utilisateur (clic, clic droit, clavier).
//
// Le contrat est décrit dans docs/carte-api.md (section 6).
// Lancer : npm test

import './dom' // doit rester le premier import
import assert from 'node:assert/strict'
import { afterEach, describe, mock, test } from 'node:test'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { emptyFog } from '@shared/carte/fog'
import type { MapView } from '@shared/carte/session'
import { newToken } from '@shared/carte/tokens'
import type { MapData, Token } from '@shared/carte/types'
import type { DocMeta } from '@shared/model'
import { TEMPLATES } from '@shared/templates'
import { NewDocModal } from '../src/renderer/src/components/Modals'
import { MapBoard } from '../src/renderer/src/components/carte/MapBoard'
import { NewTokenDialog } from '../src/renderer/src/components/carte/NewTokenDialog'

afterEach(() => cleanup())

// ─── Petits outils ────────────────────────────────────────────────────────

function carte(largeur: number, hauteur: number, reste: Partial<MapData> = {}): MapData {
  return { width: largeur, height: hauteur, background: null, ambient: 'bright', zones: {}, walls: [], lights: [], tokens: [], fog: emptyFog(), ...reste }
}

function toutesLesCases(map: MapData): string[] {
  const cles: string[] = []
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) cles.push(`${x},${y}`)
  return cles
}

const vueProprietaire = (map: MapData): MapView => ({ role: 'owner', map, visible: toutesLesCases(map) })
const vueJoueur = (map: MapData, visible: string[]): MapView => ({ role: 'player', map, visible })

/** L'élément SVG d'un token. */
function elementDuToken(container: HTMLElement, token: Token): HTMLElement {
  const el = container.querySelector(`[data-token-id="${token.id}"]`)
  assert.ok(el, `le token ${token.name} doit être affiché`)
  return el as HTMLElement
}

const rienAFaire = () => {}
const deplacementAccepte = async () => {}

// ─── Création de documents ────────────────────────────────────────────────

describe('Fenêtre « Nouveau document »', () => {
  function afficher() {
    const onCreate = mock.fn(async (_kind: string, _typeId: string | null, _title: string) => {})
    render(
      <NewDocModal types={TEMPLATES} parentTitle={null} where="test" onCreate={onCreate} onManageTypes={rienAFaire} onClose={rienAFaire} />
    )
    return onCreate
  }

  test('propose Fiche, Carte et Dossier, avec Fiche par défaut', async () => {
    const onCreate = afficher()
    for (const choix of ['Fiche', 'Carte', 'Dossier']) screen.getByRole('button', { name: choix })

    fireEvent.change(screen.getByLabelText('Titre'), { target: { value: 'Aragorn' } })
    fireEvent.click(screen.getByRole('button', { name: 'Créer' }))

    await waitFor(() => assert.equal(onCreate.mock.callCount(), 1))
    assert.deepEqual(onCreate.mock.calls[0].arguments, ['sheet', TEMPLATES[0].id, 'Aragorn'])
  })

  test('crée une carte ou un dossier, sans type de fiche', async () => {
    for (const [choix, genre, titre] of [['Carte', 'map', 'Donjon'], ['Dossier', 'folder', 'Archives']]) {
      const onCreate = afficher()
      fireEvent.click(screen.getByRole('button', { name: choix }))
      fireEvent.change(screen.getByLabelText('Titre'), { target: { value: titre } })
      fireEvent.click(screen.getByRole('button', { name: 'Créer' }))

      await waitFor(() => assert.equal(onCreate.mock.callCount(), 1))
      assert.deepEqual(onCreate.mock.calls[0].arguments, [genre, null, titre])
      cleanup()
    }
  })
})

// ─── La carte ─────────────────────────────────────────────────────────────

describe('Affichage de la carte', () => {
  test('la carte est dessinée en SVG, avec un élément par token', () => {
    const aragorn = newToken({ name: 'Aragorn', cell: { x: 1, y: 1 } })
    const gobelin = newToken({ name: 'Gobelin', cell: { x: 3, y: 2 } })
    const { container } = render(
      <MapBoard view={vueProprietaire(carte(10, 10, { tokens: [aragorn, gobelin] }))} onMoveToken={deplacementAccepte} onOpenSheet={rienAFaire} />
    )

    assert.ok(container.querySelector('svg'), 'un <svg>')
    assert.equal(container.querySelector('canvas'), null, 'pas de <canvas>')
    assert.equal(container.querySelectorAll('[data-token-id]').length, 2)
    assert.equal(elementDuToken(container, aragorn).getAttribute('data-cell'), '1,1')
    assert.equal(elementDuToken(container, gobelin).getAttribute('aria-label'), 'Gobelin')
  })

  test('en vue joueur, les cases non visibles sont dans le brouillard et leurs tokens ne sont pas affichés', () => {
    const heros = newToken({ name: 'Héros', cell: { x: 0, y: 0 }, player: 'Bob' })
    const monstre = newToken({ name: 'Monstre', cell: { x: 3, y: 3 } })
    const map = carte(4, 4, { tokens: [heros, monstre], fog: { explored: { Bob: ['2,0'] }, revealed: [] } })
    const { container } = render(
      <MapBoard view={vueJoueur(map, ['0,0', '1,0'])} onMoveToken={deplacementAccepte} onOpenSheet={rienAFaire} />
    )

    assert.equal(container.querySelectorAll('[data-fog]').length, 14, '16 cases − 2 visibles')
    assert.ok(container.querySelector('[data-fog="explored"][data-cell="2,0"]'), 'la case déjà vue est « explorée »')
    assert.ok(container.querySelector('[data-fog="hidden"][data-cell="3,3"]'), 'la case jamais vue est « cachée »')
    assert.equal(container.querySelector('[data-fog][data-cell="0,0"]'), null, 'pas de brouillard sur une case visible')
    assert.equal(container.querySelector(`[data-token-id="${monstre.id}"]`), null, 'le monstre n’est pas dans la page')
    elementDuToken(container, heros)
  })

  test('le propriétaire peut voir la carte comme un joueur', async () => {
    const heros = newToken({ name: 'Héros', cell: { x: 0, y: 0 }, player: 'Bob' })
    const monstre = newToken({ name: 'Monstre', cell: { x: 3, y: 0 } })
    const map = carte(4, 4, {
      tokens: [heros, monstre],
      walls: [{ id: 'mur', from: { x: 2, y: 0 }, to: { x: 2, y: 4 } }]
    })
    const onViewAsChange = mock.fn((_joueur: string | null) => {})
    const props = { view: vueProprietaire(map), onMoveToken: deplacementAccepte, onOpenSheet: rienAFaire, onViewAsChange }

    const { container, rerender } = render(<MapBoard {...props} viewAs={null} />)
    const liste = screen.getByLabelText('Voir comme') as HTMLSelectElement
    const options = [...liste.options].map((o) => o.textContent)
    assert.deepEqual(options, ['Tout voir', 'Bob'])

    const optionBob = [...liste.options].find((o) => o.textContent === 'Bob')!
    fireEvent.change(liste, { target: { value: optionBob.value } })
    assert.deepEqual(onViewAsChange.mock.calls[0].arguments, ['Bob'])

    rerender(<MapBoard {...props} viewAs="Bob" />)
    elementDuToken(container, heros)
    assert.equal(container.querySelector(`[data-token-id="${monstre.id}"]`), null, 'Bob ne voit pas derrière le mur')
    assert.ok(container.querySelector('[data-fog][data-cell="3,0"]'))
  })

  test('« Voir comme » n’existe pas pour un joueur', () => {
    const heros = newToken({ name: 'Héros', cell: { x: 0, y: 0 }, player: 'Bob' })
    render(<MapBoard view={vueJoueur(carte(2, 2, { tokens: [heros] }), ['0,0'])} onMoveToken={deplacementAccepte} onOpenSheet={rienAFaire} />)
    assert.equal(screen.queryByLabelText('Voir comme'), null)
  })
})

describe('Clic droit sur un token', () => {
  const gobelin = newToken({ name: 'Gobelin', cell: { x: 1, y: 1 }, sheetId: 'fiche-gobelin' })
  const hpOf = () => ({ current: 7, max: 12 })

  test('pour le propriétaire : un menu avec le nom, les PV et « Ouvrir la fiche »', () => {
    const onOpenSheet = mock.fn((_id: string) => {})
    const { container } = render(
      <MapBoard view={vueProprietaire(carte(5, 5, { tokens: [gobelin] }))} onMoveToken={deplacementAccepte} onOpenSheet={onOpenSheet} hpOf={hpOf} />
    )

    fireEvent.contextMenu(elementDuToken(container, gobelin))

    const menu = screen.getByRole('menu')
    within(menu).getByText('Gobelin')
    within(menu).getByText('PV 7 / 12')
    fireEvent.click(within(menu).getByRole('button', { name: 'Ouvrir la fiche' }))
    assert.deepEqual(onOpenSheet.mock.calls[0].arguments, ['fiche-gobelin'])
  })

  test('pour un joueur : rien, même si le token est visible', () => {
    const onOpenSheet = mock.fn((_id: string) => {})
    const { container } = render(
      <MapBoard view={vueJoueur(carte(5, 5, { tokens: [gobelin] }), ['1,1'])} onMoveToken={deplacementAccepte} onOpenSheet={onOpenSheet} hpOf={hpOf} />
    )

    fireEvent.contextMenu(elementDuToken(container, gobelin))

    assert.equal(screen.queryByRole('menu'), null)
    assert.equal(onOpenSheet.mock.callCount(), 0)
  })
})

describe('Déplacement au clavier', () => {
  test('les flèches demandent le déplacement vers la case voisine', () => {
    const heros = newToken({ name: 'Héros', cell: { x: 1, y: 1 } })
    const onMoveToken = mock.fn(async (_id: string, _vers: { x: number; y: number }) => {})
    const { container } = render(
      <MapBoard view={vueProprietaire(carte(5, 5, { tokens: [heros] }))} onMoveToken={onMoveToken} onOpenSheet={rienAFaire} />
    )

    const el = elementDuToken(container, heros)
    assert.equal(el.getAttribute('tabindex'), '0', 'le token peut recevoir le focus')
    el.focus()
    fireEvent.keyDown(el, { key: 'ArrowRight' })
    fireEvent.keyDown(el, { key: 'ArrowDown' })

    assert.deepEqual(onMoveToken.mock.calls[0].arguments, [heros.id, { x: 2, y: 1 }])
    assert.deepEqual(onMoveToken.mock.calls[1].arguments, [heros.id, { x: 1, y: 2 }])
  })

  test('un déplacement refusé ne change rien à l’affichage et affiche un message', async () => {
    const heros = newToken({ name: 'Héros', cell: { x: 1, y: 1 } })
    const refuse = async () => {
      throw new Error('Un mur bloque le passage.')
    }
    const { container } = render(
      <MapBoard view={vueProprietaire(carte(5, 5, { tokens: [heros] }))} onMoveToken={refuse} onOpenSheet={rienAFaire} />
    )

    fireEvent.keyDown(elementDuToken(container, heros), { key: 'ArrowRight' })

    await waitFor(() => screen.getByRole('alert'))
    assert.equal(elementDuToken(container, heros).getAttribute('data-cell'), '1,1')
  })
})

describe('Fenêtre « Nouveau token »', () => {
  const gobelin: DocMeta = { id: 'fiche-gobelin', title: 'Gobelin', typeId: 'modele-personnage', parentId: null, order: 1 }

  function afficher() {
    const onCreate = mock.fn(async (_input: unknown) => {})
    render(<NewTokenDialog sheets={[gobelin]} cell={{ x: 2, y: 3 }} onCreate={onCreate} onClose={rienAFaire} />)
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Gobelin 1' } })
    fireEvent.change(screen.getByLabelText('Fiche'), { target: { value: gobelin.id } })
    return onCreate
  }

  test('« Copie indépendante » est choisi par défaut', async () => {
    const onCreate = afficher()
    assert.equal((screen.getByRole('radio', { name: 'Copie indépendante' }) as HTMLInputElement).checked, true)
    assert.equal((screen.getByRole('radio', { name: 'Lien vers la fiche' }) as HTMLInputElement).checked, false)

    fireEvent.click(screen.getByRole('button', { name: 'Créer' }))

    await waitFor(() => assert.equal(onCreate.mock.callCount(), 1))
    const demande = onCreate.mock.calls[0].arguments[0] as Record<string, unknown>
    assert.equal(demande.name, 'Gobelin 1')
    assert.deepEqual(demande.cell, { x: 2, y: 3 })
    assert.equal(demande.sheetId, gobelin.id)
    assert.equal(demande.sheetMode, 'copy')
  })

  test('on peut choisir un lien vers la fiche d’origine', async () => {
    const onCreate = afficher()
    fireEvent.click(screen.getByRole('radio', { name: 'Lien vers la fiche' }))
    fireEvent.click(screen.getByRole('button', { name: 'Créer' }))

    await waitFor(() => assert.equal(onCreate.mock.callCount(), 1))
    assert.equal((onCreate.mock.calls[0].arguments[0] as Record<string, unknown>).sheetMode, 'link')
  })
})
