import { useEffect, useState } from 'react'
import { imageHash, imageMime, MAX_IMAGE_BYTES } from '@shared/images'
import type { Library } from './library'

const cache = new WeakMap<Library, Map<string, Promise<string | null>>>()

function urlFor(lib: Library, hash: string): Promise<string | null> {
  let m = cache.get(lib)
  if (!m) cache.set(lib, (m = new Map()))
  let p = m.get(hash)
  if (!p) {
    p = lib
      .getImage(hash)
      .then((bytes) => {
        if (!bytes) return null
        const mime = imageMime(bytes) ?? 'application/octet-stream'
        return URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
      })
      .catch(() => null)
    p.then((u) => {
      if (u === null) m!.delete(hash) // réessai possible plus tard
    })
    m.set(hash, p)
  }
  return p
}

export function useImageUrl(lib: Library, hash: string | null): { url: string | null; loading: boolean } {
  const [state, setState] = useState<{ url: string | null; loading: boolean }>({ url: null, loading: !!hash })
  useEffect(() => {
    if (!hash) return setState({ url: null, loading: false })
    let alive = true
    setState((s) => ({ url: s.url, loading: true }))
    void urlFor(lib, hash).then((url) => alive && setState({ url, loading: false }))
    return () => {
      alive = false
    }
  }, [lib, hash])
  return state
}

/** Lit un fichier choisi par l'utilisateur, l'envoie dans la bibliothèque, renvoie son empreinte. */
export async function storeImageFile(lib: Library, file: Blob): Promise<string> {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Image trop lourde (15 Mo maximum).')
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!imageMime(bytes)) throw new Error('Format non pris en charge : PNG, JPEG, GIF ou WebP.')
  const hash = await imageHash(bytes)
  await lib.putImage(hash, bytes)
  return hash
}
