import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import type { Field, SubField } from '@shared/model'
import { ensureListItem, newListItem, readNumber } from '@shared/content'
import { useUi, useYArray, useYMapValue } from '../lib/hooks'
import { applyTextDiff, transformIndex } from '../lib/ytext'
import { RichText } from './RichText'

export interface FieldCtx {
  provider: unknown | null
  user: { name: string; color: string } | null
  /** Affiche le modificateur D&D à côté de ces champs nombre. */
  abilityIds?: Set<string>
}

// ---------- Texte ----------

export function TextInput({ ytext, placeholder }: { ytext: Y.Text; placeholder?: string }) {
  const [value, setValue] = useState(() => ytext.toString())
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setValue(ytext.toString())
    const h = (e: Y.YTextEvent, tr: Y.Transaction) => {
      const el = ref.current
      const next = ytext.toString()
      if (!tr.local && el && document.activeElement === el) {
        // Modification distante pendant la saisie : on garde le curseur au bon endroit.
        const delta = e.delta as Parameters<typeof transformIndex>[0]
        const s = transformIndex(delta, el.selectionStart ?? 0)
        const en = transformIndex(delta, el.selectionEnd ?? 0)
        setValue(next)
        requestAnimationFrame(() => el.setSelectionRange(s, en))
      } else {
        setValue(next)
      }
    }
    ytext.observe(h)
    return () => ytext.unobserve(h)
  }, [ytext])

  return (
    <input
      ref={ref}
      className="input"
      value={value}
      placeholder={placeholder}
      onChange={(e) => {
        setValue(e.target.value)
        applyTextDiff(ytext, e.target.value)
      }}
    />
  )
}

// ---------- Nombre ----------

function modifier(v: number): string {
  const m = Math.floor((v - 10) / 2)
  return m >= 0 ? `+${m}` : `${m}`
}

export function NumberInput({ map, fieldKey, ability }: { map: Y.Map<unknown>; fieldKey: string; ability?: boolean }) {
  const stored = readNumber(useYMapValue(map, fieldKey))
  const [draft, setDraft] = useState(stored === null ? '' : String(stored))
  const focused = useRef(false)

  useEffect(() => {
    const cur = draft.trim() === '' ? null : Number(draft.replace(',', '.'))
    if (!focused.current || cur !== stored) setDraft(stored === null ? '' : String(stored))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored])

  return (
    <div className="number-wrap">
      <input
        className="input number"
        inputMode="decimal"
        value={draft}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false
          setDraft(stored === null ? '' : String(stored))
        }}
        onChange={(e) => {
          const raw = e.target.value
          setDraft(raw)
          if (raw.trim() === '') return map.set(fieldKey, null)
          const n = Number(raw.replace(',', '.'))
          if (Number.isFinite(n)) map.set(fieldKey, n)
        }}
      />
      {ability && stored !== null && <span className="modifier">{modifier(stored)}</span>}
    </div>
  )
}

// ---------- Valeur d'un champ ou sous-champ ----------

function FieldValue({
  map,
  field,
  ctx,
  compact
}: {
  map: Y.Map<unknown>
  field: Field | SubField
  ctx: FieldCtx
  compact?: boolean
}) {
  const value = useYMapValue(map, field.id)
  switch (field.kind) {
    case 'text':
      return value instanceof Y.Text ? <TextInput ytext={value} /> : <Pending />
    case 'number':
      return <NumberInput map={map} fieldKey={field.id} ability={ctx.abilityIds?.has(field.id)} />
    case 'richtext':
      return value instanceof Y.XmlFragment ? (
        <RichText fragment={value} provider={ctx.provider} user={ctx.user} compact={compact} />
      ) : (
        <Pending />
      )
    case 'list':
      return value instanceof Y.Array ? (
        <ListField arr={value as Y.Array<Y.Map<unknown>>} subfields={(field as Field).subfields ?? []} ctx={ctx} />
      ) : (
        <Pending />
      )
  }
}

const Pending = () => <div className="pending">…</div>

// ---------- Liste ----------

function ListItem({
  item,
  index,
  count,
  subfields,
  ctx,
  onMove,
  onRemove
}: {
  item: Y.Map<unknown>
  index: number
  count: number
  subfields: SubField[]
  ctx: FieldCtx
  onMove: (from: number, to: number) => void
  onRemove: (i: number) => void
}) {
  useEffect(() => ensureListItem(item, subfields), [item, subfields])
  const inline = subfields.filter((s) => s.kind !== 'richtext')
  const blocks = subfields.filter((s) => s.kind === 'richtext')
  return (
    <div className="list-item">
      <div className="list-item-row">
        {inline.map((s) => (
          <label key={s.id} className={`sub ${s.kind}`}>
            <span className="sub-label">{s.name}</span>
            <FieldValue map={item} field={s} ctx={ctx} />
          </label>
        ))}
        <div className="list-item-actions">
          <button className="icon-btn" title="Monter" disabled={index === 0} onClick={() => onMove(index, index - 1)}>
            ↑
          </button>
          <button
            className="icon-btn"
            title="Descendre"
            disabled={index === count - 1}
            onClick={() => onMove(index, index + 1)}
          >
            ↓
          </button>
          <button className="icon-btn danger" title="Retirer" onClick={() => onRemove(index)}>
            ×
          </button>
        </div>
      </div>
      {blocks.map((s) => (
        <div key={s.id} className="sub block">
          <span className="sub-label">{s.name}</span>
          <FieldValue map={item} field={s} ctx={ctx} compact />
        </div>
      ))}
    </div>
  )
}

export function ListField({
  arr,
  subfields,
  ctx
}: {
  arr: Y.Array<Y.Map<unknown>>
  subfields: SubField[]
  ctx: FieldCtx
}) {
  const items = useYArray(arr)
  const ui = useUi()

  const move = (from: number, to: number) => {
    if (to < 0 || to >= arr.length) return
    // Un type Yjs ne peut pas être réinséré : on déplace une copie.
    arr.doc?.transact(() => {
      const copy = arr.get(from).clone()
      arr.delete(from, 1)
      arr.insert(to, [copy])
    })
  }
  const remove = async (i: number) => {
    if (await ui.confirm({ title: 'Retirer cet élément ?', message: 'Son contenu sera supprimé.', confirmLabel: 'Retirer', danger: true })) {
      if (i < arr.length) arr.delete(i, 1)
    }
  }

  return (
    <div className="list-field">
      {items.length === 0 && <div className="muted small">Aucun élément.</div>}
      {items.map((item, i) => (
        <ListItem
          key={(item.get('id') as string) ?? i}
          item={item}
          index={i}
          count={items.length}
          subfields={subfields}
          ctx={ctx}
          onMove={move}
          onRemove={remove}
        />
      ))}
      <button className="btn ghost small" onClick={() => arr.push([newListItem(subfields)])}>
        + Ajouter un élément
      </button>
    </div>
  )
}

// ---------- Formulaire complet ----------

export function FieldsForm({ fieldsMap, fields, ctx }: { fieldsMap: Y.Map<unknown>; fields: Field[]; ctx: FieldCtx }) {
  // Les nombres qui se suivent sont regroupés en grille (caractéristiques, PV, CA…).
  const groups: Field[][] = []
  for (const f of fields) {
    const last = groups[groups.length - 1]
    if (f.kind === 'number' && last && last[0].kind === 'number') last.push(f)
    else groups.push([f])
  }
  if (!fields.length) return <div className="muted">Ce type n'a encore aucun champ. Ajoute-en dans l'écran Types.</div>

  return (
    <div className="fields">
      {groups.map((g) =>
        g[0].kind === 'number' ? (
          <div key={g[0].id} className="num-grid">
            {g.map((f) => (
              <label key={f.id} className="field num">
                <span className="field-label">{f.name}</span>
                <FieldValue map={fieldsMap} field={f} ctx={ctx} />
              </label>
            ))}
          </div>
        ) : (
          <div key={g[0].id} className={`field kind-${g[0].kind}`}>
            <span className="field-label">{g[0].name}</span>
            <FieldValue map={fieldsMap} field={g[0]} ctx={ctx} />
          </div>
        )
      )}
    </div>
  )
}
