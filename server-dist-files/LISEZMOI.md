# kotari-server

Héberge un projet Kotari sur une machine toujours allumée du réseau local
(Raspberry Pi, NAS, mini-PC, vieux portable…). Les personnes qui ont Kotari
s'y connectent avec « Se connecter à un serveur » et éditent les mêmes fiches
en temps réel.

## Prérequis

Node.js 22 ou plus récent sur la machine serveur : <https://nodejs.org>
(sur Raspberry Pi / Debian : `sudo apt install nodejs` si la version est ≥ 22,
sinon passer par <https://github.com/nodesource/distributions>).

Le dossier `kotari-server` ne contient qu'un fichier JavaScript : rien à installer d'autre.

## 1. Préparer le dossier hébergé (une seule fois)

```sh
node kotari-server.mjs init /chemin/vers/table-partagee
```

Le programme demande le nom du projet, s'il faut ajouter les modèles, le port
(4321 par défaut) et un mot de passe. Le mot de passe est enregistré haché dans
`server.json`, jamais en clair. Le dossier peut aussi être un projet Kotari
existant (copié depuis un PC).

Changer le mot de passe plus tard : `node kotari-server.mjs password /chemin/...`

## 2. Démarrer

```sh
node kotari-server.mjs start /chemin/vers/table-partagee
```

La console affiche l'adresse à saisir dans Kotari (ex. `192.168.1.20`), puis
les connexions et déconnexions. `Ctrl+C` arrête proprement (tout est enregistré).

Sous Windows, `demarrer.cmd` fait la même chose (modifier le chemin du dossier dedans).

## 3. Démarrage automatique (Linux / Raspberry Pi)

1. Copier le dossier `kotari-server` dans `/opt/kotari-server`.
2. Éditer `kotari-server.service` : utilisateur (`User=`) et chemin du dossier hébergé.
3. Installer et lancer :

```sh
sudo cp kotari-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kotari-server
journalctl -u kotari-server -f     # voir le journal
```

## Serveur sur Internet (VPS : Hetzner, OVH…)

Le plus simple : le script `install-serveur.sh` (joint à chaque release) installe tout
sur Ubuntu/Debian — Node 22, kotari-server, Caddy (HTTPS automatique), pare-feu,
démarrage automatique :

```sh
curl -fsSL https://raw.githubusercontent.com/Zomboglace/Kotari/main/deploy/install-serveur.sh -o install-serveur.sh
sudo bash install-serveur.sh kotari.mondomaine.fr
```

Avant : créer chez le fournisseur du domaine un enregistrement DNS **A** qui pointe
le sous-domaine vers l'IP du serveur. Dans Kotari : adresse `kotari.mondomaine.fr`,
port 443, « Connexion sécurisée » cochée. Relancer le script met le serveur à jour.

## Réseau et sécurité

- Sans HTTPS, la connexion n'est pas chiffrée : réseau local uniquement, n'ouvre pas
  ce port sur ta box. Sur Internet, passe par Caddy (voir ci-dessus) ou Tailscale.
- Pour jouer avec quelqu'un qui n'est pas chez toi : installe
  [Tailscale](https://tailscale.com) sur la machine serveur et sur chaque PC,
  puis utilise l'adresse Tailscale du serveur (100.x.y.z) dans Kotari.
  Tailscale chiffre la liaison, rien d'autre à changer.
- Pare-feu : autorise le port choisi (par ex. `sudo ufw allow 4321/tcp`).

## Sauvegarde

Le dossier hébergé est un projet Kotari normal : copie-le pour le sauvegarder.
Serveur arrêté, il peut même s'ouvrir directement dans Kotari comme projet local.
