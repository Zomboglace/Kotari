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

async function main() {
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
  da.ydoc.getMap('fields').set('pv', 42)
  await until(() => db.ydoc.getMap('fields').get('pv') === 42, 'nombre')
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
