import { useEffect, useMemo, useState } from 'react'
import type { Field, FieldKind, SubField, SubFieldKind, TypeDef } from '@shared/model'
import { FIELD_KIND_LABELS, newId } from '@shared/model'
import { TEMPLATES } from '@shared/templates'
import { useUi } from '../lib/hooks'
import type { Library, LibraryKind } from '../lib/library'
import { useLibraryState } from '../lib/library'

interface Props {
  libs: Partial<Record<LibraryKind, Library>>
  initial: LibraryKind
}

const KINDS: FieldKind[] = ['text', 'number', 'richtext', 'list']
const SUB_KINDS: SubFieldKind[] = ['text', 'number', 'richtext']

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr
  const out = [...arr]
  const [x] = out.splice(from, 1)
  out.splice(to, 0, x)
  return out
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

function TypesEditor({ lib }: { lib: Library }) {
  const { types, docs } = useLibraryState(lib)
  const ui = useUi()
  const [selectedId, setSelectedId] = useState<string | null>(types[0]?.id ?? null)
  const [draft, setDraft] = useState<TypeDef | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)

  const stored = types.find((t) => t.id === selectedId) ?? null
  const savedFieldIds = useMemo(() => {
    const s = new Set<string>()
    for (const f of stored?.fields ?? []) {
      s.add(f.id)
      for (const sf of f.subfields ?? []) s.add(`${f.id}/${sf.id}`)
    }
    return s
  }, [stored])

  // Recharge le brouillon quand on change de type (ou qu'il est modifié ailleurs).
  useEffect(() => {
    if (isNew) return
    setDraft(stored ? structuredClone(stored) : null)
  }, [stored, isNew])

  const dirty = !!draft && (isNew || JSON.stringify(draft) !== JSON.stringify(stored))
  const usage = docs.filter((d) => d.typeId === selectedId).length
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

  const select = async (id: string) => {
    if (id === selectedId && !isNew) return
    if (!(await leave())) return
    setIsNew(false)
    setSelectedId(id)
  }

  const create = async () => {
    if (!(await leave())) return
    const t: TypeDef = { id: newId(), name: 'Nouveau type', order: maxOrder + 1, fields: [] }
    setIsNew(true)
    setSelectedId(t.id)
    setDraft(t)
  }

  const addTemplate = async (tpl: TypeDef) => {
    await lib.saveType({ ...structuredClone(tpl), order: maxOrder + 1 })
    ui.toast(`Modèle « ${tpl.name} » ajouté.`)
    if (!dirty) {
      setIsNew(false)
      setSelectedId(tpl.id)
    }
  }

  const reorderType = async (id: string, dir: -1 | 1) => {
    const sorted = [...types]
    const i = sorted.findIndex((t) => t.id === id)
    const j = i + dir
    if (j < 0 || j >= sorted.length) return
    const a = sorted[i]
    const b = sorted[j]
    await lib.saveType({ ...a, order: b.order })
    await lib.saveType({ ...b, order: a.order })
  }

  const save = async () => {
    if (!draft) return
    const clean: TypeDef = {
      ...draft,
      name: draft.name.trim() || 'Sans nom',
      fields: draft.fields.map((f) => ({
        ...f,
        name: f.name.trim() || 'Sans nom',
        ...(f.kind === 'list'
          ? { subfields: (f.subfields ?? []).map((s) => ({ ...s, name: s.name.trim() || 'Sans nom' })) }
          : { subfields: undefined })
      }))
    }
    if (clean.fields.some((f) => f.kind === 'list' && !f.subfields?.length)) {
      ui.toast('Une liste doit avoir au moins un sous-champ.', 'error')
      return
    }
    setSaving(true)
    try {
      await lib.saveType(JSON.parse(JSON.stringify(clean)))
      setIsNew(false)
      ui.toast('Type enregistré.')
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!stored) return
    if (usage > 0) return
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
        setSelectedId(null)
      } catch (e) {
        ui.toast(e instanceof Error ? e.message : String(e), 'error')
      }
    }
  }

  const patchField = (i: number, patch: Partial<Field>) =>
    setDraft((d) => d && { ...d, fields: d.fields.map((f, k) => (k === i ? { ...f, ...patch } : f)) })

  const removeField = async (i: number) => {
    const f = draft!.fields[i]
    if (
      savedFieldIds.has(f.id) &&
      !(await ui.confirm({
        title: `Retirer le champ « ${f.name} » ?`,
        message:
          'Les valeurs déjà saisies pour ce champ dans les fiches seront abandonnées (elles ne seront plus affichées).',
        confirmLabel: 'Retirer',
        danger: true
      }))
    )
      return
    setDraft((d) => d && { ...d, fields: d.fields.filter((_, k) => k !== i) })
  }

  const addField = () =>
    setDraft((d) => d && { ...d, fields: [...d.fields, { id: newId(), name: '', kind: 'text' }] })

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
                <button
                  className="icon-btn"
                  title="Descendre"
                  disabled={i === types.length - 1}
                  onClick={() => reorderType(t.id, 1)}
                >
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
              <input
                className="input big"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>

            <h3>Champs</h3>
            {draft.fields.length === 0 && <div className="muted small">Aucun champ pour l’instant.</div>}
            <ol className="field-rows">
              {draft.fields.map((f, i) => (
                <li key={f.id} className="field-row">
                  <div className="field-row-main">
                    <input
                      className="input"
                      placeholder="Nom du champ"
                      value={f.name}
                      onChange={(e) => patchField(i, { name: e.target.value })}
                    />
                    <select
                      className="input select"
                      value={f.kind}
                      disabled={savedFieldIds.has(f.id)}
                      title={savedFieldIds.has(f.id) ? 'Le genre d’un champ enregistré ne peut plus changer.' : ''}
                      onChange={(e) => {
                        const k = e.target.value as FieldKind
                        patchField(i, {
                          kind: k,
                          subfields: k === 'list' ? [{ id: newId(), name: 'Nom', kind: 'text' }] : undefined
                        })
                      }}
                    >
                      {KINDS.map((k) => (
                        <option key={k} value={k}>
                          {FIELD_KIND_LABELS[k]}
                        </option>
                      ))}
                    </select>
                    <button
                      className="icon-btn"
                      disabled={i === 0}
                      onClick={() => setDraft({ ...draft, fields: moveItem(draft.fields, i, i - 1) })}
                    >
                      ↑
                    </button>
                    <button
                      className="icon-btn"
                      disabled={i === draft.fields.length - 1}
                      onClick={() => setDraft({ ...draft, fields: moveItem(draft.fields, i, i + 1) })}
                    >
                      ↓
                    </button>
                    <button className="icon-btn danger" title="Retirer" onClick={() => removeField(i)}>
                      ×
                    </button>
                  </div>
                  {f.kind === 'list' && (
                    <SubFieldsEditor
                      parentId={f.id}
                      subfields={f.subfields ?? []}
                      savedIds={savedFieldIds}
                      onChange={(subfields) => patchField(i, { subfields })}
                    />
                  )}
                </li>
              ))}
            </ol>
            <button className="btn ghost small" onClick={addField}>
              + Ajouter un champ
            </button>

            <div className="editor-actions">
              {!isNew && (
                <button
                  className="btn ghost danger"
                  disabled={usage > 0}
                  title={usage > 0 ? `Utilisé par ${usage} fiche(s)` : ''}
                  onClick={remove}
                >
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
                <button
                  className="btn ghost"
                  onClick={() => {
                    if (isNew) {
                      setIsNew(false)
                      setSelectedId(types[0]?.id ?? null)
                    } else setDraft(stored ? structuredClone(stored) : null)
                  }}
                >
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

function SubFieldsEditor({
  parentId,
  subfields,
  savedIds,
  onChange
}: {
  parentId: string
  subfields: SubField[]
  savedIds: Set<string>
  onChange: (s: SubField[]) => void
}) {
  const ui = useUi()
  const patch = (i: number, p: Partial<SubField>) => onChange(subfields.map((s, k) => (k === i ? { ...s, ...p } : s)))
  const remove = async (i: number) => {
    const s = subfields[i]
    if (
      savedIds.has(`${parentId}/${s.id}`) &&
      !(await ui.confirm({
        title: `Retirer le sous-champ « ${s.name} » ?`,
        message: 'Les valeurs déjà saisies seront abandonnées.',
        confirmLabel: 'Retirer',
        danger: true
      }))
    )
      return
    onChange(subfields.filter((_, k) => k !== i))
  }
  return (
    <div className="subfields">
      <div className="muted small">Chaque élément de la liste contient :</div>
      {subfields.map((s, i) => (
        <div key={s.id} className="field-row-main sub">
          <input
            className="input"
            placeholder="Nom du sous-champ"
            value={s.name}
            onChange={(e) => patch(i, { name: e.target.value })}
          />
          <select
            className="input select"
            value={s.kind}
            disabled={savedIds.has(`${parentId}/${s.id}`)}
            onChange={(e) => patch(i, { kind: e.target.value as SubFieldKind })}
          >
            {SUB_KINDS.map((k) => (
              <option key={k} value={k}>
                {FIELD_KIND_LABELS[k]}
              </option>
            ))}
          </select>
          <button className="icon-btn" disabled={i === 0} onClick={() => onChange(moveItem(subfields, i, i - 1))}>
            ↑
          </button>
          <button
            className="icon-btn"
            disabled={i === subfields.length - 1}
            onClick={() => onChange(moveItem(subfields, i, i + 1))}
          >
            ↓
          </button>
          <button className="icon-btn danger" onClick={() => remove(i)}>
            ×
          </button>
        </div>
      ))}
      <button
        className="btn ghost small"
        onClick={() => onChange([...subfields, { id: newId(), name: '', kind: 'text' }])}
      >
        + Sous-champ
      </button>
    </div>
  )
}
