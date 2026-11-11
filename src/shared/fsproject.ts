// Lecture / écriture d'un dossier de projet Kotari (Node uniquement).
// Utilisé par le process main du client et par kotari-server.
//
//   kotari.json            nom, version du format
//   types/<id>.json        définition d'un type
//   documents/<id>.json    méta (titre, type, parent, ordre)
//   documents/<id>.yjs     contenu Yjs

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { imageMime, isImageHash, MAX_IMAGE_BYTES } from './images'
import path from 'node:path'
import type { DocMeta, ProjectInfo, TypeDef } from './model'
import { FORMAT_VERSION, isDocMeta, isSafeId, isTypeDef, pickMeta } from './model'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Écrit dans un fichier temporaire puis renomme : jamais de fichier à moitié écrit. */
export async function atomicWrite(file: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, data)
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmp, file)
      return
    } catch (err) {
      // Windows : un antivirus ou un indexeur peut verrouiller le fichier un instant.
      if (attempt >= 5) {
        await fs.rm(tmp, { force: true })
        throw err
      }
      await sleep(50 * (attempt + 1))
    }
  }
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, 'utf8'))
}

function checkId(id: string): string {
  if (!isSafeId(id)) throw new Error(`Identifiant invalide : ${id}`)
  return id
}

export class ProjectStore {
  readonly root: string

  constructor(root: string) {
    this.root = path.resolve(root)
  }

  private p(...parts: string[]) {
    return path.join(this.root, ...parts)
  }

  static async isProject(root: string): Promise<boolean> {
    try {
      const info = (await readJson(path.join(root, 'kotari.json'))) as ProjectInfo
      return typeof info?.name === 'string'
    } catch {
      return false
    }
  }

  /** Crée la structure (dossier vide ou inexistant). */
  static async init(root: string, name: string, types: TypeDef[] = []): Promise<ProjectStore> {
    const store = new ProjectStore(root)
    await fs.mkdir(store.p('types'), { recursive: true })
    await fs.mkdir(store.p('documents'), { recursive: true })
    const info: ProjectInfo = { name, formatVersion: FORMAT_VERSION }
    await atomicWrite(store.p('kotari.json'), JSON.stringify(info, null, 2))
    for (const t of types) await store.writeType(t)
    return store
  }

  async ensureDirs(): Promise<void> {
    await fs.mkdir(this.p('types'), { recursive: true })
    await fs.mkdir(this.p('documents'), { recursive: true })
  }

  async readInfo(): Promise<ProjectInfo> {
    const info = (await readJson(this.p('kotari.json'))) as ProjectInfo
    if (typeof info?.name !== 'string') throw new Error("kotari.json invalide")
    if (info.formatVersion > FORMAT_VERSION) {
      throw new Error('Ce projet a été créé par une version plus récente de Kotari.')
    }
    return info
  }

  async listTypes(): Promise<TypeDef[]> {
    const out: TypeDef[] = []
    for (const name of await this.safeReaddir('types')) {
      if (!name.endsWith('.json')) continue
      try {
        const t = await readJson(this.p('types', name))
        if (isTypeDef(t)) out.push(t)
      } catch {
        /* fichier illisible : ignoré */
      }
    }
    return out.sort((a, b) => a.order - b.order)
  }

  async listDocs(): Promise<DocMeta[]> {
    const out: DocMeta[] = []
    for (const name of await this.safeReaddir('documents')) {
      if (!name.endsWith('.json')) continue
      try {
        const d = await readJson(this.p('documents', name))
        if (isDocMeta(d)) out.push(pickMeta(d))
      } catch {
        /* ignoré */
      }
    }
    return out
  }

  private async safeReaddir(dir: string): Promise<string[]> {
    try {
      return await fs.readdir(this.p(dir))
    } catch {
      return []
    }
  }

  async writeType(t: TypeDef): Promise<void> {
    await atomicWrite(this.p('types', `${checkId(t.id)}.json`), JSON.stringify(t, null, 2))
  }

  async deleteType(id: string): Promise<void> {
    await fs.rm(this.p('types', `${checkId(id)}.json`), { force: true })
  }

  async writeMeta(meta: DocMeta): Promise<void> {
    await atomicWrite(this.p('documents', `${checkId(meta.id)}.json`), JSON.stringify(pickMeta(meta), null, 2))
  }

  async readContent(id: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await fs.readFile(this.p('documents', `${checkId(id)}.yjs`)))
    } catch {
      return null
    }
  }

  async writeContent(id: string, data: Uint8Array): Promise<void> {
    await atomicWrite(this.p('documents', `${checkId(id)}.yjs`), data)
  }

  async readImage(hash: string): Promise<Uint8Array | null> {
    if (!isImageHash(hash)) return null
    try {
      return new Uint8Array(await fs.readFile(this.p('images', hash)))
    } catch {
      return null
    }
  }

  async hasImage(hash: string): Promise<boolean> {
    if (!isImageHash(hash)) return false
    try {
      await fs.access(this.p('images', hash))
      return true
    } catch {
      return false
    }
  }

  /** Vérifie l'empreinte et le format avant d'écrire. */
  async writeImage(hash: string, data: Uint8Array): Promise<void> {
    if (!isImageHash(hash)) throw new Error('Empreinte invalide.')
    if (data.length > MAX_IMAGE_BYTES) throw new Error('Image trop lourde (15 Mo maximum).')
    if (!imageMime(data)) throw new Error('Format non pris en charge (PNG, JPEG, GIF ou WebP).')
    const real = createHash('sha256').update(data).digest('hex').slice(0, 40)
    if (real !== hash) throw new Error('Empreinte incorrecte.')
    if (await this.hasImage(hash)) return
    await fs.mkdir(this.p('images'), { recursive: true })
    await atomicWrite(this.p('images', hash), data)
  }

  async deleteDoc(id: string): Promise<void> {
    checkId(id)
    await fs.rm(this.p('documents', `${id}.json`), { force: true })
    await fs.rm(this.p('documents', `${id}.yjs`), { force: true })
  }
}
