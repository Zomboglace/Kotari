#!/usr/bin/env bash
# Installe ou met à jour kotari-server sur un serveur Ubuntu/Debian, en HTTPS.
# Utilise Caddy, ou nginx + certbot si nginx occupe déjà les ports 80/443 (autre site).
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
REPO=Zomboglace/Kotari
RELEASE_URL="https://github.com/$REPO/releases/latest/download/kotari-server.zip"

say() { printf '\n\033[1;33m== %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mErreur : %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "lance ce script en root (ou avec sudo)."
[ -n "$DOMAIN" ] || die "indique le nom de domaine, ex. : bash install-serveur.sh kotari.mondomaine.fr"
[ -t 0 ] || die "lance le script depuis un terminal (pas avec « curl | bash ») : il te demandera un mot de passe."

say "Paquets système"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl unzip git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https ufw

say "Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

# Qui sert déjà les ports web ? (nginx pour un autre site, par exemple)
WEB=caddy
if systemctl is-active --quiet nginx; then
  WEB=nginx
elif systemctl is-active --quiet apache2; then
  die "Apache occupe les ports 80/443. Ce script gère Caddy ou nginx : configure à la main un proxy WebSocket vers 127.0.0.1:$PORT."
fi

say "kotari-server (dernière version publiée)"
id kotari >/dev/null 2>&1 || useradd --system --home "$DATA_ROOT" --shell /usr/sbin/nologin kotari
mkdir -p "$APP_DIR" "$DATA_ROOT"
tmp=$(mktemp -d)
if curl -fsSL "$RELEASE_URL" -o "$tmp/kotari-server.zip"; then
  unzip -q -o "$tmp/kotari-server.zip" -d "$tmp"
  cp -f "$tmp"/kotari-server/* "$APP_DIR"/
else
  # Pas encore de release publiée : on construit kotari-server depuis le code source.
  echo "Aucune release trouvée : construction depuis le code source (2 à 3 minutes)…"
  git clone --depth 1 "https://github.com/$REPO.git" "$tmp/src"
  (cd "$tmp/src" && ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --ignore-scripts --no-audit --no-fund && node scripts/build-server.mjs)
  cp -f "$tmp"/src/dist-server/kotari-server/* "$APP_DIR"/
fi
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

setup_caddy() {
  if ! command -v caddy >/dev/null; then
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y
    apt-get install -y caddy
  fi
  local CF=/etc/caddy/Caddyfile
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
}

setup_nginx() {
  # Caddy installé par une version précédente de ce script : inutile ici, nginx a les ports.
  systemctl disable --now caddy >/dev/null 2>&1 || true
  dpkg -s python3-certbot-nginx >/dev/null 2>&1 || apt-get install -y certbot python3-certbot-nginx
  local site=/etc/nginx/sites-available/kotari
  # Ne pas écraser la version modifiée par certbot (bloc 443) lors d'une mise à jour.
  if [ ! -f "$site" ] || ! grep -q "ssl_certificate" "$site"; then
    cat > "$site" <<EOF
# kotari-server : proxy WebSocket vers 127.0.0.1:$PORT
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 1d;
        proxy_send_timeout 1d;
    }
}
EOF
  fi
  ln -sf "$site" /etc/nginx/sites-enabled/kotari
  nginx -t
  systemctl reload nginx
  # Certificat Let's Encrypt : certbot ajoute le bloc HTTPS et la redirection.
  certbot --nginx -d "$DOMAIN" --redirect --keep-until-expiring --non-interactive --agree-tos --register-unsafely-without-email \
    || echo "Certificat pas encore obtenu (DNS pas prêt ?). Relance le script plus tard."
}

say "HTTPS : https://$DOMAIN (via $WEB)"
if [ "$WEB" = nginx ]; then setup_nginx; else setup_caddy; fi

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
  echo "Vérifie l'enregistrement DNS A, puis relance ce script."
else
  echo "DNS : $DOMAIN → $ip"
fi
if curl -sS -m 10 -o /dev/null "https://$DOMAIN/" 2>/dev/null; then
  echo "HTTPS : https://$DOMAIN répond avec un certificat valide"
else
  echo "HTTPS : https://$DOMAIN ne répond pas encore correctement (certificat en cours ?)"
fi

cat <<EOF

Terminé. Dans Kotari (version 0.3 ou plus) : « Se connecter à un serveur »
  Adresse : $DOMAIN
  Port    : 443   (case « Connexion sécurisée » cochée)
  Mot de passe : celui que tu as choisi

Commandes utiles :
  journalctl -u kotari-server -f        journal (connexions)
  systemctl restart kotari-server       redémarrer
  sudo bash install-serveur.sh $DOMAIN  mettre à jour
  sudo -u kotari node $APP_DIR/kotari-server.mjs password $DATA_DIR   changer le mot de passe (puis redémarrer)
EOF
