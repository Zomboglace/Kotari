# Cartes, tokens et dossiers : contrat d'API

Ce document décrit **ce que les tests attendent**. Les tests sont dans
`tests/dossiers.test.ts`, `tests/carte-logique.test.ts`,
`tests/carte-serveur.test.ts` et `tests/carte-interface.test.tsx`.

- Les noms de fichiers, de fonctions, de types et de propriétés ci-dessous sont
  imposés : les tests les importent.
- Tout le reste (organisation interne, stockage, protocole avec le serveur,
  style) est libre.
- **Les tests ne doivent pas être modifiés.**

## 1. Vocabulaire

| Terme | Sens |
| --- | --- |
| Case (`Cell`) | `{ x, y }` entiers. La case `(0, 0)` est en haut à gauche. **Une case = 5 pieds.** |
| Point (`Point`) | `{ x, y }` en unités de grille. La case `(x, y)` couvre le carré `[x, x+1] × [y, y+1]` ; son centre est `(x + 0.5, y + 0.5)`. |
| Clé de case | La chaîne `"x,y"` (ex. `"3,4"`), utilisée dans les listes et les dictionnaires. |
| Propriétaire | Le pseudo de celui qui a créé la carte. C'est le MJ de cette carte. |
| Joueur | Toute autre personne connectée. |

## 2. Modèle de documents : `src/shared/model.ts`

```ts
export type DocKind = 'sheet' | 'map' | 'folder'

export interface DocMeta {
  id: string
  title: string
  typeId: string
  parentId: string | null
  order: number
  kind?: DocKind      // absent = 'sheet' (compatibilité avec les projets existants)
  owner?: string      // cartes : pseudo du créateur
}

export function docKind(meta: DocMeta): DocKind
```

- `pickMeta`, `isDocMeta` et l'enregistrement sur disque doivent conserver `kind` et `owner`.
- Un **dossier** n'a aucun champ et peut contenir des fiches, des cartes et d'autres dossiers.
- **Supprimer un document supprime tous ses descendants**, y compris côté serveur,
  même si l'appel à `deleteDocs` ne contient que l'identifiant du parent.

### `src/shared/documents.ts`

```ts
export interface NewDocument { meta: DocMeta; content: Uint8Array }

export function newFolder(title: string, parentId: string | null, order: number): NewDocument

export function newMap(
  title: string,
  parentId: string | null,
  order: number,
  options?: { width?: number; height?: number; background?: string | null; ambient?: LightLevel }
): NewDocument
// Par défaut : 20 × 20 cases, pas d'image, ambiance 'bright'.
```

Sur le serveur, `owner` est **toujours** fixé par le serveur au pseudo de la personne
qui crée la carte, quelle que soit la valeur envoyée par le client.

## 3. Données d'une carte : `src/shared/carte/types.ts`

```ts
export interface Cell { x: number; y: number }
export interface Point { x: number; y: number }

export type LightLevel = 'bright' | 'dim' | 'dark'   // vive, faible, noir

/** Mur entre deux coins de la grille (coordonnées entières). */
export interface Wall { id: string; from: Point; to: Point; door?: 'open' | 'closed' }

/** Distances en pieds : `bright` pieds de lumière vive, puis `dim` pieds de plus en lumière faible. */
export interface LightSource { id: string; cell: Cell; bright: number; dim: number }

export interface Vision {
  range: number | null   // portée en pieds, null = illimitée
  darkvision: number     // vision dans le noir, en pieds (0 = aucune)
}

export interface Token {
  id: string
  name: string
  cell: Cell             // case en haut à gauche du token
  size: number           // en cases (1 = 5 pieds × 5 pieds)
  player: string | null  // joueur qui contrôle ce token (attribué par le propriétaire)
  vision: Vision
  light: { bright: number; dim: number } | null   // lumière portée par le token
  sheetId: string | null
  sheetMode: 'copy' | 'link' | null
}

export interface FogState {
  explored: Record<string, string[]>   // par joueur : clés des cases déjà vues
  revealed: string[]                   // cases révélées à la main par le propriétaire
}

export interface MapData {
  width: number
  height: number
  background: string | null            // empreinte d'image (comme les champs image)
  ambient: LightLevel                  // jour / pénombre / nuit
  zones: Record<string, LightLevel>    // pinceau : niveau propre à certaines cases
  walls: Wall[]
  lights: LightSource[]
  tokens: Token[]
  fog: FogState
}
```

## 4. Logique pure : `src/shared/carte/`

### `grid.ts`

```ts
export const FEET_PER_CELL = 5
export function cellKey(cell: Cell): string                 // { x: 3, y: 4 } → "3,4"
export function parseCellKey(key: string): Cell
export function tokenCenter(token: Token): Point            // centre de la zone occupée
export function cellDistanceFeet(a: Cell, b: Cell): number  // centre à centre, en ligne droite
export function isInsideGrid(map: MapData, cell: Cell, size?: number): boolean
export function resizeGrid(map: MapData, width: number, height: number): MapData
// resizeGrid ramène dans la grille les tokens qui en sortiraient.
```

### `walls.ts` : murs et collisions

```ts
export function isBlocked(map: MapData, from: Point, to: Point): boolean
export function canMove(map: MapData, tokenId: string, to: Cell): boolean
```

Règles (les mêmes pour la vue, la lumière et les déplacements) :

1. Un mur sans porte, ou avec une porte `'closed'`, bloque. Une porte `'open'` ne bloque pas.
2. Un segment qui coupe un mur, ou le touche ailleurs qu'à ses extrémités, est bloqué.
3. Un segment qui passe **exactement par l'extrémité d'un seul mur** n'est pas bloqué.
4. Un segment qui passe **exactement par un point où se rejoignent au moins deux murs
   bloquants** est bloqué : la vue ne passe pas par les coins.
5. `canMove` : la destination doit être entièrement dans la grille, et le segment
   entre le centre actuel du token et son centre à l'arrivée ne doit pas être bloqué.

### `light.ts` : lumière (valeurs de D&D 5e par défaut)

```ts
export const LIGHT_PRESETS: { torch: { bright: 20; dim: 20 }; lantern: { bright: 30; dim: 30 } }
export const DEFAULT_DARKVISION = 60

export function lightLevel(map: MapData, cell: Cell): LightLevel
export function perceivedLight(map: MapData, tokenId: string, cell: Cell): LightLevel
```

- Niveau de base d'une case : `zones["x,y"]` s'il existe, sinon `ambient`.
- Chaque source (celles de `lights` et celles portées par les tokens, centrées sur le
  token) éclaire une case si le segment entre son centre et le centre de la case n'est
  pas bloqué : `'bright'` jusqu'à `bright` pieds, `'dim'` jusqu'à `bright + dim` pieds.
- Résultat : le niveau le plus fort entre la base et toutes les sources.
- `perceivedLight` : pour une case à `darkvision` pieds ou moins du token,
  `'dark'` devient `'dim'` et `'dim'` devient `'bright'` (règle de D&D).

### `vision.ts`

```ts
export function canSee(map: MapData, tokenId: string, cell: Cell): boolean
export function visibleCells(map: MapData, tokenId: string): string[]   // clés de cases
export function visibleCellsFor(map: MapData, player: string): string[]
```

Une case est visible par un token si :
1. elle est dans la grille ;
2. elle est à portée (`vision.range`, si elle n'est pas `null`) ;
3. le segment entre le centre du token et le centre de la case n'est pas bloqué ;
4. `perceivedLight` n'y vaut pas `'dark'`.

Les cases occupées par le token lui-même sont toujours visibles.
`visibleCellsFor(map, joueur)` est l'union des cases visibles par tous les tokens de ce
joueur, plus `fog.revealed`. Un joueur sans token ne voit que `fog.revealed`.

### `fog.ts` : brouillard de guerre

```ts
export type CellState = 'visible' | 'explored' | 'hidden'

export function emptyFog(): FogState
export function recordExplored(fog: FogState, player: string, keys: string[]): FogState
export function setRevealed(fog: FogState, keys: string[], revealed: boolean): FogState
export function cellState(fog: FogState, player: string, key: string, visibleNow: string[]): CellState
```

- Ces fonctions ne modifient pas leurs arguments : elles renvoient un nouvel état.
- `cellState` renvoie `'visible'` si la case est visible maintenant ou révélée,
  `'explored'` si le joueur l'a déjà vue, et `'hidden'` sinon.
- `setRevealed(..., false)` cache la case pour tout le monde : il la retire aussi des
  cases explorées de tous les joueurs.

### `tokens.ts`

```ts
export interface NewTokenInput {
  name: string
  cell: Cell
  size?: number                               // défaut 1
  player?: string | null                      // défaut null
  vision?: Partial<Vision>                    // défaut { range: null, darkvision: 0 }
  light?: { bright: number; dim: number } | null   // défaut null
  sheetId?: string | null                     // fiche d'origine, défaut null (simple pion)
  sheetMode?: 'copy' | 'link'                 // défaut 'copy' s'il y a une fiche
}

export function newToken(input: NewTokenInput): Token   // génère un id
```

### `permissions.ts`

```ts
export type MapAction =
  | 'moveToken' | 'addToken' | 'removeToken' | 'assignToken'
  | 'editWalls' | 'editLights' | 'paintLight' | 'editFog' | 'editGrid'
  | 'openSheet' | 'exportMap'

/** user = null en mode local. */
export function can(user: string | null, owner: string, action: MapAction, token?: Token): boolean
```

- En mode local (`user === null`), tout est permis.
- Le propriétaire peut tout faire.
- Un joueur peut seulement `moveToken`, et seulement pour un token dont `player` est son pseudo.

### Copie et images

- `collectImages` (`src/shared/content.ts`) renvoie aussi l'image de fond d'une carte.
- `planCopy` (`src/shared/copy.ts`) : quand une carte est copiée avec ses copies de fiche,
  les `sheetId` des tokens de la nouvelle carte pointent vers les nouvelles copies.

## 5. Serveur et clients

### Ouverture d'une carte

```ts
// src/renderer/src/lib/library.ts : interface Library
openMap(id: string): Promise<MapSession>
```

Types dans `src/shared/carte/session.ts` :

```ts
export interface MapView {
  role: 'owner' | 'player'
  map: MapData     // pour un joueur : uniquement ce qu'il a le droit de voir (voir plus bas)
  visible: string[]   // clés des cases visibles maintenant (propriétaire : toutes)
}

export type MapPatch = Partial<Pick<MapData, 'walls' | 'lights' | 'ambient' | 'background'>>

export interface MapSession {
  readonly mapId: string
  getView(): MapView
  subscribe(cb: () => void): () => void
  addToken(input: NewTokenInput): Promise<string>   // renvoie l'id du token
  moveToken(tokenId: string, to: Cell): Promise<void>
  removeToken(tokenId: string): Promise<void>
  assignToken(tokenId: string, player: string | null): Promise<void>
  updateMap(patch: MapPatch): Promise<void>
  paintLight(keys: string[], level: LightLevel | null): Promise<void>   // null = effacer
  resizeGrid(width: number, height: number): Promise<void>
  setRevealed(keys: string[], revealed: boolean): Promise<void>
  close(): void
}
```

Une action refusée **rejette la promesse** (avec une `Error`) et ne change rien.

### Règles côté serveur (anti-triche)

Le serveur ne fait pas confiance au client. Il applique les règles lui-même.

1. Le propriétaire peut tout faire. Un joueur peut seulement déplacer les tokens qui
   lui sont attribués, et seulement là où `canMove` le permet (le propriétaire aussi
   est soumis à `canMove`).
2. Seul le propriétaire attribue un token, et seulement à un joueur **connecté** au
   serveur à ce moment-là.
3. **Un joueur ne reçoit pas ce qu'il ne doit pas voir.** Dans son `MapView`,
   `map.tokens` ne contient que les tokens situés sur une case de `visible`, et
   `map.fog.explored` ne contient que ses propres cases. Les autres données ne doivent
   pas arriver sur son ordinateur, sous aucune forme.
4. Les **copies de fiche des tokens** sont des enfants de la carte (`parentId` = id de
   la carte). Pour un joueur, elles sont absentes de l'arbre (`getState().docs`), de la
   recherche, de l'export, et `openDoc` les refuse.
5. Un joueur ne peut pas ouvrir la carte avec `openDoc` (il passe par `openMap`), ni
   l'exporter (`exportDocs` rejette) : il ne peut donc pas la copier en local.
6. Les cases vues par chaque joueur sont ajoutées à son brouillard
   (`recordExplored`), qui est enregistré avec la carte et conservé après un
   redémarrage du serveur.

### Tokens et fiches

- `addToken` avec `sheetId` et `sheetMode: 'copy'` (le défaut) crée une **copie
  indépendante** de la fiche, enfant de la carte. Le token pointe vers cette copie.
- `sheetMode: 'link'` : le token pointe vers la fiche d'origine, sans copie.
- `removeToken` supprime la copie du token, mais jamais une fiche liée.

## 6. Interface (React)

Le dessin de la carte se fait en **SVG** (pas de `<canvas>`), pour qu'il soit testable.

### `NewDocModal` (`src/renderer/src/components/Modals.tsx`)

- Propose trois choix, des boutons portant exactement les textes `Fiche`, `Carte` et
  `Dossier`. `Fiche` est choisi par défaut.
- Nouvelle signature : `onCreate: (kind: DocKind, typeId: string | null, title: string) => Promise<void>`
  (`typeId` est `null` pour une carte ou un dossier).
- La liste des types n'est utile que pour `Fiche`.

### `MapBoard` (`src/renderer/src/components/carte/MapBoard.tsx`)

```ts
export interface MapBoardProps {
  view: MapView
  viewAs?: string | null                          // propriétaire : « voir comme » ce joueur
  onViewAsChange?: (player: string | null) => void
  onMoveToken: (tokenId: string, to: Cell) => Promise<void>
  onOpenSheet: (sheetId: string) => void
  hpOf?: (tokenId: string) => { current: number; max: number } | null
}
export function MapBoard(props: MapBoardProps): JSX.Element
```

- Un `<svg>` qui contient un élément par token affiché, avec les attributs
  `data-token-id`, `data-cell="x,y"` (sa case), `aria-label` (son nom) et `tabIndex={0}`.
- Chaque case qui n'est pas visible est recouverte d'un élément
  `data-fog="explored"` ou `data-fog="hidden"`, avec l'attribut `data-cell="x,y"`.
  En vue joueur, les cases visibles sont `view.visible` et les cases explorées sont
  celles de `view.map.fog.explored` (qui ne contient que celles du joueur).
  Les tokens situés sur une case non visible ne sont pas affichés.
  Pour le propriétaire en vue complète, aucun brouillard n'est affiché.
- Clavier : quand un token a le focus, les flèches appellent `onMoveToken` avec la case voisine.
- Un déplacement refusé (promesse rejetée) ne change pas la position affichée, et un
  message apparaît dans un élément `role="alert"`.
- **Propriétaire seulement** : un clic droit sur un token ouvre un menu `role="menu"`
  qui affiche son nom, ses PV sous la forme `PV 7 / 12` (via `hpOf`), et un bouton
  `Ouvrir la fiche` qui appelle `onOpenSheet`. Pour un joueur, le clic droit n'ouvre rien.
- **Propriétaire seulement** : une liste déroulante `aria-label="Voir comme"` qui
  propose `Tout voir` et chaque joueur ayant un token. Quand `viewAs` est un joueur, la
  carte n'affiche que ce que ce joueur voit (calculé avec `visibleCellsFor`, et
  `fog.explored[joueur]` pour les cases explorées).
- Pour un joueur, il n'y a pas de liste « Voir comme ».

### `NewTokenDialog` (`src/renderer/src/components/carte/NewTokenDialog.tsx`)

```ts
export function NewTokenDialog(props: {
  sheets: DocMeta[]
  cell: Cell
  onCreate: (input: NewTokenInput) => Promise<void>
  onClose: () => void
}): JSX.Element
```

- Un champ `Nom`, une liste `aria-label="Fiche"` (avec une option `Aucune` pour un simple pion).
- Deux boutons radio : `Copie indépendante` (coché par défaut) et `Lien vers la fiche`.
- Un bouton `Créer` qui appelle `onCreate` avec `sheetMode` égal à `'copy'` ou `'link'`.
