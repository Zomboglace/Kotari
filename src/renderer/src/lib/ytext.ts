import * as Y from 'yjs'

/** Applique à un Y.Text la différence minimale avec la nouvelle valeur d'un champ. */
export function applyTextDiff(ytext: Y.Text, next: string): void {
  const prev = ytext.toString()
  if (prev === next) return
  let start = 0
  while (start < prev.length && start < next.length && prev[start] === next[start]) start++
  let endPrev = prev.length
  let endNext = next.length
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--
    endNext--
  }
  const run = () => {
    if (endPrev > start) ytext.delete(start, endPrev - start)
    if (endNext > start) ytext.insert(start, next.slice(start, endNext))
  }
  if (ytext.doc) ytext.doc.transact(run)
  else run()
}

type Delta = Array<{ insert?: unknown; retain?: number; delete?: number }>

/** Déplace une position de curseur selon une modification distante. */
export function transformIndex(delta: Delta, index: number): number {
  let pos = 0
  let out = index
  for (const op of delta) {
    if (pos > index) break
    if (op.retain) pos += op.retain
    else if (op.insert !== undefined) {
      const len = typeof op.insert === 'string' ? op.insert.length : 1
      if (pos <= index) out += len
      // l'insertion ne fait pas avancer la position dans le texte d'origine
    } else if (op.delete) {
      if (pos < index) out -= Math.min(op.delete, index - pos)
      pos += op.delete
    }
  }
  return Math.max(0, out)
}
