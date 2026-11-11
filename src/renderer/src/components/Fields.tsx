import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import type { Field } from '@shared/model'
import { abilityModifier, DEFAULT_ABILITY, formatModifier } from '@shared/model'
import { ensureListItem, newListItem, readNumber } from '@shared/content'
import { fold } from '@shared/search'
import { flash, focusKey, registerFocus } from '../lib/focus'
import { useUi, useYArray, useYMapValue } from '../lib/hooks'
import type { Library } from '../lib/library'
import { applyTextDiff, transformIndex } from '../lib/ytext'
import { ImageField } from './ImageField'
import { RichText } from './RichText'

export interface FieldCtx {
  lib: Library
  docId: string
  provider: unknown | null
  user: { name: string; color: string } | null
}

// ---------- Texte ----------

export function TextInput({ ytext, placeholder, fkey }: { ytext: Y.Text; placeholder?: string; fkey?: string }) {
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

  useEffect(() => {
    if (!fkey) return
    return registerFocus(fkey, (query, nth) => selectInInput(ref.current, query, nth))
  }, [fkey])

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

/** Sélectionne la n-ième occurrence dans un champ de saisie. */
export function selectInInput(el: HTMLInputElement | null, query: string, nth: number): boolean {
  if (!el) return false
  const q = fold(query.trim())
  const t = fold(el.value)
  let i = t.indexOf(q)
  for (let k = 0; k < nth && i !== -1; k++) i = t.indexOf(q, i + q.length)
  if (i === -1) return false
  el.scrollIntoView({ block: 'center' })
  el.focus()
  el.setSelectionRange(i, i + q.length)
  flash(el)
  return true
}

// ---------- Nombre ----------

export function NumberInput({
  map,
  fieldKey,
  placeholder
}: {
  map: Y.Map<unknown>
  fieldKey: string
  placeholder?: string
}) {
  const stored = readNumber(useYMapValue(map, fieldKey))
  const [draft, setDraft] = useState(stored === null ? '' : String(stored))
  const focused = useRef(false)

  useEffect(() => {
    const cur = draft.trim() === '' ? null : Number(draft.replace(',', '.'))
    if (!focused.current || cur !== stored) setDraft(stored === null ? '' : String(stored))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored])

  return (
    <input
      className="input number"
      inputMode="decimal"
      value={draft}
      placeholder={placeholder}
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
  )
}

function AbilityInput({ map, field }: { map: Y.Map<unknown>; field: Field }) {
  const v = readNumber(useYMapValue(map, field.id))
  return (
    <div className="ability">
      <span className="ability-mod" title="Modificateur">
        {v === null ? '—' : formatModifier(abilityModifier(v, field.ability ?? DEFAULT_ABILITY))}
      </span>
      <NumberInput map={map} fieldKey={field.id} />
    </div>
  )
}

function GaugeInput({ gauge }: { gauge: Y.Map<unknown> }) {
  const cur = readNumber(useYMapValue(gauge, 'cur'))
  const max = readNumber(useYMapValue(gauge, 'max'))
  const pct = cur !== null && max ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0
  const step = (d: number) => gauge.set('cur', (cur ?? 0) + d)
  return (
    <div className="gauge">
      <div className="gauge-row">
        <button className="icon-btn" title="−1" onClick={() => step(-1)}>
          −
        </button>
        <NumberInput map={gauge} fieldKey="cur" placeholder="actuel" />
        <span className="gauge-sep">/</span>
        <NumberInput map={gauge} fieldKey="max" placeholder="max" />
        <button className="icon-btn" title="+1" onClick={() => step(1)}>
          +
        </button>
      </div>
      <div className="gauge-bar">
        <div className={`gauge-fill ${pct <= 25 ? 'low' : ''}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function CheckboxInput({ map, fieldKey }: { map: Y.Map<unknown>; fieldKey: string }) {
  const v = useYMapValue(map, fieldKey) === true
  return (
    <label className="checkbox">
      <input type="checkbox" checked={v} onChange={(e) => map.set(fieldKey, e.target.checked)} />
      <span className="checkbox-box" />
    </label>
  )
}

function SelectInput({ map, field, fkey }: { map: Y.Map<unknown>; field: Field; fkey: string }) {
  const v = useYMapValue(map, field.id)
  const ref = useRef<HTMLSelectElement>(null)
  const value = typeof v === 'string' ? v : ''
  const options = field.options ?? []
  useEffect(
    () =>
      registerFocus(fkey, () => {
        if (!ref.current) return false
        ref.current.scrollIntoView({ block: 'center' })
        ref.current.focus()
        flash(ref.current)
        return true
      }),
    [fkey]
  )
  return (
    <select ref={ref} className="input select-field" value={value} onChange={(e) => map.set(field.id, e.target.value || null)}>
      <option value="">—</option>
      {value && !options.includes(value) && <option value={value}>{value}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}

// ---------- Valeur d'un champ (récursif) ----------

function FieldValue({
  map,
  field,
  ctx,
  path,
  compact
}: {
  map: Y.Map<unknown>
  field: Field
  ctx: FieldCtx
  path: string
  compact?: boolean
}) {
  const value = useYMapValue(map, field.id)
  const key = focusKey(ctx.docId, path)
  switch (field.kind) {
    case 'text':
      return value instanceof Y.Text ? <TextInput ytext={value} fkey={key} /> : <Pending />
    case 'number':
      return <NumberInput map={map} fieldKey={field.id} />
    case 'ability':
      return <AbilityInput map={map} field={field} />
    case 'gauge':
      return value instanceof Y.Map ? <GaugeInput gauge={value} /> : <Pending />
    case 'checkbox':
      return <CheckboxInput map={map} fieldKey={field.id} />
    case 'select':
      return <SelectInput map={map} field={field} fkey={key} />
    case 'richtext':
      return value instanceof Y.XmlFragment ? (
        <RichText fragment={value} provider={ctx.provider} user={ctx.user} compact={compact} focusKey={key} />
      ) : (
        <Pending />
      )
    case 'image':
      return value instanceof Y.Map ? <ImageField map={value} lib={ctx.lib} /> : <Pending />
    case 'list':
      return value instanceof Y.Array ? (
        <ListField arr={value as Y.Array<Y.Map<unknown>>} subfields={field.subfields ?? []} ctx={ctx} path={path} />
      ) : (
        <Pending />
      )
  }
}

const Pending = () => <div className="pending">…</div>

const INLINE_KINDS = new Set(['text', 'number', 'ability', 'checkbox', 'select'])

// ---------- Liste ----------

function ListItem({
  item,
  index,
  count,
  subfields,
  ctx,
  path,
  onMove,
  onRemove
}: {
  item: Y.Map<unknown>
  index: number
  count: number
  subfields: Field[]
  ctx: FieldCtx
  path: string
  onMove: (from: number, to: number) => void
  onRemove: (i: number) => void
}) {
  useEffect(() => ensureListItem(item, subfields), [item, subfields])
  const id = item.get('id') as string
  const inline = subfields.filter((s) => INLINE_KINDS.has(s.kind))
  const blocks = subfields.filter((s) => !INLINE_KINDS.has(s.kind))
  return (
    <div className="list-item">
      <div className="list-item-row">
        {inline.map((s) => (
          <label key={s.id} className={`sub kind-${s.kind}`}>
            <span className="sub-label">{s.name}</span>
            <FieldValue map={item} field={s} ctx={ctx} path={`${path}/${id}/${s.id}`} />
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
        <div key={s.id} className={`sub block kind-${s.kind}`}>
          <span className="sub-label">{s.name}</span>
          <FieldValue map={item} field={s} ctx={ctx} path={`${path}/${id}/${s.id}`} compact />
        </div>
      ))}
    </div>
  )
}

export function ListField({
  arr,
  subfields,
  ctx,
  path
}: {
  arr: Y.Array<Y.Map<unknown>>
  subfields: Field[]
  ctx: FieldCtx
  path: string
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
    if (
      await ui.confirm({ title: 'Retirer cet élément ?', message: 'Son contenu sera supprimé.', confirmLabel: 'Retirer', danger: true })
    ) {
      if (i < arr.length) arr.delete(i, 1)
    }
  }

  return (
    <div className="list-field">
      {items.length === 0 && <div className="muted small">Aucun élément.</div>}
      {items.map((item, i) =>
        item instanceof Y.Map ? (
          <ListItem
            key={(item.get('id') as string) ?? i}
            item={item}
            index={i}
            count={items.length}
            subfields={subfields}
            ctx={ctx}
            path={path}
            onMove={move}
            onRemove={remove}
          />
        ) : null
      )}
      <button className="btn ghost small" onClick={() => arr.push([newListItem(subfields)])}>
        + Ajouter un élément
      </button>
    </div>
  )
}

// ---------- Formulaire complet ----------

const GRID_KINDS = new Set(['number', 'ability', 'checkbox', 'gauge'])

export function FieldsForm({ fieldsMap, fields, ctx }: { fieldsMap: Y.Map<unknown>; fields: Field[]; ctx: FieldCtx }) {
  // Les petits champs qui se suivent sont regroupés en grille (caractéristiques, PV, CA…).
  const groups: Field[][] = []
  for (const f of fields) {
    const last = groups[groups.length - 1]
    if (GRID_KINDS.has(f.kind) && last && GRID_KINDS.has(last[0].kind)) last.push(f)
    else groups.push([f])
  }
  if (!fields.length) return <div className="muted">Ce type n'a encore aucun champ. Ajoute-en dans l'écran Types.</div>

  return (
    <div className="fields">
      {groups.map((g) =>
        GRID_KINDS.has(g[0].kind) ? (
          <div key={g[0].id} className="num-grid">
            {g.map((f) => (
              <label key={f.id} className={`field num kind-${f.kind}`}>
                <span className="field-label">{f.name}</span>
                <FieldValue map={fieldsMap} field={f} ctx={ctx} path={f.id} />
              </label>
            ))}
          </div>
        ) : (
          <div key={g[0].id} className={`field kind-${g[0].kind}`}>
            <span className="field-label">{g[0].name}</span>
            <FieldValue map={fieldsMap} field={g[0]} ctx={ctx} path={g[0].id} />
          </div>
        )
      )}
    </div>
  )
}
