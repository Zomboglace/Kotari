// Modèles proposés en un clic. Les identifiants sont fixes : un Personnage créé
// chez deux personnes a le même type, ce qui évite les doublons à la copie.

import type { TypeDef } from './model'

const stat = (id: string, name: string) => ({ id, name, kind: 'number' as const })

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
      { id: 'race', name: 'Race', kind: 'text' },
      { id: 'classe', name: 'Classe', kind: 'text' },
      stat('niveau', 'Niveau'),
      stat('for', 'Force'),
      stat('dex', 'Dextérité'),
      stat('con', 'Constitution'),
      stat('int', 'Intelligence'),
      stat('sag', 'Sagesse'),
      stat('cha', 'Charisme'),
      stat('pv', 'Points de vie'),
      stat('ca', "Classe d'armure"),
      { id: 'histoire', name: 'Histoire', kind: 'richtext' }
    ]
  },
  {
    id: 'modele-inventaire',
    name: 'Inventaire',
    order: 4,
    fields: [
      stat('po', "Pièces d'or"),
      {
        id: 'objets',
        name: 'Objets',
        kind: 'list',
        subfields: [
          { id: 'nom', name: 'Nom', kind: 'text' },
          { id: 'quantite', name: 'Quantité', kind: 'number' },
          { id: 'description', name: 'Description', kind: 'richtext' }
        ]
      }
    ]
  }
]

/** Les caractéristiques D&D affichent leur modificateur à côté de la valeur. */
export const ABILITY_FIELD_IDS = new Set(['for', 'dex', 'con', 'int', 'sag', 'cha'])
