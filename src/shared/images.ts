// Images : stockées par empreinte (SHA-256) dans images/<hash>, donc jamais en double
// et copiables d'une bibliothèque à l'autre sans changer leur identifiant.

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024

const HASH = /^[0-9a-f]{40}$/

export function isImageHash(h: unknown): h is string {
  return typeof h === 'string' && HASH.test(h)
}

export function imageMime(b: Uint8Array): string | null {
  if (b.length < 12) return null
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return 'image/webp'
  return null
}

export async function imageHash(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40)
}
