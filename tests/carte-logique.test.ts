// Tests de la logique des cartes : grille, murs, vue, lumière, brouillard,
// tokens et permissions. Aucun serveur : des fonctions pures sur des données.
//
// Le contrat (noms, règles) est décrit dans docs/carte-api.md.
// Lancer : npm test

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { collectImages } from '@shared/content'
import { docKind } from '@shared/model'
import { newMap } from '@shared/documents'
import { canMove, isBlocked } from '@shared/carte/walls'
import { cellDistanceFeet, cellKey, FEET_PER_CELL, isInsideGrid, parseCellKey, resizeGrid, tokenCenter } from '@shared/carte/grid'
import { DEFAULT_DARKVISION, LIGHT_PRESETS, lightLevel, perceivedLight } from '@shared/carte/light'
import { canSee, visibleCells, visibleCellsFor } from '@shared/carte/vision'
import { cellState, emptyFog, recordExplored, setRevealed } from '@shared/carte/fog'
import { newToken, type NewTokenInput } from '@shared/carte/tokens'
import { can, type MapAction } from '@shared/carte/permissions'
import type { LightLevel, LightSource, MapData, Token, Wall } from '@shared/carte/types'

// ─── Petits outils pour construire des cartes de test ────────────────────

/** Une carte vide, en plein jour, sans mur ni token. */
function carte(largeur: number, hauteur: number, reste: Partial<MapData> = {}): MapData {
  return {
    width: largeur,
    height: hauteur,
    background: null,
    ambient: 'bright',
    zones: {},
    walls: [],
    lights: [],
    tokens: [],
    fog: emptyFog(),
    ...reste
  }
}

/** Un token à la case (x, y). */
function token(nom: string, x: number, y: number, reste: Partial<NewTokenInput> = {}): Token {
  return newToken({ name: nom, cell: { x, y }, ...reste })
}

/** Un mur entre deux coins de la grille. */
function mur(x1: number, y1: number, x2: number, y2: number, porte?: 'open' | 'closed'): Wall {
  return { id: `mur-${x1}-${y1}-${x2}-${y2}`, from: { x: x1, y: y1 }, to: { x: x2, y: y2 }, ...(porte ? { door: porte } : {}) }
}

/** Une source de lumière posée sur la case (x, y). */
function lumiere(x: number, y: number, vive: number, faible: number): LightSource {
  return { id: `lumiere-${x}-${y}`, cell: { x, y }, bright: vive, dim: faible }
}

const c = (x: number, y: number) => ({ x, y })

// ─── 2. Carte et grille ───────────────────────────────────────────────────

describe('Carte et grille', () => {
  test('une nouvelle carte est un document de genre « carte », 20 × 20 par défaut', () => {
    const { meta } = newMap('Donjon', null, 1)
    assert.equal(meta.title, 'Donjon')
    assert.equal(docKind(meta), 'map')
  })

  test('une case vaut 5 pieds et les distances se mesurent de centre à centre', () => {
    assert.equal(FEET_PER_CELL, 5)
    assert.equal(cellDistanceFeet(c(0, 0), c(3, 0)), 15, 'trois cases en ligne droite')
    assert.equal(cellDistanceFeet(c(2, 1), c(2, 5)), 20, 'quatre cases à la verticale')
    assert.ok(Math.abs(cellDistanceFeet(c(0, 0), c(1, 1)) - 5 * Math.SQRT2) < 1e-9, 'une diagonale vaut 5 × √2 pieds')
    assert.equal(cellKey(c(3, 4)), '3,4')
    assert.deepEqual(parseCellKey('3,4'), c(3, 4))
  })

  test('changer la taille de la grille ramène les tokens à l’intérieur', () => {
    const petit = token('Gobelin', 8, 8)
    const grand = token('Ogre', 7, 0, { size: 2 })
    const avant = carte(10, 10, { tokens: [petit, grand] })

    const apres = resizeGrid(avant, 6, 6)

    assert.equal(apres.width, 6)
    assert.equal(apres.height, 6)
    for (const t of apres.tokens) {
      assert.ok(isInsideGrid(apres, t.cell, t.size), `${t.name} doit être entièrement dans la grille`)
    }
    assert.equal(avant.width, 10, 'la carte d’origine n’est pas modifiée')
  })

  test('un token a une case, une taille, un joueur facultatif et des réglages de vision', () => {
    const t = newToken({ name: 'Aragorn', cell: c(2, 3) })
    assert.ok(t.id, 'un identifiant est généré')
    assert.notEqual(newToken({ name: 'Aragorn', cell: c(2, 3) }).id, t.id, 'chaque token a son propre identifiant')
    assert.deepEqual(t.cell, c(2, 3))
    assert.equal(t.size, 1)
    assert.equal(t.player, null)
    assert.deepEqual(t.vision, { range: null, darkvision: 0 })
    assert.equal(t.light, null)
    assert.equal(t.sheetId, null)
    assert.equal(t.sheetMode, null)

    const ogre = newToken({ name: 'Ogre', cell: c(2, 3), size: 2 })
    assert.deepEqual(tokenCenter(ogre), { x: 3, y: 4 }, 'centre d’un token de 2 × 2 cases')
    assert.deepEqual(tokenCenter(t), { x: 2.5, y: 3.5 }, 'centre d’un token d’une case')
  })
})

// ─── 3. Murs, portes et déplacement ───────────────────────────────────────

describe('Murs et déplacements', () => {
  test('sans mur, un token se déplace librement', () => {
    const aragorn = token('Aragorn', 1, 1)
    assert.equal(canMove(carte(10, 10, { tokens: [aragorn] }), aragorn.id, c(5, 5)), true)
  })

  test('un token ne peut pas traverser un mur', () => {
    const aragorn = token('Aragorn', 1, 1)
    const map = carte(10, 10, { tokens: [aragorn], walls: [mur(3, 0, 3, 10)] })
    assert.equal(canMove(map, aragorn.id, c(5, 1)), false, 'de l’autre côté du mur')
    assert.equal(canMove(map, aragorn.id, c(2, 1)), true, 'du même côté du mur')
  })

  test('une porte fermée bloque le passage, une porte ouverte le laisse passer', () => {
    const aragorn = token('Aragorn', 1, 1)
    const fermee = carte(10, 10, { tokens: [aragorn], walls: [mur(3, 0, 3, 10, 'closed')] })
    const ouverte = carte(10, 10, { tokens: [aragorn], walls: [mur(3, 0, 3, 10, 'open')] })
    assert.equal(canMove(fermee, aragorn.id, c(5, 1)), false)
    assert.equal(canMove(ouverte, aragorn.id, c(5, 1)), true)
  })

  test('un token ne peut pas sortir de la grille', () => {
    const aragorn = token('Aragorn', 1, 1)
    const ogre = token('Ogre', 7, 7, { size: 2 })
    const map = carte(10, 10, { tokens: [aragorn, ogre] })
    assert.equal(canMove(map, aragorn.id, c(10, 1)), false)
    assert.equal(canMove(map, aragorn.id, c(-1, 1)), false)
    assert.equal(canMove(map, ogre.id, c(8, 8)), true, 'l’ogre tient encore dans la grille')
    assert.equal(canMove(map, ogre.id, c(9, 8)), false, 'l’ogre dépasserait de la grille')
  })

  test('sans mur, un token voit toutes les cases dans sa portée', () => {
    const myope = token('Myope', 5, 5, { vision: { range: 10 } })
    const map = carte(10, 10, { tokens: [myope] })
    assert.equal(canSee(map, myope.id, c(5, 7)), true, 'à 10 pieds')
    assert.equal(canSee(map, myope.id, c(5, 8)), false, 'à 15 pieds')

    const aigle = token('Aigle', 5, 5)
    const map2 = carte(10, 10, { tokens: [aigle] })
    assert.equal(canSee(map2, aigle.id, c(9, 9)), true, 'portée illimitée')
    assert.equal(visibleCells(map2, aigle.id).length, 100, 'toute la carte')
  })

  test('un mur cache les cases qui sont derrière lui', () => {
    const aragorn = token('Aragorn', 1, 5)
    const map = carte(10, 10, { tokens: [aragorn], walls: [mur(3, 0, 3, 10)] })
    assert.equal(canSee(map, aragorn.id, c(2, 5)), true, 'devant le mur')
    assert.equal(canSee(map, aragorn.id, c(5, 5)), false, 'derrière le mur')
    assert.ok(!visibleCells(map, aragorn.id).includes('5,5'))
  })

  test('une porte fermée bloque la vue, une porte ouverte la laisse passer', () => {
    const aragorn = token('Aragorn', 1, 5)
    const fermee = carte(10, 10, { tokens: [aragorn], walls: [mur(3, 0, 3, 10, 'closed')] })
    const ouverte = carte(10, 10, { tokens: [aragorn], walls: [mur(3, 0, 3, 10, 'open')] })
    assert.equal(canSee(fermee, aragorn.id, c(5, 5)), false)
    assert.equal(canSee(ouverte, aragorn.id, c(5, 5)), true)
  })

  describe('cas limites (le rayon part du centre exact du token)', () => {
    // Le rayon de (1.5, 3.5) vers (4.5, 0.5) passe exactement par le coin (3, 2).
    const depart = { x: 1.5, y: 3.5 }
    const arrivee = { x: 4.5, y: 0.5 }

    test('un rayon qui passe pile au bout d’un mur n’est pas bloqué', () => {
      const aragorn = token('Aragorn', 1, 3)
      const map = carte(10, 10, { tokens: [aragorn], walls: [mur(3, 2, 3, 5)] })
      assert.equal(isBlocked(map, depart, arrivee), false)
      assert.equal(canSee(map, aragorn.id, c(4, 0)), true)
      assert.equal(canSee(map, aragorn.id, c(4, 3)), false, 'juste derrière le mur, c’est bloqué')
    })

    test('un rayon qui passe par le coin où deux murs se rejoignent est bloqué', () => {
      const aragorn = token('Aragorn', 1, 3)
      const map = carte(10, 10, { tokens: [aragorn], walls: [mur(0, 2, 3, 2), mur(3, 2, 3, 5)] })
      assert.equal(isBlocked(map, depart, arrivee), true)
      assert.equal(canSee(map, aragorn.id, c(4, 0)), false)
    })

    test('un token collé contre un mur ne voit pas et ne passe pas au travers', () => {
      const aragorn = token('Aragorn', 2, 4)
      const map = carte(10, 10, { tokens: [aragorn], walls: [mur(3, 0, 3, 10)] })
      assert.equal(canSee(map, aragorn.id, c(3, 4)), false, 'la case juste de l’autre côté')
      assert.equal(canSee(map, aragorn.id, c(2, 0)), true, 'le long du mur, de son côté')
      assert.equal(canMove(map, aragorn.id, c(3, 4)), false)
      assert.equal(canMove(map, aragorn.id, c(2, 3)), true)
    })
  })
})

// ─── 4. Lumière ───────────────────────────────────────────────────────────

describe('Lumière', () => {
  test('les valeurs par défaut sont celles de D&D 5e', () => {
    assert.deepEqual(LIGHT_PRESETS.torch, { bright: 20, dim: 20 })
    assert.deepEqual(LIGHT_PRESETS.lantern, { bright: 30, dim: 30 })
    assert.equal(DEFAULT_DARKVISION, 60)
  })

  test('une torche éclaire en lumière vive puis faible selon la distance', () => {
    const map = carte(20, 20, { ambient: 'dark', lights: [lumiere(10, 10, 20, 20)] })
    const niveaux: Array<[number, LightLevel]> = [
      [10, 'bright'], // sur la torche
      [14, 'bright'], // 20 pieds
      [15, 'dim'], // 25 pieds
      [18, 'dim'], // 40 pieds
      [19, 'dark'] // 45 pieds
    ]
    for (const [x, attendu] of niveaux) {
      assert.equal(lightLevel(map, c(x, 10)), attendu, `case (${x}, 10)`)
    }
  })

  test('les rayons de lumière sont réglables, y compris pour une lumière portée par un token', () => {
    const map = carte(20, 20, { ambient: 'dark', lights: [lumiere(10, 10, 5, 5)] })
    assert.equal(lightLevel(map, c(11, 10)), 'bright', '5 pieds')
    assert.equal(lightLevel(map, c(12, 10)), 'dim', '10 pieds')
    assert.equal(lightLevel(map, c(13, 10)), 'dark', '15 pieds')

    const porteur = token('Porteur de lanterne', 2, 2, { light: { bright: 10, dim: 0 } })
    const map2 = carte(20, 20, { ambient: 'dark', tokens: [porteur] })
    assert.equal(lightLevel(map2, c(4, 2)), 'bright', '10 pieds du porteur')
    assert.equal(lightLevel(map2, c(5, 2)), 'dark', '15 pieds du porteur')
  })

  test('la lumière est bloquée par les murs', () => {
    const map = carte(20, 20, { ambient: 'dark', lights: [lumiere(5, 5, 20, 20)], walls: [mur(7, 0, 7, 20)] })
    assert.equal(lightLevel(map, c(6, 5)), 'bright', 'du côté de la torche')
    assert.equal(lightLevel(map, c(8, 5)), 'dark', 'derrière le mur')
  })

  test('la lumière ambiante s’applique à toute la carte', () => {
    for (const ambiance of ['bright', 'dim', 'dark'] as const) {
      const map = carte(10, 10, { ambient: ambiance })
      assert.equal(lightLevel(map, c(0, 0)), ambiance)
      assert.equal(lightLevel(map, c(9, 9)), ambiance)
    }
  })

  test('le pinceau de zones remplace la lumière ambiante sur les cases peintes', () => {
    const map = carte(10, 10, { ambient: 'bright', zones: { '3,3': 'dark', '4,3': 'dim' } })
    assert.equal(lightLevel(map, c(3, 3)), 'dark', 'entrée de la caverne')
    assert.equal(lightLevel(map, c(4, 3)), 'dim')
    assert.equal(lightLevel(map, c(5, 3)), 'bright', 'dehors, en plein jour')
  })

  test('une source de lumière éclaire quand même l’intérieur d’une zone noire', () => {
    const map = carte(10, 10, { ambient: 'bright', zones: { '3,3': 'dark' }, lights: [lumiere(2, 3, 20, 20)] })
    assert.equal(lightLevel(map, c(3, 3)), 'bright')
  })

  test('dans le noir, seule la vision dans le noir permet de voir (le noir compte comme faible)', () => {
    const humain = token('Humain', 5, 5)
    const nain = token('Nain', 5, 5, { vision: { darkvision: 60 } })
    const nuit = carte(20, 20, { ambient: 'dark', tokens: [humain, nain] })

    assert.equal(canSee(nuit, humain.id, c(5, 8)), false, 'l’humain ne voit rien dans le noir')
    assert.equal(perceivedLight(nuit, nain.id, c(5, 8)), 'dim', 'pour le nain, le noir devient faible')
    assert.equal(canSee(nuit, nain.id, c(5, 8)), true)
    assert.equal(canSee(nuit, nain.id, c(5, 18)), false, 'au-delà de 60 pieds, le nain ne voit plus')

    const penombre = carte(20, 20, { ambient: 'dim', tokens: [nain] })
    assert.equal(perceivedLight(penombre, nain.id, c(5, 8)), 'bright', 'pour le nain, la lumière faible devient vive')
  })

  test('un token voit une case éclairée au loin, même au-delà de sa vision dans le noir', () => {
    const nain = token('Nain', 0, 10, { vision: { darkvision: 60 } })
    const map = carte(20, 20, { ambient: 'dark', tokens: [nain], lights: [lumiere(18, 10, 20, 20)] })
    assert.equal(canSee(map, nain.id, c(18, 10)), true, 'le feu, à 90 pieds')
    assert.equal(canSee(map, nain.id, c(5, 10)), true, 'dans le noir, à 25 pieds : grâce à la vision dans le noir')
    assert.equal(canSee(map, nain.id, c(15, 0)), false, 'dans le noir, loin du feu et au-delà de 60 pieds')
  })
})

// ─── 5. Brouillard de guerre ──────────────────────────────────────────────

describe('Brouillard de guerre', () => {
  test('les cases vues restent révélées en « exploré »', () => {
    const fog = recordExplored(emptyFog(), 'Bob', ['1,1', '1,2'])
    assert.equal(cellState(fog, 'Bob', '1,1', []), 'explored', 'vue avant, plus maintenant')
    assert.equal(cellState(fog, 'Bob', '1,1', ['1,1']), 'visible', 'vue maintenant')
    assert.equal(cellState(fog, 'Bob', '5,5', []), 'hidden', 'jamais vue')
  })

  test('chaque joueur a son propre brouillard', () => {
    const fog = recordExplored(recordExplored(emptyFog(), 'Bob', ['1,1']), 'Carol', ['8,8'])
    assert.equal(cellState(fog, 'Bob', '1,1', []), 'explored')
    assert.equal(cellState(fog, 'Bob', '8,8', []), 'hidden')
    assert.equal(cellState(fog, 'Carol', '8,8', []), 'explored')
    assert.equal(cellState(fog, 'Carol', '1,1', []), 'hidden')
  })

  test('le propriétaire révèle ou cache des cases à la main', () => {
    const depart = recordExplored(emptyFog(), 'Bob', ['2,2'])

    const revele = setRevealed(depart, ['7,7'], true)
    assert.equal(cellState(revele, 'Bob', '7,7', []), 'visible')
    assert.equal(cellState(revele, 'Carol', '7,7', []), 'visible', 'pour tous les joueurs')

    const cache = setRevealed(revele, ['7,7', '2,2'], false)
    assert.equal(cellState(cache, 'Bob', '7,7', []), 'hidden')
    assert.equal(cellState(cache, 'Bob', '2,2', []), 'hidden', 'cacher efface aussi ce qui avait été exploré')

    assert.equal(cellState(depart, 'Bob', '2,2', []), 'explored', 'l’état d’origine n’est pas modifié')
  })

  test('un joueur sans token ne voit rien, sauf ce que le propriétaire a révélé', () => {
    const gardien = token('Gardien', 5, 5, { player: 'Carol' })
    const map = carte(10, 10, { tokens: [gardien] })
    assert.deepEqual(visibleCellsFor(map, 'Bob'), [], 'Bob n’a pas de token')

    const revele = { ...map, fog: setRevealed(map.fog, ['0,0', '0,1'], true) }
    assert.deepEqual([...visibleCellsFor(revele, 'Bob')].sort(), ['0,0', '0,1'])
    assert.equal(visibleCellsFor(revele, 'Carol').length, 100, 'Carol voit par son token')
  })
})

// ─── 6. Tokens et fiches (partie sans serveur) ────────────────────────────

describe('Tokens et fiches', () => {
  test('un token lié à une fiche est une copie indépendante par défaut', () => {
    const t = newToken({ name: 'Gobelin', cell: c(0, 0), sheetId: 'fiche-gobelin' })
    assert.equal(t.sheetMode, 'copy')
    const lie = newToken({ name: 'Gandalf', cell: c(0, 0), sheetId: 'fiche-gandalf', sheetMode: 'link' })
    assert.equal(lie.sheetMode, 'link')
  })

  test('l’image de fond d’une carte fait partie de ses images (pour la copier avec elle)', () => {
    const empreinte = 'b'.repeat(40)
    const { content } = newMap('Forêt', null, 1, { background: empreinte })
    assert.deepEqual(collectImages(content), [empreinte])
  })
})

// ─── 7. Permissions (partie sans serveur) ─────────────────────────────────

describe('Permissions', () => {
  const ACTIONS: MapAction[] = [
    'moveToken', 'addToken', 'removeToken', 'assignToken', 'editWalls', 'editLights',
    'paintLight', 'editFog', 'editGrid', 'openSheet', 'exportMap'
  ]
  const tokenDeBob = newToken({ name: 'Bob le guerrier', cell: c(0, 0), player: 'Bob' })
  const tokenDeCarol = newToken({ name: 'Carol la mage', cell: c(1, 0), player: 'Carol' })

  test('en mode local, aucune restriction', () => {
    for (const action of ACTIONS) assert.equal(can(null, 'Alice', action, tokenDeCarol), true, action)
  })

  test('le propriétaire peut tout faire', () => {
    for (const action of ACTIONS) assert.equal(can('Alice', 'Alice', action, tokenDeBob), true, action)
  })

  test('un joueur peut seulement déplacer son propre token', () => {
    assert.equal(can('Bob', 'Alice', 'moveToken', tokenDeBob), true)
    assert.equal(can('Bob', 'Alice', 'moveToken', tokenDeCarol), false)
    for (const action of ACTIONS.filter((a) => a !== 'moveToken')) {
      assert.equal(can('Bob', 'Alice', action, tokenDeBob), false, action)
    }
  })
})
