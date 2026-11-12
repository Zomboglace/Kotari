// Outils partagés par les tests.
//
// Ils cachent la mécanique (Yjs, serveur, nettoyage) pour que chaque test
// se lise comme une petite histoire : « Alice crée une fiche, Bob la voit ».

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { TestContext } from 'node:test'
import * as Y from 'yjs'
import { initialContent } from '@shared/content'
import { ProjectStore } from '@shared/fsproject'
import { newId, type TypeDef } from '@shared/model'
import { TEMPLATES } from '@shared/templates'
import { hashPassword } from '../src/server/password'
import { startServer } from '../src/server/server'
import { ServerLibrary } from '../src/renderer/src/lib/serverLibrary'

// ─── Attente ──────────────────────────────────────────────────────────────

/**
 * Attend qu'une condition devienne vraie (vérifiée toutes les 25 ms).
 * On l'utilise à la place d'une pause fixe : le test continue dès que
 * c'est prêt, et échoue avec un message clair si ça n'arrive jamais.
 */
export async function attendre(
  condition: () => boolean | Promise<boolean>,
  quoi: string,
  delaiMax = 5000
): Promise<void> {
  const debut = Date.now()
  while (!(await condition())) {
    if (Date.now() - debut > delaiMax) {
      throw new Error(`Délai de ${delaiMax} ms dépassé en attendant : ${quoi}`)
    }
    await new Promise((r) => setTimeout(r, 25))
  }
}

// ─── Nettoyage ────────────────────────────────────────────────────────────

const nettoyages = new WeakMap<TestContext, Array<() => unknown>>()

/**
 * Programme une action de nettoyage à la fin du test, même s'il échoue.
 * Les actions s'exécutent dans l'ordre inverse de leur ajout (la dernière
 * chose créée est la première défaite) : on arrête le serveur avant de
 * supprimer son dossier, par exemple.
 */
export function aLaFin(t: TestContext, action: () => unknown): void {
  let pile = nettoyages.get(t)
  if (!pile) {
    const nouvellePile: Array<() => unknown> = []
    nettoyages.set(t, nouvellePile)
    t.after(async () => {
      for (const a of nouvellePile.reverse()) await a()
    })
    pile = nouvellePile
  }
  pile.push(action)
}

// ─── Modèles de fiches ────────────────────────────────────────────────────

function modele(id: string): TypeDef {
  const type = TEMPLATES.find((t) => t.id === id)
  if (!type) throw new Error(`Modèle introuvable : ${id}`)
  return type
}

/** Les modèles fournis avec Kotari. */
export const MODELES = {
  note: modele('modele-note'),
  personnage: modele('modele-personnage'),
  inventaire: modele('modele-inventaire')
}

// ─── Serveur de test ──────────────────────────────────────────────────────

export const MOT_DE_PASSE = 'mot-de-passe-de-test'

export type Client = ServerLibrary

export interface ServeurDeTest {
  dossier: string
  port: number
  /** Connecte un client (un « joueur ») au serveur. */
  connecter(nom: string, motDePasse?: string): Promise<Client>
  /** Arrête le serveur et déconnecte ses clients, en gardant le dossier. */
  arreter(): Promise<void>
}

/**
 * Crée un projet vide (avec les modèles) dans un dossier temporaire et
 * démarre un vrai kotari-server dessus, sur un port libre.
 *
 * Tout est nettoyé automatiquement à la fin du test, même s'il échoue.
 * Passer `dossier` permet de redémarrer un serveur sur un projet existant.
 */
export async function demarrerServeur(t: TestContext, dossier?: string): Promise<ServeurDeTest> {
  if (!dossier) {
    dossier = await fs.mkdtemp(path.join(os.tmpdir(), 'kotari-test-'))
    await ProjectStore.init(dossier, 'Projet de test', TEMPLATES)
    const aSupprimer = dossier
    aLaFin(t, () => fs.rm(aSupprimer, { recursive: true, force: true }))
  }

  const serveur = await startServer({
    dir: dossier,
    port: 0, // 0 = le système choisit un port libre
    passwordHash: await hashPassword(MOT_DE_PASSE),
    log: () => {} // silencieux pendant les tests
  })

  const clients: Client[] = []
  let arrete = false
  const arreter = async () => {
    if (arrete) return
    arrete = true
    for (const client of clients) client.destroy()
    await serveur.stop()
  }
  aLaFin(t, async () => {
    // Nettoyage automatique : une erreur ici ne doit pas faire échouer un
    // test qui a réussi. On la signale quand même (voir le README des tests :
    // l'arrêt du serveur juste après une modification peut échouer).
    try {
      await arreter()
    } catch (erreur) {
      console.warn(`  ⚠ arrêt du serveur de test : ${(erreur as Error).message}`)
    }
  })

  return {
    dossier,
    port: serveur.port,
    async connecter(nom, motDePasse = MOT_DE_PASSE) {
      const client = await ServerLibrary.connect({ host: '127.0.0.1', port: serveur.port, password: motDePasse, name: nom })
      clients.push(client)
      return client
    },
    arreter
  }
}

/** Raccourci : un serveur et deux joueurs, Alice et Bob, déjà connectés. */
export async function serveurAvecAliceEtBob(t: TestContext) {
  const serveur = await demarrerServeur(t)
  const alice = await serveur.connecter('Alice')
  const bob = await serveur.connecter('Bob')
  return { serveur, alice, bob }
}

// ─── Fiches ───────────────────────────────────────────────────────────────

/** Crée une fiche vide et renvoie son identifiant. */
export async function creerFiche(
  client: Client,
  titre: string,
  type: TypeDef,
  parentId: string | null = null
): Promise<string> {
  const id = newId()
  const ordre = client.getState().docs.length + 1
  await client.createDoc({ id, title: titre, typeId: type.id, parentId, order: ordre }, initialContent(type))
  return id
}

export function nombreDeFiches(client: Client): number {
  return client.getState().docs.length
}

export function titreDeLaFiche(client: Client, id: string): string | undefined {
  return client.getState().docs.find((d) => d.id === id)?.title
}

export function ficheExiste(client: Client, id: string): boolean {
  return client.getState().docs.some((d) => d.id === id)
}

// ─── Champs d'une fiche ouverte ──────────────────────────────────────────
//
// Le contenu d'une fiche est un document Yjs : une « map » `fields` qui
// associe l'id de chaque champ à sa valeur (Y.Text pour un texte,
// Y.XmlFragment pour un texte riche, nombre pour un nombre…).

type AvecYdoc = { ydoc: Y.Doc }

export function champs(fiche: AvecYdoc): Y.Map<unknown> {
  return fiche.ydoc.getMap('fields')
}

/** Valeur d'un champ texte simple (ex. « race »). */
export function lireTexte(fiche: AvecYdoc, champ: string): string {
  return (champs(fiche).get(champ) as Y.Text).toString()
}

/** Insère du texte dans un champ texte simple, à la position donnée. */
export function insererTexte(fiche: AvecYdoc, champ: string, position: number, texte: string): void {
  ;(champs(fiche).get(champ) as Y.Text).insert(position, texte)
}

/** Contenu d'un champ texte riche, sous forme XML (ex. « <paragraph>…</paragraph> »). */
export function lireTexteRiche(fiche: AvecYdoc, champ: string): string {
  return (champs(fiche).get(champ) as Y.XmlFragment).toString()
}

/** Ajoute un paragraphe à la fin d'un champ texte riche. */
export function ajouterParagraphe(fiche: AvecYdoc, champ: string, texte: string): void {
  const paragraphe = new Y.XmlElement('paragraph')
  paragraphe.insert(0, [new Y.XmlText(texte)])
  const fragment = champs(fiche).get(champ) as Y.XmlFragment
  fragment.push([paragraphe])
}

// ─── Disque ───────────────────────────────────────────────────────────────

/** Lit le contenu d'une fiche tel qu'il est enregistré sur le disque. */
export async function lireFicheSurDisque(dossier: string, id: string): Promise<AvecYdoc | null> {
  const octets = await new ProjectStore(dossier).readContent(id)
  if (!octets) return null
  const ydoc = new Y.Doc()
  Y.applyUpdate(ydoc, octets)
  return { ydoc }
}

/** Lit les métadonnées (titre, type, parent…) d'une fiche sur le disque. */
export async function lireMetaSurDisque(dossier: string, id: string): Promise<{ title: string } | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(dossier, 'documents', `${id}.json`), 'utf8'))
  } catch {
    return null
  }
}

export async function fichierExiste(chemin: string): Promise<boolean> {
  return fs.stat(chemin).then(
    () => true,
    () => false
  )
}
