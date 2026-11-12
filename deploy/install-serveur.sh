#!/usr/bin/env bash
# Installe ou met à jour kotari-server sur un serveur Ubuntu/Debian, derrière Caddy (HTTPS automatique).
#
#   curl -fsSL https://raw.githubusercontent.com/Zomboglace/Kotari/main/deploy/install-serveur.sh -o install-serveur.sh
#   sudo bash install-serveur.sh kotari.mondomaine.fr
#
# Relancer le même script plus tard met kotari-server à jour (les données sont conservées).
set -euo pipefail

DOMAIN="${1:-${DOMAIN:-}}"
PORT=4321
APP_DIR=/opt/kotari-server
DATA_ROOT=/var/lib/kotari
DATA_DIR=$DATA_ROOT/projet
RELEASE_URL="https://github.com/Zomboglace/Kotari/releases/latest/download/kotari-server.zip"

say() { printf '\n\033[1;33m== %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mErreur : %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "lance ce script en root (ou avec sudo)."
[ -n "$DOMAIN" ] || die "indique le nom de domaine, ex. : bash install-serveur.sh kotari.mondomaine.fr"
[ -t 0 ] || die "lance le script depuis un terminal (pas avec « curl | bash ») : il te demandera un mot de passe."

say "Paquets système"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl unzip ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https ufw

say "Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

say "Caddy (certificat HTTPS automatique)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

say "kotari-server (dernière version publiée)"
id kotari >/dev/null 2>&1 || useradd --system --home "$DATA_ROOT" --shell /usr/sbin/nologin kotari
mkdir -p "$APP_DIR" "$DATA_ROOT"
tmp=$(mktemp -d)
curl -fsSL "$RELEASE_URL" -o "$tmp/kotari-server.zip"
unzip -q -o "$tmp/kotari-server.zip" -d "$tmp"
cp -f "$tmp"/kotari-server/* "$APP_DIR"/
rm -rf "$tmp"
echo "Version : $(node "$APP_DIR/kotari-server.mjs" version)"

if [ ! -f "$DATA_DIR/server.json" ]; then
  say "Création du projet hébergé"
  read -rp "Nom du projet [Table partagée] : " NAME
  NAME=${NAME:-Table partagée}
  echo "Choisis le mot de passe que les joueurs saisiront dans Kotari."
  node "$APP_DIR/kotari-server.mjs" init "$DATA_DIR" --port "$PORT" --host 127.0.0.1 --name "$NAME" --templates
else
  echo "Projet existant conservé : $DATA_DIR"
fi
chown -R kotari:kotari "$DATA_ROOT"

say "Service kotari-server (démarrage automatique)"
cat > /etc/systemd/system/kotari-server.service <<EOF
[Unit]
Description=Kotari Serveur
After=network-online.target
Wants=network-online.target

[Service]
User=kotari
Group=kotari
ExecStart=/usr/bin/node $APP_DIR/kotari-server.mjs start $DATA_DIR
Restart=on-failure
RestartSec=5
KillSignal=SIGINT
TimeoutStopSec=20
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA_ROOT

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable kotari-server >/dev/null
systemctl restart kotari-server

say "Caddy : https://$DOMAIN"
CF=/etc/caddy/Caddyfile
touch "$CF"
if grep -q "^# kotari-server début" "$CF"; then
  # Mise à jour : on réécrit seulement le bloc Kotari.
  sed -i '/^# kotari-server début/,/^# kotari-server fin/d' "$CF"
elif grep -q "/usr/share/caddy" "$CF"; then
  # Caddyfile d'exemple installé avec Caddy (page d'accueil) : remplacé.
  cp "$CF" "$CF.avant-kotari"
  : > "$CF"
elif [ -s "$CF" ]; then
  # D'autres sites existent : on garde tout et on ajoute Kotari à la fin.
  cp "$CF" "$CF.avant-kotari"
fi
cat >> "$CF" <<EOF
# kotari-server début
$DOMAIN {
	reverse_proxy 127.0.0.1:$PORT
}
# kotari-server fin
EOF
caddy fmt --overwrite "$CF" >/dev/null 2>&1 || true
systemctl enable caddy >/dev/null
systemctl reload caddy 2>/dev/null || systemctl restart caddy

say "Pare-feu : SSH, HTTP et HTTPS seulement"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ufw status | sed -n '1,12p'

say "Vérifications"
sleep 2
systemctl is-active --quiet kotari-server && echo "kotari-server : actif" || { echo "kotari-server ne démarre pas :"; journalctl -u kotari-server -n 20 --no-pager; }
ip=$(curl -fsS4 https://api.ipify.org || true)
dns=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)
if [ -n "$ip" ] && [ "$dns" != "$ip" ]; then
  echo "Attention : $DOMAIN pointe vers « ${dns:-rien} » au lieu de $ip."
  echo "Vérifie l'enregistrement DNS A. Caddy obtiendra le certificat tout seul dès que ce sera bon."
else
  echo "DNS : $DOMAIN → $ip"
fi

cat <<EOF

Terminé. Dans Kotari : « Se connecter à un serveur »
  Adresse : $DOMAIN
  Port    : 443   (case « Connexion sécurisée » cochée)
  Mot de passe : celui que tu viens de choisir

Commandes utiles :
  journalctl -u kotari-server -f        journal (connexions)
  systemctl restart kotari-server       redémarrer
  sudo bash install-serveur.sh $DOMAIN  mettre à jour
  sudo -u kotari node $APP_DIR/kotari-server.mjs password $DATA_DIR   changer le mot de passe (puis redémarrer)
EOF
