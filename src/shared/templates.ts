// Modèles proposés en un clic. Les identifiants sont fixes : un Personnage créé
// chez deux personnes a le même type, ce qui évite les doublons à la copie.

import type { Field, TypeDef } from './model'
import { DEFAULT_ABILITY } from './model'

const ability = (id: string, name: string): Field => ({ id, name, kind: 'ability', ability: { ...DEFAULT_ABILITY } })
const num = (id: string, name: string): Field => ({ id, name, kind: 'number' })

export const TEMPLATES: TypeDef[] = [
  {
    id: 'modele-note',
    name: 'Note',
    order: 1,
    fields: [{ id: 'contenu', name: 'Contenu', kind: 'richtext' }]
  },
  {
    id: 'modele-lieu',
    name: 'Lieu',
    order: 2,
    fields: [
      { id: 'region', name: 'Région', kind: 'text' },
      { id: 'illustration', name: 'Illustration', kind: 'image' },
      { id: 'description', name: 'Description', kind: 'richtext' },
      {
        id: 'points-interet',
        name: "Points d'intérêt",
        kind: 'list',
        subfields: [
          { id: 'nom', name: 'Nom', kind: 'text' },
          { id: 'description', name: 'Description', kind: 'richtext' }
        ]
      }
    ]
  },
  {
    id: 'modele-personnage',
    name: 'Personnage',
    order: 3,
    fields: [
      { id: 'portrait', name: 'Portrait', kind: 'image' },
      { id: 'race', name: 'Race', kind: 'text' },
      { id: 'classe', name: 'Classe', kind: 'text' },
      {
        id: 'alignement',
        name: 'Alignement',
        kind: 'select',
        options: [
          'Loyal bon',
          'Neutre bon',
          'Chaotique bon',
          'Loyal neutre',
          'Neutre',
          'Chaotique neutre',
          'Loyal mauvais',
          'Neutre mauvais',
          'Chaotique mauvais'
        ]
      },
      num('niveau', 'Niveau'),
      ability('for', 'Force'),
      ability('dex', 'Dextérité'),
      ability('con', 'Constitution'),
      ability('int', 'Intelligence'),
      ability('sag', 'Sagesse'),
      ability('cha', 'Charisme'),
      { id: 'pv', name: 'Points de vie', kind: 'gauge' },
      num('ca', "Classe d'armure"),
      { id: 'histoire', name: 'Histoire', kind: 'richtext' }
    ]
  },
  {
    id: 'modele-inventaire',
    name: 'Inventaire',
    order: 4,
    fields: [
      num('po', "Pièces d'or"),
      {
        id: 'objets',
        name: 'Objets',
        kind: 'list',
        subfields: [
          { id: 'nom', name: 'Nom', kind: 'text' },
          num('quantite', 'Quantité'),
          { id: 'equipe', name: 'Équipé', kind: 'checkbox' },
          { id: 'description', name: 'Description', kind: 'richtext' }
        ]
      }
    ]
  }
]
