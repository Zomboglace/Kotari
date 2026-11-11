// Copie d'un sous-arbre d'une bibliothèque à l'autre (local <-> serveur).
// Nouveaux identifiants, parents remappés, types emportés si besoin.

import type { DocMeta, TypeDef } from './model'
import { newId, sameFields } from './model'

export interface ExportedDoc {
  meta: DocMeta
  content: Uint8Array
}

export interface CopyPlan {
  docs: ExportedDoc[]
  /** Types à créer dans la bibliothèque de destination. */
  newTypes: TypeDef[]
}

function uniqueName(base: string, taken: Set<string>): string {
  for (let i = 2; ; i++) {
    const name = `${base} (${i})`
    if (!taken.has(name)) return name
  }
}

/**
 * @param source  le sous-arbre exporté, racine en premier
 */
export function planCopy(
  source: ExportedDoc[],
  sourceTypes: TypeDef[],
  destTypes: TypeDef[],
  destParentId: string | null,
  destOrder: number
): CopyPlan {
  if (!source.length) return { docs: [], newTypes: [] }

  const destById = new Map(destTypes.map((t) => [t.id, t]))
  const srcById = new Map(sourceTypes.map((t) => [t.id, t]))
  const takenNames = new Set(destTypes.map((t) => t.name))
  let maxOrder = destTypes.reduce((m, t) => Math.max(m, t.order), 0)

  const typeMap = new Map<string, string>()
  const newTypes: TypeDef[] = []

  for (const typeId of new Set(source.map((d) => d.meta.typeId))) {
    const src = srcById.get(typeId)
    const dest = destById.get(typeId)
    if (!src) {
      // Type introuvable à la source : on garde l'id, la fiche s'affichera vide.
      typeMap.set(typeId, typeId)
    } else if (!dest) {
      newTypes.push({ ...structuredClone(src), order: ++maxOrder })
      takenNames.add(src.name)
      typeMap.set(typeId, typeId)
    } else if (sameFields(src, dest)) {
      typeMap.set(typeId, typeId)
    } else {
      const name = uniqueName(src.name, takenNames)
      takenNames.add(name)
      const copy: TypeDef = { ...structuredClone(src), id: newId(), name, order: ++maxOrder }
      newTypes.push(copy)
      typeMap.set(typeId, copy.id)
    }
  }

  const idMap = new Map(source.map((d) => [d.meta.id, newId()]))
  const rootId = source[0].meta.id

  const docs = source.map(({ meta, content }) => ({
    meta: {
      id: idMap.get(meta.id)!,
      title: meta.title,
      typeId: typeMap.get(meta.typeId)!,
      parentId: meta.id === rootId ? destParentId : (idMap.get(meta.parentId ?? '') ?? destParentId),
      order: meta.id === rootId ? destOrder : meta.order
    },
    content
  }))

  return { docs, newTypes }
}
