import { useEffect, useMemo, useRef, useState } from 'react'
import type { Field, FieldKind, Rounding, TypeDef } from '@shared/model'
import { abilityModifier, DEFAULT_ABILITY, FIELD_KIND_LABELS, FIELD_KINDS, formatModifier, newId } from '@shared/model'
import { TEMPLATES } from '@shared/templates'
import { loadPref, savePref, useUi } from '../lib/hooks'
import type { Library, LibraryKind } from '../lib/library'
import { useLibraryState } from '../lib/library'

interface Props {
  libs: Partial<Record<LibraryKind, Library>>
  initial: LibraryKind
}

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr
  const out = [...arr]
  const [x] = out.splice(from, 1)
  out.splice(to, 0, x)
  return out
}

// ---- Mémoire de l'écran (type sélectionné, création en cours), par bibliothèque ----

interface Memory {
  selectedId: string | null
  draft: TypeDef | null
  base: string | null
  isNew: boolean
}

const memKey = (lib: Library) => `kotari.types.${lib.kind}.${lib.label}`
const memory = new Map<string, Memory>()

function recall(lib: Library): Memory | null {
  return memory.get(memKey(lib)) ?? loadPref<Memory | null>(memKey(lib), null)
}

function remember(lib: Library, m: Memory) {
  memory.set(memKey(lib), m)
  savePref(memKey(lib), m)
}

export function TypesScreen({ libs, initial }: Props) {
  const available = (['local', 'server'] as LibraryKind[]).filter((k) => libs[k])
  const [kind, setKind] = useState<LibraryKind>(libs[initial] ? initial : available[0])
  const lib = libs[kind]
  useEffect(() => {
    if (!libs[kind] && available[0]) setKind(available[0])
  }, [libs, kind, available])

  if (!lib) return <div className="types-screen empty-state">Ouvre un projet ou connecte-toi à un serveur.</div>

  return (
    <div className="types-screen">
      <div className="types-head">
        <h1>Types de fiches</h1>
        {available.length > 1 && (
          <div className="tabs">
            {available.map((k) => (
              <button key={k} className={`tab ${k === kind ? 'on' : ''}`} onClick={() => setKind(k)}>
                {k === 'local' ? 'Local' : 'Serveur'}
              </button>
            ))}
          </div>
        )}
      </div>
      <TypesEditor key={kind} lib={lib} />
    </div>
  )
}

/** Chemins "a", "liste/b"… des champs enregistrés, avec leur genre. */
function savedKinds(fields: Field[], prefix = '', out = new Map<string, FieldKind>()) {
  for (const f of fields) {
    const p = prefix ? `${prefix}/${f.id}` : f.id
    out.set(p, f.kind)
    if (f.kind === 'list') savedKinds(f.subfields ?? [], p, out)
  }
  return out
}

function cleanFields(fields: Field[]): Field[] {
  return fields.map((f) => {
    const out: Field = { id: f.id, name: f.name.trim() || 'Sans nom', kind: f.kind }
    if (f.kind === 'list') out.subfields = cleanFields(f.subfields ?? [])
    if (f.kind === 'select') out.options = [...new Set((f.options ?? []).map((o) => o.trim()).filter(Boolean))]
    if (f.kind === 'ability') out.ability = { ...DEFAULT_ABILITY, ...f.ability }
    return out
  })
}

function hasEmptyList(fields: Field[]): boolean {
  return fields.some((f) => f.kind === 'list' && (!f.subfields?.length || hasEmptyList(f.subfields)))
}

function TypesEditor({ lib }: { lib: Library }) {
  const { types, docs } = useLibraryState(lib)
  const ui = useUi()
  const mem = useRef(recall(lib))
  const [selectedId, setSelectedId] = useState<string | null>(
    () => (mem.current?.selectedId && (mem.current.isNew || types.some((t) => t.id === mem.current!.selectedId)) ? mem.current.selectedId : types[0]?.id) ?? null
  )
  const [isNew, setIsNew] = useState(() => !!mem.current?.isNew && !!mem.current.draft)
  const [draft, setDraft] = useState<TypeDef | null>(() => {
    const m = mem.current
    if (m?.draft && m.selectedId === selectedId) return m.draft
    const t = types.find((x) => x.id === selectedId)
    return t ? structuredClone(t) : null
  })
  // Version enregistrée à partir de laquelle le brouillon a été commencé.
  const [base, setBase] = useState<string | null>(() => {
    const m = mem.current
    if (m?.draft && m.selectedId === selectedId) return m.base
    const t = types.find((x) => x.id === selectedId)
    return t ? JSON.stringify(t) : null
  })
  const [saving, setSaving] = useState(false)

  const stored = types.find((t) => t.id === selectedId) ?? null
  const saved = useMemo(() => savedKinds(stored?.fields ?? []), [stored])
  const dirty = !!draft && (isNew || JSON.stringify(draft) !== base)
  const usage = docs.filter((d) => d.typeId === selectedId).length

  useEffect(() => {
    remember(lib, { selectedId, draft: dirty ? draft : null, base, isNew })
  }, [lib, selectedId, draft, base, isNew, dirty])

  // Type modifié ailleurs (autre personne sur le serveur) : suit si aucun changement en cours.
  useEffect(() => {
    if (isNew || dirty) return
    setDraft(stored ? structuredClone(stored) : null)
    setBase(stored ? JSON.stringify(stored) : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored])

  const maxOrder = types.reduce((m, t) => Math.max(m, t.order), 0)
  const missingTemplates = TEMPLATES.filter((t) => !types.some((x) => x.id === t.id))

  const leave = async () =>
    !dirty ||
    ui.confirm({
      title: 'Abandonner les modifications ?',
      message: "Les changements de ce type n'ont pas été enregistrés.",
      confirmLabel: 'Abandonner',
      danger: true
    })

  const load = (id: string | null) => {
    const t = types.find((x) => x.id === id)
    setIsNew(false)
    setSelectedId(id)
    setDraft(t ? structuredClone(t) : null)
    setBase(t ? JSON.stringify(t) : null)
  }

  const select = async (id: string) => {
    if (id === selectedId && !isNew) return
    if (!(await leave())) return
    load(id)
  }

  const create = async () => {
    if (!(await leave())) return
    const t: TypeDef = { id: newId(), name: 'Nouveau type', order: maxOrder + 1, fields: [] }
    setIsNew(true)
    setSelectedId(t.id)
    setDraft(t)
    setBase(null)
  }

  const addTemplate = async (tpl: TypeDef) => {
    await lib.saveType({ ...structuredClone(tpl), order: maxOrder + 1 })
    ui.toast(`Modèle « ${tpl.name} » ajouté.`)
  }

  const reorderType = async (id: string, dir: -1 | 1) => {
    const i = types.findIndex((t) => t.id === id)
    const j = i + dir
    if (j < 0 || j >= types.length) return
    const a = types[i]
    const b = types[j]
    await lib.saveType({ ...a, order: b.order })
    await lib.saveType({ ...b, order: a.order })
  }

  const save = async () => {
    if (!draft) return
    const clean: TypeDef = { ...draft, name: draft.name.trim() || 'Sans nom', fields: cleanFields(draft.fields) }
    if (hasEmptyList(clean.fields)) {
      ui.toast('Une liste doit avoir au moins un sous-champ.', 'error')
      return
    }
    setSaving(true)
    try {
      await lib.saveType(clean)
      setIsNew(false)
      setDraft(structuredClone(clean))
      setBase(JSON.stringify(clean))
      ui.toast('Type enregistré.')
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!stored || usage > 0) return
    if (
      await ui.confirm({
        title: `Supprimer le type « ${stored.name} » ?`,
        message: 'Aucune fiche ne l’utilise. Cette action est définitive.',
        confirmLabel: 'Supprimer',
        danger: true
      })
    ) {
      try {
        await lib.deleteType(stored.id)
        load(types.find((t) => t.id !== stored.id)?.id ?? null)
      } catch (e) {
        ui.toast(e instanceof Error ? e.message : String(e), 'error')
      }
    }
  }

  return (
    <div className="types-layout">
      <aside className="types-list">
        <ul>
          {types.map((t, i) => (
            <li key={t.id} className={t.id === selectedId && !isNew ? 'on' : ''}>
              <button className="type-item" onClick={() => select(t.id)}>
                <span>{t.name}</span>
                <span className="muted small">{docs.filter((d) => d.typeId === t.id).length}</span>
              </button>
              <span className="type-order">
                <button className="icon-btn" title="Monter" disabled={i === 0} onClick={() => reorderType(t.id, -1)}>
                  ↑
                </button>
                <button className="icon-btn" title="Descendre" disabled={i === types.length - 1} onClick={() => reorderType(t.id, 1)}>
                  ↓
                </button>
              </span>
            </li>
          ))}
          {isNew && draft && (
            <li className="on">
              <button className="type-item">
                <span>{draft.name || 'Nouveau type'}</span>
                <span className="muted small">nouveau</span>
              </button>
            </li>
          )}
        </ul>
        <button className="btn primary small block" onClick={create}>
          + Nouveau type
        </button>
        {missingTemplates.length > 0 && (
          <div className="templates">
            <div className="muted small">Ajouter un modèle :</div>
            {missingTemplates.map((t) => (
              <button key={t.id} className="btn ghost small" onClick={() => addTemplate(t)}>
                {t.name}
              </button>
            ))}
          </div>
        )}
      </aside>

      <section className="type-editor">
        {!draft ? (
          <div className="empty-state muted">Choisis un type à gauche, ou crée-en un.</div>
        ) : (
          <>
            <label className="form-row">
              <span>Nom du type</span>
              <input className="input big" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>

            <h3>Champs</h3>
            <FieldListEditor
              fields={draft.fields}
              prefix=""
              saved={saved}
              usage={isNew ? 0 : usage}
              onChange={(fields) => setDraft({ ...draft, fields })}
            />

            <div className="editor-actions">
              {!isNew && (
                <button className="btn ghost danger" disabled={usage > 0} title={usage > 0 ? `Utilisé par ${usage} fiche(s)` : ''} onClick={remove}>
                  Supprimer le type
                </button>
              )}
              {!isNew && usage > 0 && (
                <span className="muted small">
                  Utilisé par {usage} fiche{usage > 1 ? 's' : ''} : suppression impossible.
                </span>
              )}
              <span className="spacer" />
              {dirty && (
                <button className="btn ghost" onClick={() => (isNew ? load(types[0]?.id ?? null) : load(selectedId))}>
                  Annuler
                </button>
              )}
              <button className="btn primary" disabled={!dirty || saving} onClick={save}>
                Enregistrer
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function FieldListEditor({
  fields,
  prefix,
  saved,
  usage,
  onChange
}: {
  fields: Field[]
  prefix: string
  saved: Map<string, FieldKind>
  usage: number
  onChange: (f: Field[]) => void
}) {
  const ui = useUi()
  const patch = (i: number, p: Partial<Field>) => onChange(fields.map((f, k) => (k === i ? { ...f, ...p } : f)))
  const pathOf = (f: Field) => (prefix ? `${prefix}/${f.id}` : f.id)

  const remove = async (i: number) => {
    const f = fields[i]
    if (
      saved.has(pathOf(f)) &&
      usage > 0 &&
      !(await ui.confirm({
        title: `Retirer le champ « ${f.name} » ?`,
        message: 'Les valeurs déjà saisies pour ce champ dans les fiches seront abandonnées.',
        confirmLabel: 'Retirer',
        danger: true
      }))
    )
      return
    onChange(fields.filter((_, k) => k !== i))
  }

  const changeKind = async (i: number, kind: FieldKind) => {
    const f = fields[i]
    const was = saved.get(pathOf(f))
    if (was && was !== kind && usage > 0) {
      const lossless =
        (['number', 'ability'].includes(was) && ['number', 'ability', 'gauge', 'text', 'richtext'].includes(kind)) ||
        (was === 'text' && kind === 'richtext')
      const ok = await ui.confirm({
        title: `Changer « ${f.name} » en ${FIELD_KIND_LABELS[kind]} ?`,
        message: lossless
          ? `Les valeurs existantes seront converties à l'enregistrement.`
          : `Les valeurs déjà saisies seront converties quand c'est possible (texte ↔ nombre, nombre → jauge…). Sinon elles seront perdues.`,
        confirmLabel: 'Changer',
        danger: !lossless
      })
      if (!ok) return
    }
    patch(i, {
      kind,
      subfields: kind === 'list' ? (f.subfields?.length ? f.subfields : [{ id: newId(), name: 'Nom', kind: 'text' }]) : undefined,
      options: kind === 'select' ? (f.options ?? []) : undefined,
      ability: kind === 'ability' ? (f.ability ?? { ...DEFAULT_ABILITY }) : undefined
    })
  }

  return (
    <>
      {fields.length === 0 && <div className="muted small">Aucun champ pour l’instant.</div>}
      <ol className="field-rows">
        {fields.map((f, i) => (
          <li key={f.id} className="field-row">
            <div className="field-row-main">
              <input className="input" placeholder="Nom du champ" value={f.name} onChange={(e) => patch(i, { name: e.target.value })} />
              <select className="input select" value={f.kind} onChange={(e) => void changeKind(i, e.target.value as FieldKind)}>
                {FIELD_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {FIELD_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
              <button className="icon-btn" disabled={i === 0} onClick={() => onChange(moveItem(fields, i, i - 1))}>
                ↑
              </button>
              <button className="icon-btn" disabled={i === fields.length - 1} onClick={() => onChange(moveItem(fields, i, i + 1))}>
                ↓
              </button>
              <button className="icon-btn danger" title="Retirer" onClick={() => remove(i)}>
                ×
              </button>
            </div>
            {f.kind === 'ability' && <AbilityEditor field={f} onChange={(ability) => patch(i, { ability })} />}
            {f.kind === 'select' && <OptionsEditor options={f.options ?? []} onChange={(options) => patch(i, { options })} />}
            {f.kind === 'list' && (
              <div className="subfields">
                <div className="muted small">Chaque élément de la liste contient :</div>
                <FieldListEditor
                  fields={f.subfields ?? []}
                  prefix={pathOf(f)}
                  saved={saved}
                  usage={usage}
                  onChange={(subfields) => patch(i, { subfields })}
                />
              </div>
            )}
          </li>
        ))}
      </ol>
      <button className="btn ghost small" onClick={() => onChange([...fields, { id: newId(), name: '', kind: 'text' }])}>
        + Ajouter un {prefix ? 'sous-champ' : 'champ'}
      </button>
    </>
  )
}

function AbilityEditor({ field, onChange }: { field: Field; onChange: (a: NonNullable<Field['ability']>) => void }) {
  const a = { ...DEFAULT_ABILITY, ...field.ability }
  const num = (key: 'base' | 'divisor' | 'offset', label: string) => (
    <label className="cfg">
      <span>{label}</span>
      <input
        className="input"
        type="number"
        value={a[key]}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n) && !(key === 'divisor' && n === 0)) onChange({ ...a, [key]: n })
        }}
      />
    </label>
  )
  return (
    <div className="field-config">
      <div className="cfg-row">
        {num('base', 'Base')}
        {num('divisor', 'Diviseur')}
        <label className="cfg">
          <span>Arrondi</span>
          <select className="input" value={a.rounding} onChange={(e) => onChange({ ...a, rounding: e.target.value as Rounding })}>
            <option value="floor">Inférieur</option>
            <option value="round">Le plus proche</option>
            <option value="ceil">Supérieur</option>
          </select>
        </label>
        {num('offset', 'Bonus fixe')}
      </div>
      <div className="muted small">
        Modificateur = arrondi((valeur − {a.base}) ÷ {a.divisor}){a.offset ? ` ${a.offset > 0 ? '+' : '−'} ${Math.abs(a.offset)}` : ''} · ex. 8 →{' '}
        {formatModifier(abilityModifier(8, a))}, 10 → {formatModifier(abilityModifier(10, a))}, 15 → {formatModifier(abilityModifier(15, a))}, 18 →{' '}
        {formatModifier(abilityModifier(18, a))}
      </div>
    </div>
  )
}

function OptionsEditor({ options, onChange }: { options: string[]; onChange: (o: string[]) => void }) {
  const [text, setText] = useState(options.join('\n'))
  return (
    <div className="field-config">
      <label className="cfg wide">
        <span>Choix proposés (un par ligne)</span>
        <textarea
          className="input"
          rows={Math.min(8, Math.max(3, options.length + 1))}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            onChange(e.target.value.split('\n'))
          }}
        />
      </label>
    </div>
  )
}
