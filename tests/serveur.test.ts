// Tests d'intégration : un vrai kotari-server et de vrais clients.
//
// Chaque test démarre son propre serveur sur un projet vide, dans un
// dossier temporaire : les tests ne dépendent pas les uns des autres et
// tout est nettoyé à la fin, même en cas d'échec.
//
// Lancer : npm test

import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, test } from 'node:test'
import { planCopy } from '@shared/copy'
import { imageHash } from '@shared/images'
import { subtree } from '@shared/model'
import {
  MODELES,
  ajouterParagraphe,
  attendre,
  champs,
  creerFiche,
  demarrerServeur,
  ficheExiste,
  fichierExiste,
  insererTexte,
  lireFicheSurDisque,
  lireMetaSurDisque,
  lireTexte,
  lireTexteRiche,
  nombreDeFiches,
  serveurAvecAliceEtBob,
  titreDeLaFiche
} from './outils'

describe('Connexion', () => {
  test('un mauvais mot de passe est refusé', async (t) => {
    const serveur = await demarrerServeur(t)
    await assert.rejects(serveur.connecter('Intrus', 'mauvais-mot-de-passe'), /Mot de passe refusé/)
  })

  test('un client connecté reçoit les quatre types de fiches du serveur', async (t) => {
    const { alice } = await serveurAvecAliceEtBob(t)
    const noms = alice.getState().types.map((type) => type.name)
    assert.deepEqual(noms.sort(), ['Inventaire', 'Lieu', 'Note', 'Personnage'])
  })
})

describe('Édition à plusieurs', () => {
  test('une fiche et sa sous-fiche créées par Alice apparaissent chez Bob', async (t) => {
    const { alice, bob } = await serveurAvecAliceEtBob(t)

    const aragorn = await creerFiche(alice, 'Aragorn', MODELES.personnage)
    const sac = await creerFiche(alice, 'Sac', MODELES.inventaire, aragorn)

    await attendre(() => ficheExiste(bob, aragorn) && ficheExiste(bob, sac), 'Bob voit les deux fiches')
    const sacChezBob = bob.getState().docs.find((d) => d.id === sac)
    assert.equal(sacChezBob?.parentId, aragorn, 'le sac est bien une sous-fiche d’Aragorn')
  })

  test('deux saisies simultanées sont fusionnées sans rien perdre', async (t) => {
    const { alice, bob } = await serveurAvecAliceEtBob(t)
    const id = await creerFiche(alice, 'Aragorn', MODELES.personnage)
    const ficheAlice = await alice.openDoc(id)
    const ficheBob = await bob.openDoc(id)

    insererTexte(ficheAlice, 'race', 0, 'Humain')
    await attendre(() => lireTexte(ficheBob, 'race') === 'Humain', 'Bob reçoit « Humain »')

    // En même temps : Bob ajoute à la fin, Alice ajoute au début.
    insererTexte(ficheBob, 'race', 6, ' du Nord')
    insererTexte(ficheAlice, 'race', 0, 'Grand ')

    const attendu = 'Grand Humain du Nord'
    await attendre(
      () => lireTexte(ficheAlice, 'race') === attendu && lireTexte(ficheBob, 'race') === attendu,
      `les deux voient « ${attendu} »`
    )
  })

  test('le texte riche et les nombres sont synchronisés', async (t) => {
    const { alice, bob } = await serveurAvecAliceEtBob(t)
    const id = await creerFiche(alice, 'Aragorn', MODELES.personnage)
    const ficheAlice = await alice.openDoc(id)
    const ficheBob = await bob.openDoc(id)

    ajouterParagraphe(ficheAlice, 'histoire', 'Rôdeur du Nord.')
    champs(ficheAlice).set('niveau', 42)

    await attendre(() => lireTexteRiche(ficheBob, 'histoire').includes('Rôdeur du Nord.'), 'Bob reçoit le texte riche')
    await attendre(() => champs(ficheBob).get('niveau') === 42, 'Bob reçoit le niveau 42')
  })

  test('un renommage par Bob est visible chez Alice', async (t) => {
    const { alice, bob } = await serveurAvecAliceEtBob(t)
    const id = await creerFiche(alice, 'Aragorn', MODELES.personnage)
    await attendre(() => ficheExiste(bob, id), 'Bob voit la fiche')

    bob.updateMeta(id, { title: 'Aragorn II' })

    await attendre(() => titreDeLaFiche(alice, id) === 'Aragorn II', 'Alice voit le nouveau titre')
  })

  test('une fiche ouverte deux fois puis fermée et rouverte vite ne perd aucune saisie', async (t) => {
    // Régression : dans l'app, une fiche peut être ouverte à la fois en
    // pleine page et en carte, et on peut la fermer / rouvrir rapidement.
    const { alice, bob } = await serveurAvecAliceEtBob(t)
    const id = await creerFiche(alice, 'Note', MODELES.note)

    const premiere = await alice.openDoc(id)
    const seconde = await alice.openDoc(id)
    premiere.close()
    ajouterParagraphe(seconde, 'contenu', 'double')

    let fiche = seconde
    for (let tour = 0; tour < 6; tour++) {
      fiche.close()
      fiche = await alice.openDoc(id)
      ajouterParagraphe(fiche, 'contenu', `tour ${tour}`)
    }

    const ficheBob = await bob.openDoc(id)
    await attendre(
      () => ['double', 'tour 0', 'tour 5'].every((texte) => lireTexteRiche(ficheBob, 'contenu').includes(texte)),
      'Bob voit toutes les saisies'
    )
    fiche.close()
    ficheBob.close()
  })

  test('une suppression est diffusée et les fichiers sont retirés du disque', async (t) => {
    const { serveur, alice, bob } = await serveurAvecAliceEtBob(t)
    const id = await creerFiche(alice, 'Sac', MODELES.inventaire)
    await attendre(() => ficheExiste(bob, id), 'Bob voit la fiche')
    const fichierContenu = path.join(serveur.dossier, 'documents', `${id}.yjs`)
    await attendre(() => fichierExiste(fichierContenu), 'le contenu est écrit sur le disque')
    // Le serveur écrit les métadonnées (titre…) environ 1 s après un changement.
    await attendre(async () => (await lireMetaSurDisque(serveur.dossier, id)) !== null, 'le titre est écrit sur le disque')

    await alice.deleteDocs([id])

    await attendre(() => !ficheExiste(bob, id), 'la fiche disparaît chez Bob')
    await attendre(async () => !(await fichierExiste(fichierContenu)), 'le fichier est supprimé du disque')
  })
})

describe('Copie de fiches', () => {
  test('copier une fiche copie ses sous-fiches, avec de nouveaux identifiants et le contenu à jour', async (t) => {
    const { alice, bob } = await serveurAvecAliceEtBob(t)
    const aragorn = await creerFiche(alice, 'Aragorn', MODELES.personnage)
    await creerFiche(alice, 'Sac', MODELES.inventaire, aragorn)
    const fiche = await alice.openDoc(aragorn)
    insererTexte(fiche, 'race', 0, 'Humain')
    // La saisie doit être arrivée sur le serveur avant d'exporter :
    // on le vérifie en regardant la fiche depuis Bob.
    const ficheBob = await bob.openDoc(aragorn)
    await attendre(() => lireTexte(ficheBob, 'race') === 'Humain', 'le serveur a reçu « Humain »')

    // Exporter Aragorn et ses sous-fiches, puis les réimporter (copie).
    const ids = subtree(alice.getState().docs, aragorn).map((d) => d.id)
    const exportees = await alice.exportDocs(ids)
    assert.equal(exportees.length, 2, 'Aragorn + le sac')

    const types = alice.getState().types
    const plan = planCopy(exportees, types, types, null, 2)
    const [copieAragorn, copieSac] = plan.docs
    assert.notEqual(copieAragorn.meta.id, aragorn, 'la copie a un nouvel identifiant')
    assert.equal(copieSac.meta.parentId, copieAragorn.meta.id, 'le sac copié est rangé sous l’Aragorn copié')

    await alice.importDocs(plan)

    await attendre(() => nombreDeFiches(bob) === 4, 'Bob voit les deux copies')
    const copieChezBob = await bob.openDoc(copieAragorn.meta.id)
    assert.equal(lireTexte(copieChezBob, 'race'), 'Humain', 'le contenu a été copié')
    copieChezBob.close()
  })

  test('copier une fiche dont le type existe déjà avec d’autres champs crée « Personnage (2) »', async (t) => {
    const { alice } = await serveurAvecAliceEtBob(t)
    const aragorn = await creerFiche(alice, 'Aragorn', MODELES.personnage)
    const exportees = await alice.exportDocs([aragorn])

    // Le type d'origine a un champ de plus que celui du serveur : conflit.
    const personnageModifie = {
      ...MODELES.personnage,
      fields: [...MODELES.personnage.fields, { id: 'extra', name: 'Extra', kind: 'text' as const }]
    }
    const plan = planCopy(exportees, [personnageModifie], alice.getState().types, null, 2)

    assert.equal(plan.newTypes.length, 1)
    assert.equal(plan.newTypes[0].name, 'Personnage (2)')
  })
})

describe('Recherche', () => {
  test('la recherche ignore les accents et peut être limitée à certaines fiches', async (t) => {
    const { alice, bob } = await serveurAvecAliceEtBob(t)
    const aragorn = await creerFiche(alice, 'Aragorn', MODELES.personnage)
    const sac = await creerFiche(alice, 'Sac', MODELES.inventaire, aragorn)
    const fiche = await alice.openDoc(aragorn)
    ajouterParagraphe(fiche, 'histoire', 'Rôdeur du Nord.')
    await attendre(async () => (await bob.search('rodeur')).length > 0, 'le texte est indexé')

    // « rodeur » sans accent trouve « Rôdeur » dans l'histoire d'Aragorn.
    const resultats = await bob.search('rodeur')
    assert.ok(resultats.some((r) => r.docId === aragorn && r.path === 'histoire'))

    // Limitée au sac, la recherche « aragorn » ne trouve rien.
    assert.deepEqual(await bob.search('aragorn', [sac]), [])
  })
})

describe('Images', () => {
  test('une image envoyée par Alice est relue par Bob, et une fausse empreinte est refusée', async (t) => {
    const { alice, bob } = await serveurAvecAliceEtBob(t)
    // Un mini « PNG » : la signature PNG suivie de quelques octets.
    const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4])
    const empreinte = await imageHash(image)

    assert.deepEqual(await alice.missingImages([empreinte]), [empreinte], 'le serveur ne l’a pas encore')
    await alice.putImage(empreinte, image)
    assert.deepEqual(await bob.missingImages([empreinte]), [], 'le serveur l’a maintenant')
    assert.deepEqual(await bob.getImage(empreinte), image, 'Bob relit exactement les mêmes octets')

    await assert.rejects(alice.putImage('0'.repeat(40), image), /Empreinte/, 'empreinte qui ne correspond pas')
  })
})

describe('Enregistrement sur disque', () => {
  test('le contenu et le titre sont écrits sur le disque', async (t) => {
    const { serveur, alice } = await serveurAvecAliceEtBob(t)
    const id = await creerFiche(alice, 'Aragorn', MODELES.personnage)
    const fiche = await alice.openDoc(id)
    insererTexte(fiche, 'race', 0, 'Humain')
    alice.updateMeta(id, { title: 'Aragorn II' })

    await attendre(
      async () => {
        const surDisque = await lireFicheSurDisque(serveur.dossier, id)
        return surDisque !== null && lireTexte(surDisque, 'race') === 'Humain'
      },
      'le contenu est écrit sur le disque'
    )
    await attendre(
      async () => (await lireMetaSurDisque(serveur.dossier, id))?.title === 'Aragorn II',
      'le titre est écrit sur le disque'
    )
  })

  test('après un redémarrage du serveur, les fiches sont toujours là', async (t) => {
    const premier = await demarrerServeur(t)
    const alice = await premier.connecter('Alice')
    const id = await creerFiche(alice, 'Aragorn', MODELES.personnage)
    const fiche = await alice.openDoc(id)
    insererTexte(fiche, 'race', 0, 'Humain')
    // On attend que tout soit sur le disque avant d'arrêter le serveur.
    await attendre(async () => {
      const surDisque = await lireFicheSurDisque(premier.dossier, id)
      return surDisque !== null && lireTexte(surDisque, 'race') === 'Humain'
    }, 'le contenu est écrit sur le disque')
    await attendre(async () => (await lireMetaSurDisque(premier.dossier, id)) !== null, 'le titre est écrit sur le disque')

    await premier.arreter()
    const second = await demarrerServeur(t, premier.dossier) // même dossier
    const bob = await second.connecter('Bob')

    assert.equal(titreDeLaFiche(bob, id), 'Aragorn')
    const ficheRelue = await bob.openDoc(id)
    assert.equal(lireTexte(ficheRelue, 'race'), 'Humain')
    ficheRelue.close()
  })
})
