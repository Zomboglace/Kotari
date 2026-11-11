import { createContext, useContext, useEffect, useState } from 'react'
import type * as Y from 'yjs'

/** Valeur d'une clé d'un Y.Map, mise à jour quand elle change. */
export function useYMapValue<T = unknown>(map: Y.Map<unknown>, key: string): T | undefined {
  const [value, setValue] = useState(() => map.get(key) as T | undefined)
  useEffect(() => {
    setValue(map.get(key) as T | undefined)
    const h = (e: Y.YMapEvent<unknown>) => {
      if (e.keysChanged.has(key)) setValue(map.get(key) as T | undefined)
    }
    map.observe(h)
    return () => map.unobserve(h)
  }, [map, key])
  return value
}

/** Éléments d'un Y.Array (niveau supérieur seulement). */
export function useYArray<T>(arr: Y.Array<T>): T[] {
  const [items, setItems] = useState(() => arr.toArray())
  useEffect(() => {
    setItems(arr.toArray())
    const h = () => setItems(arr.toArray())
    arr.observe(h)
    return () => arr.unobserve(h)
  }, [arr])
  return items
}

// ---- Confirmation et notifications, fournies par App ----

export interface UiApi {
  confirm(opts: { title: string; message: string; confirmLabel?: string; danger?: boolean }): Promise<boolean>
  toast(message: string, kind?: 'info' | 'error'): void
}

export const UiContext = createContext<UiApi>({
  confirm: async () => false,
  toast: () => {}
})

export const useUi = () => useContext(UiContext)

// ---- Petites préférences locales (navigateur de l'app) ----

export function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function savePref(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* stockage indisponible : sans importance */
  }
}
