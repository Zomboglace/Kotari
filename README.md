# Kotari

Fiches imbriquées en local (Personnage → Inventaire…) et édition à plusieurs
en temps réel via **kotari-server**.

- `Kotari` : l'application de bureau (Electron + React + TypeScript).
- `kotari-server` : serveur Node sans interface, pour une machine toujours allumée du réseau local.

## Développement

Node.js 22+.

```sh
npm install
npm run dev          # lance l'app avec rechargement à chaud
npm test             # test d'intégration serveur + deux clients
npm run typecheck
```

Serveur de test local :

```sh
npm run build:server
node dist-server/kotari-server/kotari-server.mjs init ./test-serveur
node dist-server/kotari-server/kotari-server.mjs start ./test-serveur
```

Puis dans Kotari : « Se connecter à un serveur », adresse `127.0.0.1`, port `4321`.

## Publier une version

1. Changer `version` dans `package.json` (ex. `0.3.1`) et committer.
2. `git tag v0.3.1 && git push && git push origin v0.3.1`
3. GitHub Actions construit et publie la release : installateur Windows, `latest.yml`
   (mise à jour automatique des apps installées), `kotari-server.zip`, `install-serveur.sh`.

Les Kotari installés trouvent la nouvelle version au démarrage, la téléchargent et
proposent « Redémarrer » en bas de la barre latérale.

Serveur sur un VPS : voir `deploy/install-serveur.sh` (relancer le script = mise à jour).

## Builds

```sh
npm run dist           # installateur Windows (local, sans publier) : release/Kotari-Setup-<version>.exe
npm run build:server   # dist-server/kotari-server/ (à copier sur la machine serveur)
```

Voir `server-dist-files/LISEZMOI.md` pour installer le serveur.

## Organisation

```text
src/shared/     format de projet, modèle, contenu Yjs, copie, protocole, modèles
src/main/       process principal Electron (seul à toucher le disque)
src/preload/    API minimale exposée au rendu
src/renderer/   interface React (arbres, fiche, types, modales)
src/server/     kotari-server (Hocuspocus)
tests/          test d'intégration
```

## Format d'un projet

```text
mon-monde/
  kotari.json              nom, version du format
  types/<id>.json          définition des champs
  documents/<id>.json      titre, type, parent, ordre
  documents/<id>.yjs       contenu (Yjs : fusion des saisies simultanées)
  images/<empreinte>       images des champs Image (SHA-256, jamais en double)
  server.json              uniquement côté serveur : port, mot de passe haché
```

Le même dossier s'ouvre en local ou s'héberge sur le serveur.

## Règles

- Glisser dans un même arbre : déplace (dessus/dessous = réordonne, milieu = sous-fiche).
- Glisser entre l'arbre local et l'arbre serveur : **copie** le document et ses sous-fiches
  (nouveaux identifiants). Les types manquants sont copiés ; un type de même identifiant
  mais aux champs différents devient « Nom (2) ».
- Un type utilisé par au moins une fiche ne peut pas être supprimé. Changer le genre d'un champ
  convertit les valeurs quand c'est possible (avec avertissement) ; retirer un champ abandonne ses valeurs.
- Le mot de passe du serveur n'est retenu que si on coche la case, chiffré avec le compte Windows.
- Sur Internet : HTTPS via Caddy (case « Connexion sécurisée »). Sans HTTPS : réseau local ou Tailscale uniquement.

## Nouveautés 0.2

- Thème clair / sombre / système et couleur d'accent (⚙ en haut de la barre latérale).
- Texte riche sans barre d'outils : Markdown au clavier (`#`, `**gras**`, `- `, `> `…).
- Sous-fiches affichées en cartes éditables dans la fiche parente ; lignes, nombre par ligne
  et hauteur réglables, cartes déplaçables. La disposition est enregistrée dans la fiche.
- Ctrl+F (fiche + sous-fiches) et Ctrl+Maj+F (tout le projet et le serveur).
- Projets et serveurs récents dans la barre latérale ; mot de passe retenu chiffré (safeStorage).
- Nouveaux genres de champs : Caractéristique (+x, formule réglable), Jauge, Case à cocher,
  Choix dans une liste, Image (largeur réglable dans la fiche). Listes imbriquées sans limite.
- Le genre d'un champ peut changer : conversion automatique quand c'est possible.
- L'écran Types se souvient du type ouvert et d'une création en cours.

Raccourci de debug : `Ctrl+Shift+I` ouvre les outils de développement.
