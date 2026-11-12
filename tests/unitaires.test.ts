// Tests unitaires : le contenu d'une fiche, sans serveur ni réseau.
//
// Lancer : npm test

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import * as Y from 'yjs'
import { collectImages, ensureFields, newListItem } from '@shared/content'
import type { Field, TypeDef } from '@shared/model'
import { collectTexts } from '@shared/search'
import { champs, insererTexte } from './outils'

/** Construit un type de fiche de test avec les champs donnés. */
function typeDeTest(champsDuType: Field[]): TypeDef {
  return { id: 'type-test', name: 'Type de test', order: 1, fields: champsDuType }
}

describe('Contenu des fiches', () => {
  test('un texte dans une liste à trois niveaux est trouvé par la recherche', () => {
    // Un type avec une liste « Objets » qui contient une sous-liste « Détails ».
    const type = typeDeTest([
      {
        id: 'objets',
        name: 'Objets',
        kind: 'list',
        subfields: [
          { id: 'nom', name: 'Nom', kind: 'text' },
          { id: 'details', name: 'Détails', kind: 'list', subfields: [{ id: 'note', name: 'Note', kind: 'text' }] }
        ]
      }
    ])
    const fiche = { ydoc: new Y.Doc() }
    ensureFields(fiche.ydoc, type)

    // On ajoute un objet, puis un détail dans cet objet, puis un texte dans ce détail.
    const objets = type.fields[0].subfields!
    const objet = newListItem(objets)
    ;(champs(fiche).get('objets') as Y.Array<Y.Map<unknown>>).push([objet])
    const detail = newListItem(objets[1].subfields!)
    ;(objet.get('details') as Y.Array<Y.Map<unknown>>).push([detail])
    ;(detail.get('note') as Y.Text).insert(0, 'caché tout au fond')

    const textes = collectTexts(fiche.ydoc, type)
    const trouve = textes.find((t) => t.text === 'caché tout au fond')
    assert.ok(trouve, 'le texte profond doit être indexé')
    assert.equal(trouve.label, 'Objets 1 › Détails 1 › Note')
  })

  test("changer le genre d'un champ conserve sa valeur", () => {
    // Le même champ « valeur » passe par quatre genres successifs.
    const avecGenre = (kind: Field['kind']) => typeDeTest([{ id: 'valeur', name: 'Valeur', kind }])
    const fiche = { ydoc: new Y.Doc() }

    ensureFields(fiche.ydoc, avecGenre('text'))
    insererTexte(fiche, 'valeur', 0, '17')

    ensureFields(fiche.ydoc, avecGenre('ability'))
    assert.equal(champs(fiche).get('valeur'), 17, 'texte → caractéristique : devient le nombre 17')

    ensureFields(fiche.ydoc, avecGenre('gauge'))
    const jauge = champs(fiche).get('valeur') as Y.Map<unknown>
    assert.equal(jauge.get('cur'), 17, 'caractéristique → jauge : 17 devient la valeur actuelle')

    const typeRiche = avecGenre('richtext')
    ensureFields(fiche.ydoc, typeRiche)
    const texte = collectTexts(fiche.ydoc, typeRiche).find((t) => t.path === 'valeur')
    assert.equal(texte?.text, '17 / ', 'jauge → texte riche : la valeur est écrite en texte')
  })

  test("les images d'une fiche sont retrouvées (pour les copier avec elle)", () => {
    const type = typeDeTest([{ id: 'portrait', name: 'Portrait', kind: 'image' }])
    const fiche = { ydoc: new Y.Doc() }
    ensureFields(fiche.ydoc, type)

    const empreinte = 'a'.repeat(40) // une empreinte d'image fictive
    ;(champs(fiche).get('portrait') as Y.Map<unknown>).set('img', empreinte)

    assert.deepEqual(collectImages(Y.encodeStateAsUpdate(fiche.ydoc)), [empreinte])
  })
})
