#!/usr/bin/env bash
# Installation de CompanyOS sur un VPS, en une commande :
#
#   curl -fsSL https://raw.githubusercontent.com/moasko/companyOS/master/install.sh | sudo bash
#
# ou, sans aucune question :
#
#   curl -fsSL …/install.sh | sudo bash -s -- \
#     --domaine erp.monentreprise.ci --email admin@monentreprise.ci \
#     --entreprise "Mon Entreprise" --nom "Awa Koné" --oui
#
# Le script prend en charge tout le serveur : Docker, pare-feu, proxy HTTPS
# (certificats Let's Encrypt automatiques), base PostgreSQL, API, interface,
# sauvegardes quotidiennes, rotation des journaux. Il crée ensuite le
# premier espace et son administrateur, et installe la commande
# `companyos` pour la suite (statut, journaux, mise à jour, sauvegarde…).
#
# Rejouer le script sur un serveur déjà installé ne casse rien : il le
# détecte et propose `companyos mise-a-jour`.

set -Eeuo pipefail

# ---------------------------------------------------------------------------
# Réglages
# ---------------------------------------------------------------------------

DOSSIER="${COMPANYOS_DOSSIER:-/opt/companyos}"
CO_VERSION="${COMPANYOS_VERSION:-latest}"
# D'où viennent docker-compose.yml, Caddyfile et la commande companyos.
# Une copie locale du dépôt (script lancé depuis sa racine) est utilisée
# en priorité : pratique pour tester une branche.
SOURCE="${COMPANYOS_SOURCE:-}"
JOURNAL="/var/log/companyos-install.log"

DOMAINE=""
ADMIN_EMAIL=""
ENTREPRISE=""
ADMIN_NOM=""
OUI=0
PARE_FEU=1
FORCER=0

# ---------------------------------------------------------------------------
# Affichage
# ---------------------------------------------------------------------------

if [ -t 1 ]; then
  GRAS=$'\e[1m'; VERT=$'\e[32m'; JAUNE=$'\e[33m'; ROUGE=$'\e[31m'; BLEU=$'\e[34m'; FIN=$'\e[0m'
else
  GRAS=""; VERT=""; JAUNE=""; ROUGE=""; BLEU=""; FIN=""
fi

etape() { printf '\n%s▸ %s%s\n' "$GRAS$BLEU" "$*" "$FIN"; echo "== $*" >>"$JOURNAL"; }
ok() { printf '  %s✓%s %s\n' "$VERT" "$FIN" "$*"; }
avert() { printf '  %s!%s %s\n' "$JAUNE" "$FIN" "$*"; }
echec() {
  printf '\n%s✗ %s%s\n' "$ROUGE$GRAS" "$*" "$FIN" >&2
  printf '  Détails : %s\n\n' "$JOURNAL" >&2
  exit 1
}
# shellcheck disable=SC1112 # apostrophes typographiques voulues
trap 'echec "L’installation s’est arrêtée (ligne $LINENO)."' ERR

# Lit une réponse au clavier, même quand le script arrive par `curl | bash`
# (l’entrée standard est alors le script lui-même, pas le terminal).
demander() {
  local question="$1" defaut="${2:-}" reponse=""
  if [ "$OUI" = 1 ] || [ ! -r /dev/tty ]; then
    printf '%s' "$defaut"
    return
  fi
  if [ -n "$defaut" ]; then
    printf '  %s [%s] : ' "$question" "$defaut" >/dev/tty
  else
    printf '  %s : ' "$question" >/dev/tty
  fi
  IFS= read -r reponse </dev/tty || true
  printf '%s' "${reponse:-$defaut}"
}

confirmer() {
  [ "$OUI" = 1 ] && return 0
  [ -r /dev/tty ] || return 0
  local r
  printf '  %s [O/n] : ' "$1" >/dev/tty
  IFS= read -r r </dev/tty || true
  [[ -z "$r" || "$r" =~ ^[oOyY] ]]
}

aide() {
  cat <<EOF
Installation de CompanyOS sur ce serveur.

Options :
  --domaine NOM       domaine de l'application (ex. erp.monentreprise.ci)
  --email ADRESSE     adresse de l'administrateur (et des alertes Let's Encrypt)
  --entreprise NOM    nom de la première entreprise
  --nom NOM           nom affiché de l'administrateur
  --version V         version à installer (défaut : latest)
  --sans-pare-feu     ne pas configurer le pare-feu (ufw)
  --forcer            continuer malgré un système non pris en charge
  --oui               ne poser aucune question (toutes les options requises)
EOF
}

# Tout le travail est dans une fonction appelée à la dernière ligne : avec
# `curl … | bash`, l'entrée standard est le script lui-même, et bash ne
# l'exécute qu'après l'avoir lu en entier. Sans cela, une commande qui lit
# l'entrée (docker compose exec, apt…) avalerait la suite du script.
main() {
while [ $# -gt 0 ]; do
  case "$1" in
    --domaine) DOMAINE="${2:-}"; shift 2 ;;
    --email) ADMIN_EMAIL="${2:-}"; shift 2 ;;
    --entreprise) ENTREPRISE="${2:-}"; shift 2 ;;
    --nom) ADMIN_NOM="${2:-}"; shift 2 ;;
    --version) CO_VERSION="${2:-}"; shift 2 ;;
    --sans-pare-feu) PARE_FEU=0; shift ;;
    --forcer) FORCER=1; shift ;;
    --oui|-y) OUI=1; shift ;;
    -h|--help|--aide) aide; exit 0 ;;
    *) echo "Option inconnue : $1"; aide; exit 1 ;;
  esac
done

# Les fichiers de la pile viennent de la même version que les images : une
# version étiquetée (v1.2.0) prend ceux de son étiquette, sinon master.
if [ -z "$SOURCE" ]; then
  case "$CO_VERSION" in
    v[0-9]*) SOURCE="https://raw.githubusercontent.com/moasko/companyOS/$CO_VERSION/deploy" ;;
    *) SOURCE="https://raw.githubusercontent.com/moasko/companyOS/master/deploy" ;;
  esac
fi

mkdir -p "$(dirname "$JOURNAL")"
: >"$JOURNAL"
chmod 600 "$JOURNAL"

cat <<EOF

${GRAS}  CompanyOS — installation du serveur${FIN}
  Tout ce dont l'application a besoin sera installé et configuré.

EOF

# ---------------------------------------------------------------------------
# 1. Vérifications
# ---------------------------------------------------------------------------

etape "Vérification du serveur"

[ "$(id -u)" = 0 ] || echec "Lancez l'installation en administrateur : ajoutez « sudo » devant « bash »."

. /etc/os-release 2>/dev/null || true
case "${ID:-}" in
  ubuntu|debian) ok "Système : ${PRETTY_NAME:-$ID}" ;;
  *)
    [ "$FORCER" = 1 ] || echec "Système non pris en charge (${PRETTY_NAME:-inconnu}). Ubuntu 22.04/24.04 ou Debian 12 sont recommandés ; --forcer pour essayer quand même."
    avert "Système non testé : ${PRETTY_NAME:-inconnu}" ;;
esac

case "$(uname -m)" in
  x86_64|amd64) ok "Processeur : 64 bits (x86_64)" ;;
  *) echec "Processeur $(uname -m) non pris en charge : les images CompanyOS sont construites pour x86_64." ;;
esac

RAM_MO=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$RAM_MO" -lt 1800 ]; then
  echec "Mémoire insuffisante : ${RAM_MO} Mo. Il faut au moins 2 Go (4 Go conseillés)."
elif [ "$RAM_MO" -lt 3800 ]; then
  avert "Mémoire : ${RAM_MO} Mo — suffisant pour une petite équipe ; 4 Go conseillés."
else
  ok "Mémoire : ${RAM_MO} Mo"
fi

DISQUE_GO=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
[ "$DISQUE_GO" -ge 10 ] || echec "Espace disque insuffisant : ${DISQUE_GO} Go libres, il en faut au moins 10."
ok "Disque : ${DISQUE_GO} Go libres"

if [ -f "$DOSSIER/.env" ]; then
  printf '\n  CompanyOS est déjà installé dans %s.\n' "$DOSSIER"
  printf '  Pour passer à la dernière version : %scompanyos mise-a-jour%s\n' "$GRAS" "$FIN"
  printf '  Pour voir son état               : %scompanyos statut%s\n\n' "$GRAS" "$FIN"
  trap - ERR
  exit 0
fi

# Les ports 80 et 443 doivent être libres : CompanyOS gère lui-même le HTTPS.
OCCUPANTS=$(ss -Htlnp 2>/dev/null | awk '$4 ~ /:(80|443)$/ {print $4" "$6}' || true)
if [ -n "$OCCUPANTS" ]; then
  printf '%s\n' "$OCCUPANTS" >>"$JOURNAL"
  echec "Les ports 80/443 sont déjà utilisés sur ce serveur :
$(printf '%s\n' "$OCCUPANTS" | sed 's/^/    /')
  CompanyOS doit prendre le contrôle du serveur web. Arrêtez le service en
  place (Dokploy, nginx, Apache, Traefik…) ou installez sur un VPS vierge."
fi
ok "Ports 80 et 443 libres"

# ---------------------------------------------------------------------------
# 2. Questions
# ---------------------------------------------------------------------------

etape "Votre installation"

IP_PUBLIQUE=$(curl -fsS4 --max-time 5 https://api.ipify.org 2>/dev/null || curl -fsS4 --max-time 5 https://ifconfig.me 2>/dev/null || true)

[ -n "$DOMAINE" ] || DOMAINE=$(demander "Domaine de l'application (ex. erp.monentreprise.ci)")
DOMAINE=$(printf '%s' "$DOMAINE" | tr '[:upper:]' '[:lower:]' | sed -E 's#^https?://##; s#/.*$##')
[[ "$DOMAINE" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] || echec "Domaine invalide : « $DOMAINE »."

[ -n "$ADMIN_EMAIL" ] || ADMIN_EMAIL=$(demander "Adresse e-mail de l'administrateur")
ADMIN_EMAIL=$(printf '%s' "$ADMIN_EMAIL" | tr '[:upper:]' '[:lower:]')
[[ "$ADMIN_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$ ]] || echec "Adresse e-mail invalide : « $ADMIN_EMAIL »."

[ -n "$ENTREPRISE" ] || ENTREPRISE=$(demander "Nom de l'entreprise" "Mon entreprise")
[ -n "$ADMIN_NOM" ] || ADMIN_NOM=$(demander "Nom de l'administrateur" "Administrateur")

# Le DNS : le domaine (et ses sous-domaines, un par espace) doit pointer ici.
IP_DOMAINE=$(getent ahostsv4 "$DOMAINE" 2>/dev/null | awk 'NR==1 {print $1}' || true)
IP_JOKER=$(getent ahostsv4 "verif-$RANDOM.$DOMAINE" 2>/dev/null | awk 'NR==1 {print $1}' || true)
DNS_OK=1
if [ -z "$IP_PUBLIQUE" ]; then
  avert "Adresse IP publique introuvable : le DNS n'a pas pu être vérifié."
  DNS_OK=0
elif [ "$IP_DOMAINE" = "$IP_PUBLIQUE" ]; then
  ok "$DOMAINE pointe bien vers ce serveur ($IP_PUBLIQUE)"
else
  avert "$DOMAINE ne pointe pas encore vers ce serveur (${IP_DOMAINE:-aucune adresse} au lieu de $IP_PUBLIQUE)."
  DNS_OK=0
fi
if [ -n "$IP_PUBLIQUE" ] && [ "$IP_JOKER" != "$IP_PUBLIQUE" ]; then
  avert "Sous-domaines : ajoutez aussi l'enregistrement *.$DOMAINE → $IP_PUBLIQUE (un sous-domaine par entreprise)."
fi
if [ "$DNS_OK" = 0 ]; then
  avert "L'installation continue : HTTPS s'activera tout seul dès que le DNS pointera ici."
fi

printf '\n  Domaine       : %s\n  Administrateur: %s (%s)\n  Entreprise    : %s\n  Dossier       : %s\n  Version       : %s\n\n' \
  "$DOMAINE" "$ADMIN_NOM" "$ADMIN_EMAIL" "$ENTREPRISE" "$DOSSIER" "$CO_VERSION"
confirmer "Lancer l'installation ?" || { trap - ERR; echo "  Installation annulée."; exit 0; }

# ---------------------------------------------------------------------------
# 3. Paquets, Docker, mémoire d'échange
# ---------------------------------------------------------------------------

etape "Préparation du système"

export DEBIAN_FRONTEND=noninteractive
# Seulement ce qui manque : un serveur déjà équipé n'a pas besoin d'apt.
MANQUANTS=()
command -v curl >/dev/null 2>&1 || MANQUANTS+=(curl ca-certificates)
command -v openssl >/dev/null 2>&1 || MANQUANTS+=(openssl)
[ "$PARE_FEU" = 1 ] && ! command -v ufw >/dev/null 2>&1 && MANQUANTS+=(ufw)
if [ "${#MANQUANTS[@]}" -gt 0 ]; then
  apt-get update -qq >>"$JOURNAL" 2>&1
  apt-get install -y -qq "${MANQUANTS[@]}" >>"$JOURNAL" 2>&1
fi
ok "Paquets de base"

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh && sh /tmp/get-docker.sh </dev/null >>"$JOURNAL" 2>&1
  ok "Docker installé"
else
  ok "Docker déjà présent ($(docker --version | awk '{print $3}' | tr -d ,))"
fi
systemctl enable --now docker >>"$JOURNAL" 2>&1 || true
docker compose version >/dev/null 2>&1 || apt-get install -y -qq docker-compose-plugin >>"$JOURNAL" 2>&1
docker compose version >/dev/null 2>&1 || echec "Docker Compose est introuvable après installation."
ok "Docker Compose $(docker compose version --short)"

# Un petit VPS sans mémoire d'échange tue le premier processus qui déborde
# (souvent la base). 2 Go de swap évitent ces arrêts brutaux.
if [ "$RAM_MO" -lt 4000 ] && ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile 2>>"$JOURNAL" || dd if=/dev/zero of=/swapfile bs=1M count=2048 >>"$JOURNAL" 2>&1
  chmod 600 /swapfile
  mkswap /swapfile >>"$JOURNAL" 2>&1
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  ok "Mémoire d'échange : 2 Go ajoutés"
fi

# ---------------------------------------------------------------------------
# 4. Pare-feu
# ---------------------------------------------------------------------------

if [ "$PARE_FEU" = 1 ]; then
  etape "Pare-feu"
  # Le port SSH réellement utilisé, pour ne jamais s'enfermer dehors.
  PORT_SSH=$(sshd -T 2>/dev/null | awk '/^port / {print $2; exit}' || true)
  PORT_SSH="${PORT_SSH:-22}"
  ufw allow "$PORT_SSH/tcp" >>"$JOURNAL" 2>&1
  ufw allow 80/tcp >>"$JOURNAL" 2>&1
  ufw allow 443/tcp >>"$JOURNAL" 2>&1
  ufw allow 443/udp >>"$JOURNAL" 2>&1
  ufw --force enable >>"$JOURNAL" 2>&1
  ok "Ouverts : SSH ($PORT_SSH), HTTP (80), HTTPS (443). Tout le reste est fermé."
  avert "Docker publie ses ports hors d'ufw : seul Caddy (80/443) en publie, la base reste interne."
fi

# ---------------------------------------------------------------------------
# 5. Fichiers et secrets
# ---------------------------------------------------------------------------

etape "Configuration"

mkdir -p "$DOSSIER"
chmod 700 "$DOSSIER"

ICI="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
recuperer() {
  local nom="$1" cible="$2"
  if [ -n "$ICI" ] && [ -f "$ICI/deploy/$nom" ]; then
    cp "$ICI/deploy/$nom" "$cible"
  else
    curl -fsSL "$SOURCE/$nom" -o "$cible" 2>>"$JOURNAL" || echec "Téléchargement impossible : $SOURCE/$nom"
  fi
}
recuperer docker-compose.yml "$DOSSIER/docker-compose.yml"
recuperer Caddyfile "$DOSSIER/Caddyfile"
recuperer companyos /usr/local/bin/companyos
chmod 755 /usr/local/bin/companyos
ok "Fichiers de la pile dans $DOSSIER"

secret() { openssl rand -hex "$1"; }
umask 077
cat >"$DOSSIER/.env" <<EOF
# CompanyOS — généré par install.sh le $(date -u +%Y-%m-%dT%H:%MZ).
# Ces secrets protègent les sessions et les données chiffrées : ne les
# changez pas sans savoir ce que vous faites, et gardez-en une copie.
# Après une modification : companyos redemarrer

COMPANYOS_VERSION=$CO_VERSION
DOMAINE=$DOMAINE
ADMIN_EMAIL=$ADMIN_EMAIL
ACME_EMAIL=$ADMIN_EMAIL

POSTGRES_PASSWORD=$(secret 24)
JWT_SECRET=$(secret 48)
ENCRYPTION_KEY=$(secret 32)

# Inscriptions : fermées (les espaces se créent depuis la console).
INSCRIPTION_OUVERTE=false

# Envoi des e-mails (invitations, mots de passe oubliés). Facultatif.
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
MAIL_FROM=

# Sauvegardes automatiques : chaque nuit à 2 h, gardées 14 jours.
SAUVEGARDE_HEURE=2
SAUVEGARDE_RETENTION_JOURS=14
EOF
umask 022
chmod 600 "$DOSSIER/.env"
ok "Secrets générés (fichier $DOSSIER/.env, lisible par root seulement)"

# ---------------------------------------------------------------------------
# 6. Démarrage
# ---------------------------------------------------------------------------

etape "Démarrage de CompanyOS"

cd "$DOSSIER"
if docker compose pull -q >>"$JOURNAL" 2>&1; then
  ok "Images téléchargées"
else
  # Pas de registre joignable : on continue si les images sont déjà là
  # (serveur sans accès à ghcr.io, images chargées avec `docker load`).
  for image in $(docker compose config --images); do
    docker image inspect "$image" >/dev/null 2>&1 || echec "Téléchargement de l'image $image impossible (connexion à ghcr.io ?)."
  done
  avert "Registre injoignable : les images déjà présentes sur le serveur sont utilisées."
fi
docker compose up -d >>"$JOURNAL" 2>&1
ok "Conteneurs démarrés"

# shellcheck disable=SC1112
printf '  Attente de l’API (migrations de la base)'
PRET=0
for _ in $(seq 1 90); do
  if docker compose exec -T api wget -qO- http://127.0.0.1:4000/health </dev/null >/dev/null 2>&1; then
    PRET=1
    break
  fi
  printf '.'
  sleep 2
done
printf '\n'
if [ "$PRET" != 1 ]; then
  docker compose logs --tail 80 api >>"$JOURNAL" 2>&1 || true
  echec "L'API ne répond pas après 3 minutes. Voir : companyos journaux api"
fi
ok "API prête"

# ---------------------------------------------------------------------------
# 7. Première entreprise et administrateur
# ---------------------------------------------------------------------------

etape "Création de l'entreprise et de l'administrateur"

SORTIE=$(docker compose exec -T api node src/exploitant.js "$ADMIN_EMAIL" --nom "$ADMIN_NOM" --entreprise "$ENTREPRISE" --json </dev/null 2>>"$JOURNAL" | tail -1)
MOT_DE_PASSE=$(printf '%s' "$SORTIE" | sed -n 's/.*"motDePasse":"\([^"]*\)".*/\1/p')
[ -n "$MOT_DE_PASSE" ] || echec "La création du compte administrateur a échoué."
ok "« $ENTREPRISE » créée, administrateur $ADMIN_EMAIL"

trap - ERR

# ---------------------------------------------------------------------------
# Récapitulatif
# ---------------------------------------------------------------------------

cat <<EOF

${VERT}${GRAS}  CompanyOS est installé.${FIN}

  ${GRAS}Adresse      :${FIN} https://$DOMAINE
  ${GRAS}Identifiant  :${FIN} $ADMIN_EMAIL
  ${GRAS}Mot de passe :${FIN} $MOT_DE_PASSE
                 (affiché une seule fois — changez-le à la première connexion)

  ${GRAS}DNS à configurer${FIN} chez votre fournisseur de domaine :
    $DOMAINE      A  ${IP_PUBLIQUE:-<IP du serveur>}
    *.$DOMAINE    A  ${IP_PUBLIQUE:-<IP du serveur>}   (un sous-domaine par entreprise)

  ${GRAS}Gérer le serveur${FIN} :
    companyos statut        état des services, mémoire, disque
    companyos journaux      journaux en direct
    companyos mise-a-jour   passer à la dernière version
    companyos sauvegarde    sauvegarde immédiate (base + fichiers)
    companyos aide          toutes les commandes

EOF
}

main "$@"
