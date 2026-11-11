// Test d'intégration : vrai kotari-server + deux clients ServerLibrary.
// Lancer avec : npm test
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as Y from 'yjs'
import { initialContent } from '@shared/content'
import { planCopy } from '@shared/copy'
import { ProjectStore } from '@shared/fsproject'
import { newId, subtree } from '@shared/model'
import { TEMPLATES } from '@shared/templates'
import { hashPassword } from '../src/server/password'
import { imageHash } from '@shared/images'
import { ensureFields, newListItem, collectImages } from '@shared/content'
import { collectTexts } from '@shared/search'
import type { TypeDef } from '@shared/model'
import { startServer } from '../src/server/server'
import { ServerLibrary } from '../src/renderer/src/lib/serverLibrary'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(cond: () => boolean, what: string, ms = 5000) {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('Délai dépassé : ' + what)
    await sleep(25)
  }
}

let step = 0
const ok = (msg: string) => console.log(`  ✓ ${++step}. ${msg}`)

function unitTests() {
  // Listes imbriquées + conversion de genre
  const t1: TypeDef = {
    id: 't1', name: 'T', order: 1,
    fields: [
      { id: 'a', name: 'A', kind: 'text' },
      { id: 'l', name: 'L', kind: 'list', subfields: [
        { id: 'n', name: 'N', kind: 'text' },
        { id: 'sub', name: 'Sub', kind: 'list', subfields: [{ id: 'x', name: 'X', kind: 'text' }] }
      ] }
    ]
  }
  const d = new Y.Doc()
  ensureFields(d, t1)
  const f = d.getMap('fields')
  ;(f.get('a') as Y.Text).insert(0, '17')
  const item = newListItem(t1.fields[1].subfields!)
  ;(f.get('l') as Y.Array<Y.Map<unknown>>).push([item])
  const inner = newListItem(t1.fields[1].subfields![1].subfields!)
  ;(item.get('sub') as Y.Array<Y.Map<unknown>>).push([inner])
  ;(inner.get('x') as Y.Text).insert(0, 'profond')
  const texts = collectTexts(d, t1)
  assert.ok(texts.some((e) => e.text === 'profond' && e.label === 'L 1 › Sub 1 › X'))
  ok('listes imbriquées sur trois niveaux, indexées par la recherche')

  const t2: TypeDef = { ...t1, fields: [{ ...t1.fields[0], kind: 'ability' }, t1.fields[1]] }
  ensureFields(d, t2)
  assert.equal(f.get('a'), 17)
  const t3: TypeDef = { ...t1, fields: [{ ...t1.fields[0], kind: 'gauge' }, t1.fields[1]] }
  ensureFields(d, t3)
  assert.equal((f.get('a') as Y.Map<unknown>).get('cur'), 17)
  const t4: TypeDef = { ...t1, fields: [{ ...t1.fields[0], kind: 'richtext' }, t1.fields[1]] }
  ensureFields(d, t4)
  assert.ok(collectTexts(d, t4).some((e) => e.path === 'a' && e.text === '17 / '))
  ok('changement de genre : texte → caractéristique → jauge → texte riche, valeur conservée')

  const t5: TypeDef = { ...t1, fields: [{ id: 'img', name: 'I', kind: 'image' }] }
  ensureFields(d, t5)
  ;(f.get('img') as Y.Map<unknown>).set('img', 'a'.repeat(40))
  assert.deepEqual(collectImages(Y.encodeStateAsUpdate(d)), ['a'.repeat(40)])
  ok('images référencées retrouvées pour la copie')
}

async function main() {
  unitTests()
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kotari-test-'))
  await ProjectStore.init(dir, 'Test', TEMPLATES)
  const srv = await startServer({ dir, port: 0, passwordHash: await hashPassword('secret123'), log: () => {} })
  const opts = { host: '127.0.0.1', port: srv.port, password: 'secret123' }
  console.log(`Serveur de test sur le port ${srv.port}`)

  await assert.rejects(ServerLibrary.connect({ ...opts, password: 'mauvais', name: 'X' }), /Mot de passe refusé/)
  ok('mauvais mot de passe refusé')

  const a = await ServerLibrary.connect({ ...opts, name: 'Alice' })
  const b = await ServerLibrary.connect({ ...opts, name: 'Bob' })
  assert.equal(a.getState().types.length, 4)
  ok('deux clients connectés, types du serveur reçus')

  const perso = TEMPLATES.find((t) => t.id === 'modele-personnage')!
  const inv = TEMPLATES.find((t) => t.id === 'modele-inventaire')!
  const pid = newId()
  await a.createDoc({ id: pid, title: 'Aragorn', typeId: perso.id, parentId: null, order: 1 }, initialContent(perso))
  const iid = newId()
  await a.createDoc({ id: iid, title: 'Sac', typeId: inv.id, parentId: pid, order: 1 }, initialContent(inv))
  await until(() => b.getState().docs.length === 2, 'B voit les fiches')
  ok('fiche + sous-fiche créées par A, visibles chez B')

  const da = await a.openDoc(pid)
  const db = await b.openDoc(pid)
  const raceA = da.ydoc.getMap('fields').get('race') as Y.Text
  raceA.insert(0, 'Humain')
  const raceB = () => (db.ydoc.getMap('fields').get('race') as Y.Text).toString()
  await until(() => raceB() === 'Humain', 'B reçoit la saisie')
  ;(db.ydoc.getMap('fields').get('race') as Y.Text).insert(6, ' du Nord')
  ;(da.ydoc.getMap('fields').get('race') as Y.Text).insert(0, 'Grand ')
  await until(
    () => raceB() === 'Grand Humain du Nord' && raceA.toString() === 'Grand Humain du Nord',
    'fusion des saisies simultanées'
  )
  ok('saisies simultanées fusionnées : « Grand Humain du Nord »')

  const hist = da.ydoc.getMap('fields').get('histoire') as Y.XmlFragment
  const p = new Y.XmlElement('paragraph')
  p.insert(0, [new Y.XmlText('Rôdeur du Nord.')])
  hist.insert(0, [p])
  await until(() => (db.ydoc.getMap('fields').get('histoire') as Y.XmlFragment).toString().includes('Rôdeur'), 'texte riche')
  da.ydoc.getMap('fields').set('niveau', 42)
  await until(() => db.ydoc.getMap('fields').get('niveau') === 42, 'nombre')
  ok('texte riche et nombre synchronisés')

  b.updateMeta(pid, { title: 'Aragorn II' })
  await until(() => a.getState().docs.find((d) => d.id === pid)?.title === 'Aragorn II', 'renommage')
  ok('renommage diffusé')

  // Copie serveur -> serveur (même chemin que serveur -> local -> serveur).
  const ids = subtree(a.getState().docs, pid).map((d) => d.id)
  const exported = await a.exportDocs(ids)
  assert.equal(exported.length, 2)
  const plan = planCopy(exported, a.getState().types, a.getState().types, null, 2)
  assert.notEqual(plan.docs[0].meta.id, pid)
  assert.equal(plan.docs[1].meta.parentId, plan.docs[0].meta.id)
  await a.importDocs(plan)
  await until(() => b.getState().docs.length === 4, 'copie visible chez B')
  const copy = await b.openDoc(plan.docs[0].meta.id)
  assert.equal((copy.ydoc.getMap('fields').get('race') as Y.Text).toString(), 'Grand Humain du Nord')
  copy.close()
  ok('sous-arbre copié avec nouveaux identifiants et contenu à jour')

  // Type en conflit : même id, champs différents -> « Personnage (2) ».
  const altered = { ...perso, fields: [...perso.fields, { id: 'extra', name: 'Extra', kind: 'text' as const }] }
  const plan2 = planCopy(exported, [altered, inv], a.getState().types, null, 3)
  assert.equal(plan2.newTypes.length, 1)
  assert.equal(plan2.newTypes[0].name, 'Personnage (2)')
  ok('type en conflit dupliqué en « Personnage (2) »')

  // Recherche côté serveur (titre + texte riche, sans accents)
  const hits = await b.search('rodeur')
  assert.ok(hits.some((h) => h.docId === pid && h.path === 'histoire'))
  const scoped = await b.search('aragorn', [iid])
  assert.equal(scoped.length, 0)
  ok('recherche serveur (accents ignorés, limitée à des fiches)')

  // Images : envoi, vérification d'empreinte, lecture
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4])
  const hash = await imageHash(png)
  assert.deepEqual(await a.missingImages([hash]), [hash])
  await a.putImage(hash, png)
  assert.deepEqual(await b.missingImages([hash]), [])
  assert.deepEqual([...(await b.getImage(hash))!], [...png])
  await assert.rejects(a.putImage('0'.repeat(40), png), /Empreinte/)
  ok('images envoyées et relues, empreinte vérifiée')

  // Persistance
  await sleep(1500)
  da.close()
  db.close()
  await sleep(1500)
  const onDisk = await new ProjectStore(dir).readContent(pid)
  const check = new Y.Doc()
  Y.applyUpdate(check, onDisk!)
  assert.equal((check.getMap('fields').get('race') as Y.Text).toString(), 'Grand Humain du Nord')
  const meta = JSON.parse(await fs.readFile(path.join(dir, 'documents', `${pid}.json`), 'utf8'))
  assert.equal(meta.title, 'Aragorn II')
  ok('contenu et métas écrits sur disque')

  // Suppression
  await a.deleteDocs([iid])
  await until(() => b.getState().docs.length === 3, 'suppression diffusée')
  await sleep(1500)
  await assert.rejects(fs.stat(path.join(dir, 'documents', `${iid}.yjs`)))
  ok('suppression diffusée et fichiers retirés')

  // Redémarrage : tout est relu depuis le disque.
  a.destroy()
  b.destroy()
  await srv.stop()
  const srv2 = await startServer({ dir, port: 0, passwordHash: await hashPassword('x12345'), log: () => {} })
  const c = await ServerLibrary.connect({ host: '127.0.0.1', port: srv2.port, password: 'x12345', name: 'Chloé' })
  assert.equal(c.getState().docs.length, 3)
  const dc = await c.openDoc(pid)
  assert.equal((dc.ydoc.getMap('fields').get('race') as Y.Text).toString(), 'Grand Humain du Nord')
  dc.close()
  c.destroy()
  await srv2.stop()
  ok('redémarrage du serveur : données intactes')

  await fs.rm(dir, { recursive: true, force: true })
  console.log('\nTous les tests passent.')
  process.exit(0)
}

main().catch((e) => {
  console.error('\nÉCHEC :', e)
  process.exit(1)
})
