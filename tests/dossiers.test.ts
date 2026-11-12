// Tests des dossiers : un nouveau genre de document qui contient d'autres documents.
//
// Le contrat est décrit dans docs/carte-api.md.
// Lancer : npm test

import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, test } from 'node:test'
import { planCopy } from '@shared/copy'
import { newFolder } from '@shared/documents'
import { docKind, subtree } from '@shared/model'
import { MODELES, attendre, champs, creerFiche, ficheExiste, fichierExiste, serveurAvecAliceEtBob } from './outils'
import { creerCarte, creerDossier } from './outils-carte'

describe('Dossiers', () => {
  test('un dossier est un document de genre « dossier », sans aucun champ', async (t) => {
    const { meta } = newFolder('Personnages', null, 1)
    assert.equal(meta.title, 'Personnages')
    assert.equal(docKind(meta), 'folder')

    const { alice } = await serveurAvecAliceEtBob(t)
    const id = await creerDossier(alice, 'Personnages')
    const dossier = await alice.openDoc(id)
    assert.equal(champs(dossier).size, 0, 'un dossier n’a pas de champs')
    dossier.close()
  })

  test('un dossier peut contenir des fiches, des cartes et d’autres dossiers', async (t) => {
    const { alice, bob } = await serveurAvecAliceEtBob(t)
    const campagne = await creerDossier(alice, 'Campagne')
    const fiche = await creerFiche(alice, 'Aragorn', MODELES.personnage, campagne)
    const carte = await creerCarte(alice, 'Donjon', { parentId: campagne })
    const sousDossier = await creerDossier(alice, 'Archives', campagne)

    await attendre(() => [fiche, carte, sousDossier].every((id) => ficheExiste(bob, id)), 'Bob voit le contenu')
    const parentChezBob = (id: string) => bob.getState().docs.find((d) => d.id === id)?.parentId
    assert.equal(parentChezBob(fiche), campagne)
    assert.equal(parentChezBob(carte), campagne)
    assert.equal(parentChezBob(sousDossier), campagne)
  })

  test('déplacer une fiche dans un dossier la range à l’intérieur', async (t) => {
    const { alice, bob } = await serveurAvecAliceEtBob(t)
    const dossier = await creerDossier(alice, 'Personnages')
    const fiche = await creerFiche(alice, 'Aragorn', MODELES.personnage)

    alice.updateMeta(fiche, { parentId: dossier })

    await attendre(() => bob.getState().docs.find((d) => d.id === fiche)?.parentId === dossier, 'Bob voit la fiche rangée')
  })

  test('supprimer un dossier supprime tout son contenu', async (t) => {
    const { serveur, alice, bob } = await serveurAvecAliceEtBob(t)
    const dossier = await creerDossier(alice, 'À jeter')
    const fiche = await creerFiche(alice, 'Brouillon', MODELES.note, dossier)
    const sousDossier = await creerDossier(alice, 'Vieux', dossier)
    const ficheProfonde = await creerFiche(alice, 'Très vieux', MODELES.note, sousDossier)
    await attendre(() => ficheExiste(bob, ficheProfonde), 'Bob voit tout le contenu')
    const fichierProfond = path.join(serveur.dossier, 'documents', `${ficheProfonde}.json`)
    await attendre(() => fichierExiste(fichierProfond), 'le contenu est écrit sur le disque')

    // Seul l'identifiant du dossier est donné : le contenu doit partir avec lui.
    await alice.deleteDocs([dossier])

    await attendre(
      () => [dossier, fiche, sousDossier, ficheProfonde].every((id) => !ficheExiste(bob, id)),
      'le dossier et tout son contenu disparaissent chez Bob'
    )
    await attendre(async () => !(await fichierExiste(fichierProfond)), 'les fichiers du contenu sont supprimés du disque')
  })

  test('un dossier créé par Alice apparaît chez Bob avec son titre et son genre', async (t) => {
    const { alice, bob } = await serveurAvecAliceEtBob(t)
    const id = await creerDossier(alice, 'Lieux')

    await attendre(() => ficheExiste(bob, id), 'Bob voit le dossier')
    const meta = bob.getState().docs.find((d) => d.id === id)!
    assert.equal(meta.title, 'Lieux')
    assert.equal(docKind(meta), 'folder')
  })

  test('copier un dossier copie aussi son contenu', async (t) => {
    const { alice, bob } = await serveurAvecAliceEtBob(t)
    const dossier = await creerDossier(alice, 'Bestiaire')
    await creerFiche(alice, 'Gobelin', MODELES.personnage, dossier)
    const avant = alice.getState().docs.length

    const ids = subtree(alice.getState().docs, dossier).map((d) => d.id)
    const types = alice.getState().types
    const plan = planCopy(await alice.exportDocs(ids), types, types, null, 99)
    await alice.importDocs(plan)

    await attendre(() => bob.getState().docs.length === avant + 2, 'Bob voit la copie du dossier et de la fiche')
    const [copieDossier, copieFiche] = plan.docs
    const chezBob = (id: string) => bob.getState().docs.find((d) => d.id === id)
    assert.equal(docKind(chezBob(copieDossier.meta.id)!), 'folder')
    assert.equal(chezBob(copieFiche.meta.id)?.parentId, copieDossier.meta.id)
  })
})
