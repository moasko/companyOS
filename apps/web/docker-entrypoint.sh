#!/bin/sh
# Avant que nginx démarre (l'image officielle exécute
# /docker-entrypoint.d/*.sh) : l'adresse de l'API, pour le shell
# (/config.js) et pour la politique de sécurité (CSP) de nginx.
#
#   API_URL absente  → l'adresse figée au build (COMPANYOS_API_BUILD) ; si
#                      aucune, même origine.
#   API_URL=""       → même origine : le proxy devant (Caddy, installé par
#                      install.sh) envoie /api à l'API.
#   API_URL=https://api.exemple.ci → une API sur un autre domaine (ancien
#                      déploiement Dokploy, docker-compose.prod.yml).
set -eu
if [ "${API_URL+defini}" = "defini" ]; then
  url="$API_URL"
else
  url="${COMPANYOS_API_BUILD:-}"
fi

# Shell : échappe guillemets et antislashs, la valeur finit dans du JS.
valeur=$(printf '%s' "$url" | sed 's/\\/\\\\/g; s/"/\\"/g')
printf 'window.__COMPANYOS__ = { apiUrl: "%s" };\n' "$valeur" > /usr/share/nginx/html/config.js

# CSP : l'origine seule (schéma + hôte), vide pour la même origine (déjà
# couverte par 'self'). Seuls les caractères d'une origine passent.
origine=$(printf '%s' "$url" | sed -nE 's#^(https?://[A-Za-z0-9.:-]+).*#\1#p')
if [ -f /etc/nginx/companyos.conf.modele ]; then
  sed "s|__API_ORIGIN__|${origine}|g" /etc/nginx/companyos.conf.modele > /etc/nginx/conf.d/default.conf
fi
