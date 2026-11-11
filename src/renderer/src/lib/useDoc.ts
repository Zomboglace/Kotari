import { useEffect, useState } from 'react'
import { ensureFields } from '@shared/content'
import type { TypeDef } from '@shared/model'
import type { Library, OpenedDoc } from './library'

/** Ouvre un document tant que le composant est affiché, et complète ses champs selon le type. */
export function useOpenedDoc(lib: Library, id: string, exists: boolean, type: TypeDef | undefined) {
  const [opened, setOpened] = useState<OpenedDoc | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!exists) return
    let alive = true
    let od: OpenedDoc | null = null
    setError(null)
    lib
      .openDoc(id)
      .then((o) => {
        if (!alive) return o.close()
        od = o
        setOpened(o)
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
      od?.close()
      setOpened(null)
    }
  }, [lib, id, exists])

  useEffect(() => {
    if (opened && type) ensureFields(opened.ydoc, type)
  }, [opened, type])

  return { opened, error }
}
