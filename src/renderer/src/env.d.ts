/// <reference types="vite/client" />
import type { DocMeta, TypeDef } from '@shared/model'
import type { SearchHit } from '@shared/search'

export interface ProjectSnapshot {
  path: string
  name: string
  types: TypeDef[]
  docs: DocMeta[]
}

export interface SavedServerInfo {
  id: string
  host: string
  port: number
  secure?: boolean
  name: string
  hasPassword: boolean
  lastUsed: number
}

declare global {
  interface Window {
    kotari: {
      createProject(name: string, withTemplates: boolean): Promise<ProjectSnapshot | null>
      openProject(): Promise<ProjectSnapshot | null>
      openProjectPath(p: string): Promise<ProjectSnapshot>
      closeProject(): Promise<void>
      revealProject(): Promise<void>
      writeType(t: TypeDef): Promise<void>
      deleteType(id: string): Promise<void>
      writeMeta(m: DocMeta): Promise<void>
      deleteDoc(id: string): Promise<void>
      readContent(id: string): Promise<Uint8Array | null>
      writeContent(id: string, data: Uint8Array): Promise<void>
      readImage(hash: string): Promise<Uint8Array | null>
      writeImage(hash: string, data: Uint8Array): Promise<void>
      missingImages(hashes: string[]): Promise<string[]>
      search(query: string, ids?: string[]): Promise<SearchHit[]>
      listServers(): Promise<SavedServerInfo[]>
      rememberServer(entry: { host: string; port: number; secure?: boolean; name: string }, password: string | null | undefined): Promise<void>
      serverPassword(id: string): Promise<string | null>
      forgetServer(id: string): Promise<void>
      appVersion(): Promise<string>
      updateStatus(): Promise<string | null>
      checkUpdate(): Promise<'dev' | 'available' | 'none' | 'error'>
      installUpdate(): Promise<void>
      onUpdateReady(cb: (version: string) => void): void
      onFlushRequest(cb: () => Promise<void>): void
    }
  }
}
