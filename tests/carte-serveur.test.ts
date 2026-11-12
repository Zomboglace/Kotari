// Tests des cartes sur un vrai serveur : propriétaire, tokens et fiches,
// brouillard, et surtout ce qu'un joueur a le droit de voir et de faire.
//
// Alice crée les cartes : elle en est la propriétaire (le MJ). Bob est un joueur.
// Le contrat est décrit dans docs/carte-api.md.
// Lancer : npm test

import assert from 'node:assert/strict'
import { describe, test, type TestContext } from 'node:test'
import { planCopy } from '@shared/copy'
import { newMap } from '@shared/documents'
import { imageHash } from '@shared/images'
import { subtree } from '@shared/model'
import type { MapSession } from '@shared/carte/session'
import type { Wall } from '@shared/carte/types'
import {
  MODELES,
  attendre,
  creerFiche,
  demarrerServeur,
  ficheExiste,
  insererTexte,
  lireTexte,
  serveurAvecAliceEtBob,
  type Client
} from './outils'
import { attendreCase, attendreToken, creerCarte, ouvrirCarte, tokenVu, vue } from './outils-carte'

/** Un mur vertical en x = 5, sur toute la hauteur, qui est une porte. */
const PORTE_FERMEE: Wall = { id: 'porte', from: { x: 5, y: 0 }, to: { x: 5, y: 10 }, door: 'closed' }
const PORTE_OUVERTE: Wall = { ...PORTE_FERMEE, door: 'open' }

/**
 * Une carte 10 × 10 coupée en deux par une porte fermée (en x = 5).
 * - le héros de Bob est à gauche, en (1, 1) ;
 * - un monstre est à droite, en (8, 8), invisible pour Bob.
 */
async function salleAvecPorte(t: TestContext) {
  const { serveur, alice, bob } = await serveurAvecAliceEtBob(t)
  const carteId = await creerCarte(alice, 'Donjon', { width: 10, height: 10 })
  const mj = await ouvrirCarte(t, alice, carteId)
  await mj.updateMap({ walls: [PORTE_FERMEE] })
  const heros = await mj.addToken({ name: 'Héros', cell: { x: 1, y: 1 } })
  const monstre = await mj.addToken({ name: 'Monstre', cell: { x: 8, y: 8 } })
  await mj.assignToken(heros, 'Bob')
  const joueur = await ouvrirCarte(t, bob, carteId)
  await attendreToken(joueur, heros, true, 'Bob voit son héros')
  return { serveur, alice, bob, carteId, mj, joueur, heros, monstre }
}

/** Les identifiants des documents enfants de la carte (les copies de fiche). */
function copiesDeFiche(client: Client, carteId: string): string[] {
  return client.getState().docs.filter((d) => d.parentId === carteId).map((d) => d.id)
}

describe('Création et propriétaire', () => {
  test('une carte se crée avec la taille demandée, vide et en plein jour', async (t) => {
    const { alice } = await serveurAvecAliceEtBob(t)
    const id = await creerCarte(alice, 'Plaine', { width: 30, height: 12 })

    const v = vue(await ouvrirCarte(t, alice, id))
    assert.equal(v.role, 'owner')
    assert.equal(v.map.width, 30)
    assert.equal(v.map.height, 12)
    assert.equal(v.map.ambient, 'bright')
    assert.equal(v.map.background, null)
    assert.deepEqual(v.map.tokens, [])
  })

  test('le créateur de la carte en est le propriétaire, et le serveur ne se laisse pas tromper', async (t) => {
    const { alice, bob } = await serveurAvecAliceEtBob(t)
    const id = await creerCarte(alice, 'Donjon')
    await attendre(() => ficheExiste(bob, id), 'Bob voit la carte dans l’arbre')
    assert.equal(bob.getState().docs.find((d) => d.id === id)?.owner, 'Alice')

    // Bob essaie de créer une carte en se faisant passer pour Alice.
    const { meta, content } = newMap('Piège', null, 9)
    await bob.createDoc({ ...meta, owner: 'Alice' }, content)
    await attendre(() => ficheExiste(alice, meta.id), 'Alice voit la carte de Bob')
    assert.equal(alice.getState().docs.find((d) => d.id === meta.id)?.owner, 'Bob')
  })

  test('le propriétaire voit toute la carte et tous les tokens', async (t) => {
    const { mj, heros, monstre } = await salleAvecPorte(t)
    const v = vue(mj)
    assert.equal(v.visible.length, 100)
    assert.ok(tokenVu(mj, heros) && tokenVu(mj, monstre))
  })
})

describe('Tokens et copies de fiche', () => {
  test('poser 20 gobelins depuis la même fiche crée 20 copies indépendantes', async (t) => {
    const { alice } = await serveurAvecAliceEtBob(t)
    const gobelin = await creerFiche(alice, 'Gobelin', MODELES.personnage)
    const carteId = await creerCarte(alice, 'Embuscade')
    const mj = await ouvrirCarte(t, alice, carteId)

    for (let i = 0; i < 20; i++) {
      await mj.addToken({ name: `Gobelin ${i + 1}`, cell: { x: i % 10, y: Math.floor(i / 10) }, sheetId: gobelin })
    }

    await attendre(() => vue(mj).map.tokens.length === 20, 'les 20 tokens sont posés')
    const fiches = vue(mj).map.tokens.map((tk) => tk.sheetId)
    assert.equal(new Set(fiches).size, 20, 'chaque token a sa propre fiche')
    assert.ok(!fiches.includes(gobelin), 'aucun token n’utilise la fiche d’origine')
    await attendre(() => copiesDeFiche(alice, carteId).length === 20, 'les 20 copies sont dans l’arbre d’Alice')
  })

  test('modifier la copie d’un gobelin ne touche ni les autres copies ni l’original', async (t) => {
    const { alice } = await serveurAvecAliceEtBob(t)
    const gobelin = await creerFiche(alice, 'Gobelin', MODELES.personnage)
    const carteId = await creerCarte(alice, 'Embuscade')
    const mj = await ouvrirCarte(t, alice, carteId)
    const ids = []
    for (let i = 0; i < 3; i++) ids.push(await mj.addToken({ name: `Gobelin ${i + 1}`, cell: { x: i, y: 0 }, sheetId: gobelin }))
    const ficheDu = (tokenId: string) => tokenVu(mj, tokenId)!.sheetId!

    const troisieme = await alice.openDoc(ficheDu(ids[2]))
    insererTexte(troisieme, 'race', 0, 'Gobelin des cavernes')
    troisieme.close()

    const premier = await alice.openDoc(ficheDu(ids[0]))
    const original = await alice.openDoc(gobelin)
    const troisiemeRelu = await alice.openDoc(ficheDu(ids[2]))
    assert.equal(lireTexte(troisiemeRelu, 'race'), 'Gobelin des cavernes')
    assert.equal(lireTexte(premier, 'race'), '', 'les autres copies ne changent pas')
    assert.equal(lireTexte(original, 'race'), '', 'l’original ne change pas')
    premier.close()
    original.close()
    troisiemeRelu.close()
  })

  test('un token « lien » utilise directement la fiche d’origine', async (t) => {
    const { alice } = await serveurAvecAliceEtBob(t)
    const gandalf = await creerFiche(alice, 'Gandalf', MODELES.personnage)
    const carteId = await creerCarte(alice, 'Moria')
    const mj = await ouvrirCarte(t, alice, carteId)
    const avant = alice.getState().docs.length

    const id = await mj.addToken({ name: 'Gandalf', cell: { x: 0, y: 0 }, sheetId: gandalf, sheetMode: 'link' })

    const tk = tokenVu(mj, id)!
    assert.equal(tk.sheetMode, 'link')
    assert.equal(tk.sheetId, gandalf)
    assert.equal(alice.getState().docs.length, avant, 'aucune copie créée')
  })

  test('sans choix explicite, un token est une copie de la fiche', async (t) => {
    const { alice } = await serveurAvecAliceEtBob(t)
    const gobelin = await creerFiche(alice, 'Gobelin', MODELES.personnage)
    const carteId = await creerCarte(alice, 'Embuscade')
    const mj = await ouvrirCarte(t, alice, carteId)

    const tk = tokenVu(mj, await mj.addToken({ name: 'Gobelin', cell: { x: 0, y: 0 }, sheetId: gobelin }))!

    assert.equal(tk.sheetMode, 'copy')
    assert.notEqual(tk.sheetId, gobelin)
  })

  test('les copies de fiche sont rangées sous la carte, pas dans l’arbre principal', async (t) => {
    const { alice } = await serveurAvecAliceEtBob(t)
    const gobelin = await creerFiche(alice, 'Gobelin', MODELES.personnage)
    const carteId = await creerCarte(alice, 'Embuscade')
    const mj = await ouvrirCarte(t, alice, carteId)
    const racineAvant = alice.getState().docs.filter((d) => d.parentId === null).length

    const tk = tokenVu(mj, await mj.addToken({ name: 'Gobelin', cell: { x: 0, y: 0 }, sheetId: gobelin }))!

    await attendre(() => ficheExiste(alice, tk.sheetId!), 'la copie apparaît dans l’arbre d’Alice')
    assert.equal(alice.getState().docs.find((d) => d.id === tk.sheetId)?.parentId, carteId)
    assert.equal(alice.getState().docs.filter((d) => d.parentId === null).length, racineAvant)
  })

  test('supprimer un token supprime sa copie, mais jamais une fiche liée', async (t) => {
    const { alice } = await serveurAvecAliceEtBob(t)
    const gobelin = await creerFiche(alice, 'Gobelin', MODELES.personnage)
    const gandalf = await creerFiche(alice, 'Gandalf', MODELES.personnage)
    const carteId = await creerCarte(alice, 'Embuscade')
    const mj = await ouvrirCarte(t, alice, carteId)
    const copie = await mj.addToken({ name: 'Gobelin', cell: { x: 0, y: 0 }, sheetId: gobelin })
    const lien = await mj.addToken({ name: 'Gandalf', cell: { x: 1, y: 0 }, sheetId: gandalf, sheetMode: 'link' })
    const ficheCopie = tokenVu(mj, copie)!.sheetId!
    await attendre(() => ficheExiste(alice, ficheCopie), 'la copie existe')

    await mj.removeToken(copie)
    await mj.removeToken(lien)

    await attendre(() => !ficheExiste(alice, ficheCopie), 'la copie du gobelin est supprimée')
    assert.ok(ficheExiste(alice, gandalf), 'la fiche de Gandalf existe toujours')
    assert.ok(ficheExiste(alice, gobelin), 'la fiche d’origine du gobelin existe toujours')
    assert.deepEqual(vue(mj).map.tokens, [])
  })

  test('copier une carte emporte ses tokens, leurs copies de fiche et son image de fond', async (t) => {
    const { alice } = await serveurAvecAliceEtBob(t)
    const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9])
    const fond = await imageHash(image)
    await alice.putImage(fond, image)
    const gobelin = await creerFiche(alice, 'Gobelin', MODELES.personnage)
    const carteId = await creerCarte(alice, 'Embuscade', { background: fond })
    const mj = await ouvrirCarte(t, alice, carteId)
    await mj.addToken({ name: 'Gobelin 1', cell: { x: 0, y: 0 }, sheetId: gobelin })
    await mj.addToken({ name: 'Gobelin 2', cell: { x: 1, y: 0 }, sheetId: gobelin })
    await attendre(() => copiesDeFiche(alice, carteId).length === 2, 'les deux copies existent')

    const ids = subtree(alice.getState().docs, carteId).map((d) => d.id)
    const types = alice.getState().types
    const plan = planCopy(await alice.exportDocs(ids), types, types, null, 99)
    await alice.importDocs(plan)

    const nouvelleCarte = plan.docs[0].meta.id
    const nouvellesCopies = new Set(plan.docs.slice(1).map((d) => d.meta.id))
    await attendre(() => ficheExiste(alice, nouvelleCarte), 'la nouvelle carte existe')
    const copie = vue(await ouvrirCarte(t, alice, nouvelleCarte))
    assert.equal(copie.map.background, fond)
    assert.equal(copie.map.tokens.length, 2)
    for (const tk of copie.map.tokens) {
      assert.ok(nouvellesCopies.has(tk.sheetId!), `${tk.name} pointe vers sa nouvelle copie de fiche`)
    }
  })

  test('un token peut être un simple pion, sans fiche', async (t) => {
    const { alice } = await serveurAvecAliceEtBob(t)
    const carteId = await creerCarte(alice, 'Échiquier')
    const mj = await ouvrirCarte(t, alice, carteId)
    const avant = alice.getState().docs.length

    const tk = tokenVu(mj, await mj.addToken({ name: 'Pion', cell: { x: 0, y: 0 } }))!

    assert.equal(tk.sheetId, null)
    assert.equal(tk.sheetMode, null)
    assert.equal(alice.getState().docs.length, avant)
  })
})

describe('Rôles et anti-triche', () => {
  test('le propriétaire déplace tous les tokens, mais pas à travers un mur', async (t) => {
    const { mj, heros, monstre } = await salleAvecPorte(t)
    await mj.moveToken(heros, { x: 2, y: 2 })
    await mj.moveToken(monstre, { x: 7, y: 7 })
    await attendreCase(mj, heros, { x: 2, y: 2 }, 'le héros a bougé')
    await attendreCase(mj, monstre, { x: 7, y: 7 }, 'le monstre a bougé')

    await assert.rejects(mj.moveToken(heros, { x: 8, y: 2 }), 'la porte est fermée')
    assert.deepEqual(tokenVu(mj, heros)!.cell, { x: 2, y: 2 })
  })

  test('un joueur déplace seulement son propre token', async (t) => {
    const { mj, joueur, heros, monstre } = await salleAvecPorte(t)

    await joueur.moveToken(heros, { x: 2, y: 3 })
    await attendreCase(mj, heros, { x: 2, y: 3 }, 'le serveur a accepté le déplacement')

    await assert.rejects(joueur.moveToken(monstre, { x: 7, y: 7 }), 'pas son token')
    await assert.rejects(joueur.moveToken(heros, { x: 8, y: 3 }), 'la porte est fermée')
    assert.deepEqual(tokenVu(mj, monstre)!.cell, { x: 8, y: 8 })
  })

  test('un joueur ne peut modifier ni la carte, ni les tokens, ni le brouillard', async (t) => {
    const { mj, joueur, heros } = await salleAvecPorte(t)
    // Tout sauf les cases explorées (qui évoluent toutes seules quand Bob regarde).
    const etatModifiable = () => {
      const { fog, ...reste } = vue(mj).map
      return structuredClone({ ...reste, revealed: fog.revealed })
    }
    const avant = etatModifiable()

    const tentatives: Array<[string, () => Promise<unknown>]> = [
      ['murs', () => joueur.updateMap({ walls: [] })],
      ['lumières', () => joueur.updateMap({ lights: [{ id: 'l', cell: { x: 0, y: 0 }, bright: 20, dim: 20 }] })],
      ['ambiance', () => joueur.updateMap({ ambient: 'dark' })],
      ['pinceau', () => joueur.paintLight(['0,0'], 'dark')],
      ['grille', () => joueur.resizeGrid(5, 5)],
      ['brouillard', () => joueur.setRevealed(['9,9'], true)],
      ['ajout de token', () => joueur.addToken({ name: 'Intrus', cell: { x: 0, y: 0 } })],
      ['suppression de token', () => joueur.removeToken(heros)],
      ['attribution', () => joueur.assignToken(heros, null)]
    ]
    for (const [quoi, essai] of tentatives) await assert.rejects(essai(), `refus attendu : ${quoi}`)

    assert.deepEqual(etatModifiable(), avant, 'la carte n’a pas changé')
  })

  test('seul le propriétaire attribue un token, et seulement à un joueur connecté', async (t) => {
    const { mj, joueur, heros, monstre } = await salleAvecPorte(t)

    await assert.rejects(mj.assignToken(monstre, 'Carol'), 'Carol n’est pas connectée')
    await assert.rejects(joueur.assignToken(monstre, 'Bob'), 'Bob n’est pas propriétaire')
    assert.equal(tokenVu(mj, monstre)!.player, null)

    await mj.assignToken(monstre, 'Bob')
    assert.equal(tokenVu(mj, monstre)!.player, 'Bob')
    assert.equal(tokenVu(mj, heros)!.player, 'Bob')
  })

  test('un joueur ne reçoit pas les tokens qu’il ne voit pas', async (t) => {
    const { joueur, heros, monstre } = await salleAvecPorte(t)
    await attendre(() => (vue(joueur).map.fog.explored['Bob'] ?? []).includes('1,1'), 'le brouillard de Bob est à jour')
    const v = vue(joueur)

    assert.equal(v.role, 'player')
    assert.deepEqual(
      v.map.tokens.map((tk) => tk.id),
      [heros],
      'seul son héros lui est envoyé : le monstre, derrière la porte, est absent de ses données'
    )
    assert.ok(!v.map.tokens.some((tk) => tk.id === monstre))
    assert.ok(v.visible.includes('1,1'))
    assert.ok(!v.visible.includes('8,8'))
    assert.deepEqual(Object.keys(v.map.fog.explored), ['Bob'], 'il ne reçoit que son propre brouillard')
  })

  test('un token apparaît chez le joueur quand il entre dans sa vue, et disparaît quand il en sort', async (t) => {
    const { mj, joueur, monstre } = await salleAvecPorte(t)

    assert.equal(tokenVu(joueur, monstre), undefined, 'au départ, le monstre est caché')
    await mj.updateMap({ walls: [PORTE_OUVERTE] }) // on ouvre la porte
    await attendreToken(joueur, monstre, true, 'le monstre apparaît chez Bob')

    await mj.updateMap({ walls: [PORTE_FERMEE] }) // on referme
    await attendreToken(joueur, monstre, false, 'le monstre disparaît des données de Bob')
  })

  test('un joueur ne voit pas les copies de fiche dans son arbre', async (t) => {
    const { alice, bob, mj, carteId } = await salleAvecPorte(t)
    const gobelin = await creerFiche(alice, 'Gobelin', MODELES.personnage)
    await mj.addToken({ name: 'Gobelin', cell: { x: 2, y: 2 }, sheetId: gobelin })
    await attendre(() => copiesDeFiche(alice, carteId).length === 1, 'Alice voit la copie')
    await attendre(() => ficheExiste(bob, gobelin), 'Bob a bien reçu l’arbre à jour')

    assert.ok(ficheExiste(bob, carteId), 'Bob voit la carte elle-même')
    assert.deepEqual(copiesDeFiche(bob, carteId), [], 'mais pas les copies de fiche')
  })

  test('un joueur ne peut ouvrir ni une copie de fiche ni la carte brute, même avec leur identifiant', async (t) => {
    const { alice, bob, mj, carteId } = await salleAvecPorte(t)
    const gobelin = await creerFiche(alice, 'Gobelin', MODELES.personnage)
    const tk = tokenVu(mj, await mj.addToken({ name: 'Gobelin', cell: { x: 2, y: 2 }, sheetId: gobelin }))!

    await assert.rejects(bob.openDoc(tk.sheetId!), 'copie de fiche refusée')
    await assert.rejects(bob.openDoc(carteId), 'carte brute refusée : elle contient tous les tokens')

    const ficheChezAlice = await alice.openDoc(tk.sheetId!)
    ficheChezAlice.close()
  })

  test('la recherche d’un joueur ne renvoie rien des copies de fiche', async (t) => {
    const { alice, bob, mj, carteId } = await salleAvecPorte(t)
    const gobelin = await creerFiche(alice, 'Gobelin', MODELES.personnage)
    const tk = tokenVu(mj, await mj.addToken({ name: 'Gobelin', cell: { x: 2, y: 2 }, sheetId: gobelin }))!
    const copie = await alice.openDoc(tk.sheetId!)
    insererTexte(copie, 'race', 0, 'Zorglub')
    await attendre(async () => (await alice.search('zorglub')).length > 0, 'Alice trouve le texte secret')
    copie.close()

    const resultats = await bob.search('zorglub')
    assert.deepEqual(resultats, [])
    assert.ok(ficheExiste(alice, carteId))
  })

  test('un joueur ne peut pas exporter la carte ni ses copies (donc pas les copier en local)', async (t) => {
    const { alice, bob, mj, carteId } = await salleAvecPorte(t)
    const gobelin = await creerFiche(alice, 'Gobelin', MODELES.personnage)
    const tk = tokenVu(mj, await mj.addToken({ name: 'Gobelin', cell: { x: 2, y: 2 }, sheetId: gobelin }))!

    await assert.rejects(bob.exportDocs([carteId]), 'export de la carte refusé')
    await assert.rejects(bob.exportDocs([tk.sheetId!]), 'export d’une copie refusé')
    assert.equal((await alice.exportDocs([carteId])).length, 1, 'la propriétaire, elle, peut exporter')
  })
})

describe('Brouillard de guerre (serveur)', () => {
  test('les cases vues par un joueur restent explorées après qu’il ne les voit plus', async (t) => {
    const { mj, joueur } = await salleAvecPorte(t)
    const explore = () => vue(joueur).map.fog.explored['Bob'] ?? []

    await mj.updateMap({ walls: [PORTE_OUVERTE] })
    await attendre(() => vue(joueur).visible.includes('8,8'), 'Bob voit l’autre salle')
    await mj.updateMap({ walls: [PORTE_FERMEE] })
    await attendre(() => !vue(joueur).visible.includes('8,8'), 'Bob ne voit plus l’autre salle')

    assert.ok(explore().includes('8,8'), 'mais elle reste explorée')
  })

  test('le propriétaire révèle des cases à un joueur', async (t) => {
    const { mj, joueur } = await salleAvecPorte(t)
    await mj.setRevealed(['9,9'], true)
    await attendre(() => vue(joueur).visible.includes('9,9'), 'Bob voit la case révélée')
  })

  test('le brouillard est conservé après un redémarrage du serveur', async (t) => {
    const premier = await demarrerServeur(t)
    const alice = await premier.connecter('Alice')
    const bob = await premier.connecter('Bob')
    const carteId = await creerCarte(alice, 'Donjon', { width: 10, height: 10 })
    const mj = await alice.openMap(carteId)
    await mj.updateMap({ walls: [PORTE_OUVERTE] })
    const heros = await mj.addToken({ name: 'Héros', cell: { x: 1, y: 1 } })
    await mj.assignToken(heros, 'Bob')
    const joueur = await bob.openMap(carteId)
    await attendre(() => (vue(joueur).map.fog.explored['Bob'] ?? []).includes('8,8'), 'Bob a exploré la salle de droite')
    await mj.updateMap({ walls: [PORTE_FERMEE] })
    await attendre(() => !vue(joueur).visible.includes('8,8'), 'la porte est refermée')
    joueur.close()
    mj.close()

    await premier.arreter()
    const second = await demarrerServeur(t, premier.dossier)
    const bobDeRetour = await second.connecter('Bob')
    const joueurDeRetour: MapSession = await ouvrirCarte(t, bobDeRetour, carteId)

    await attendre(() => (vue(joueurDeRetour).map.fog.explored['Bob'] ?? []).includes('8,8'), 'la salle de droite est toujours explorée')
    assert.ok(!vue(joueurDeRetour).visible.includes('8,8'), 'mais pas visible, puisque la porte est fermée')
  })
})
