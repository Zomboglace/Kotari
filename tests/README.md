# Tests de Kotari

```bash
npm test
```

Les tests utilisent le lanceur intégré à Node (`node:test`) : aucune
dépendance à installer, et pas besoin d'Electron.

## Les fichiers

| Fichier | Contenu |
| --- | --- |
| `unitaires.test.ts` | Le contenu d'une fiche (champs, listes, recherche, images), sans serveur. Très rapide. |
| `serveur.test.ts` | Un vrai kotari-server et de vrais clients (Alice et Bob) : connexion, édition à plusieurs, copie, recherche, images, disque. |
| `dossiers.test.ts` | Le nouveau genre de document « Dossier ». |
| `carte-logique.test.ts` | La logique des cartes, sans serveur : grille, murs, vue, lumière, brouillard, tokens, permissions. |
| `carte-serveur.test.ts` | Les cartes sur un vrai serveur : propriétaire, copies de fiche, brouillard, anti-triche. |
| `carte-interface.test.tsx` | Les composants React de la carte, dans un faux navigateur (happy-dom). |
| `outils.ts` | Les fonctions partagées par les tests (démarrer un serveur, créer une fiche, lire un champ…). |
| `outils-carte.ts` | Les fonctions partagées par les tests des cartes et des dossiers. |
| `dom.ts` | Installe le faux navigateur pour les tests d'interface. |
| `../scripts/run-tests.mjs` | Compile les `*.test.ts` avec esbuild puis lance `node --test`. |

Le contrat des cartes et des dossiers (noms imposés, règles de vue, de lumière,
d'anti-triche…) est décrit dans [`docs/carte-api.md`](../docs/carte-api.md).

Un fichier de tests qui importe du code pas encore écrit est signalé par
`NE COMPILE PAS`, mais les autres fichiers tournent quand même.

## Comment un test est construit

Chaque test est indépendant : il démarre **son propre serveur** sur un projet
vide, dans un dossier temporaire, puis tout est nettoyé à la fin (même s'il
échoue). On peut donc lire, modifier ou ajouter un test sans regarder les autres.

Un test suit toujours le même schéma :

```ts
test('un renommage par Bob est visible chez Alice', async (t) => {
  // 1. Préparer
  const { alice, bob } = await serveurAvecAliceEtBob(t)
  const id = await creerFiche(alice, 'Aragorn', MODELES.personnage)
  await attendre(() => ficheExiste(bob, id), 'Bob voit la fiche')

  // 2. Agir
  bob.updateMeta(id, { title: 'Aragorn II' })

  // 3. Vérifier
  await attendre(() => titreDeLaFiche(alice, id) === 'Aragorn II', 'Alice voit le nouveau titre')
})
```

- `assert.equal(a, b)` : vérifie tout de suite.
- `attendre(condition, 'description')` : pour ce qui passe par le réseau ou le
  disque. Le test continue dès que la condition est vraie, et échoue avec la
  description si elle ne l'est pas au bout de 5 s. **Jamais de pause fixe.**

## Ajouter un test

1. Choisir le fichier (`unitaires` sans serveur, `serveur` sinon) et le bloc
   `describe(...)` qui correspond au thème, ou en créer un.
2. Écrire `test('ce qui doit se passer', async (t) => { ... })` en suivant le
   schéma ci-dessus. Le titre décrit le comportement attendu, en français.
3. S'il manque un outil (lire un nouveau genre de champ, etc.), l'ajouter dans
   `outils.ts` plutôt que de répéter la mécanique Yjs dans le test.
4. Vérifier que le test **échoue** sans la fonctionnalité, puis qu'il passe avec.

Toute la suite prend une quinzaine de secondes.

## Problème connu

L'arrêt du serveur peut échouer s'il a lieu moins d'une seconde après une
modification (deux écritures du même fichier en même temps). Dans les tests,
cela s'affiche parfois en fin de test sous la forme
`⚠ arrêt du serveur de test : ENOENT …` ou `[onStoreDocument] Error …` ; ce
n'est pas un échec du test. Voir `src/server/server.ts` (`stop`) et
`src/shared/fsproject.ts` (`atomicWrite`).
