#!/bin/sh
# Écrit /config.js à partir des variables du conteneur, avant que nginx
# démarre (l'image officielle exécute /docker-entrypoint.d/*.sh).
#
#   API_URL absente  → rien n'est écrit : le shell garde l'adresse figée
#                      au build (cas Dokploy historique).
#   API_URL=""       → même origine : le proxy devant (Caddy, installé par
#                      install.sh) envoie /api à l'API.
#   API_URL=https://api.exemple.ci → une API sur un autre domaine.
set -eu
CIBLE=/usr/share/nginx/html/config.js
if [ "${API_URL+defini}" = "defini" ]; then
  # Échappe les guillemets et antislashs : la valeur finit dans du JavaScript.
  valeur=$(printf '%s' "$API_URL" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf 'window.__COMPANYOS__ = { apiUrl: "%s" };\n' "$valeur" > "$CIBLE"
fi
