import { useRef, useState } from 'react'
import type * as Y from 'yjs'
import { readNumber } from '@shared/content'
import { isImageHash } from '@shared/images'
import { useUi, useYMapValue } from '../lib/hooks'
import { storeImageFile, useImageUrl } from '../lib/images'
import type { Library } from '../lib/library'

/** Champ image : la largeur (en % de la fiche) se règle en tirant le coin de l'image. */
export function ImageField({ map, lib }: { map: Y.Map<unknown>; lib: Library }) {
  const ui = useUi()
  const raw = useYMapValue(map, 'img')
  const hash = isImageHash(raw) ? raw : null
  const width = readNumber(useYMapValue(map, 'w')) ?? 60
  const { url, loading } = useImageUrl(lib, hash)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [liveWidth, setLiveWidth] = useState<number | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const frame = useRef<HTMLDivElement>(null)

  const upload = async (file: Blob | undefined | null) => {
    if (!file) return
    setBusy(true)
    try {
      map.set('img', await storeImageFile(lib, file))
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const parent = frame.current?.parentElement
    if (!parent) return
    const full = parent.getBoundingClientRect().width
    const left = frame.current!.getBoundingClientRect().left
    const move = (ev: PointerEvent) => {
      const pct = Math.round(((ev.clientX - left) / full) * 100)
      setLiveWidth(Math.max(10, Math.min(100, pct)))
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const pct = Math.round(((ev.clientX - left) / full) * 100)
      map.set('w', Math.max(10, Math.min(100, pct)))
      setLiveWidth(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const picker = (
    <input
      ref={input}
      type="file"
      accept="image/png,image/jpeg,image/gif,image/webp"
      hidden
      onChange={(e) => {
        void upload(e.target.files?.[0])
        e.target.value = ''
      }}
    />
  )

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (![...e.dataTransfer.types].includes('Files')) return
      e.preventDefault()
      e.stopPropagation()
      setDragOver(true)
    },
    onDragLeave: () => setDragOver(false),
    onDrop: (e: React.DragEvent) => {
      if (!e.dataTransfer.files.length) return
      e.preventDefault()
      e.stopPropagation()
      setDragOver(false)
      void upload(e.dataTransfer.files[0])
    },
    onPaste: (e: React.ClipboardEvent) => {
      const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'))
      if (file) {
        e.preventDefault()
        void upload(file)
      }
    }
  }

  if (!hash) {
    return (
      <div
        className={`image-drop ${dragOver ? 'over' : ''}`}
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}
        {...dropProps}
      >
        {picker}
        {busy ? 'Envoi…' : 'Cliquer, glisser une image ou coller (Ctrl+V)'}
      </div>
    )
  }

  const w = liveWidth ?? width
  return (
    <div className="image-wrap" {...dropProps} tabIndex={-1}>
      {picker}
      <div ref={frame} className={`image-frame ${dragOver ? 'over' : ''}`} style={{ width: `${w}%` }}>
        {url ? <img src={url} alt="" draggable={false} /> : <div className="image-missing">{loading ? 'Chargement…' : 'Image introuvable'}</div>}
        <div className="image-tools">
          <span className="image-size">{w} %</span>
          <button className="btn tiny" onClick={() => input.current?.click()}>
            Remplacer
          </button>
          <button className="btn tiny danger" onClick={() => map.set('img', null)}>
            Retirer
          </button>
        </div>
        <div className="image-handle" title="Tirer pour redimensionner" onPointerDown={startResize} onDoubleClick={() => map.set('w', 60)} />
      </div>
    </div>
  )
}
