/// <reference types="vite/client" />
import type { DocMeta, TypeDef } from '@shared/model'

export interface ProjectSnapshot {
  path: string
  name: string
  types: TypeDef[]
  docs: DocMeta[]
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
      onFlushRequest(cb: () => Promise<void>): void
    }
  }
}
