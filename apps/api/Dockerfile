# API CompanyOS — Fastify + Prisma.
#
# Le contexte de build est la **racine du dépôt** : les workspaces npm ont
# besoin du package.json et du lockfile de la racine, et l'API dépend de
# packages/shared (les règles métier qu'elle partage avec le shell).
#
#   docker build -f apps/api/Dockerfile .
#
# L'image embarque le client Prisma généré et applique les migrations au
# démarrage : un déploiement Dokploy n'a aucune étape manuelle. Le seed est
# idempotent (il complète le catalogue d'applications sans rien écraser), on
# le rejoue donc à chaque démarrage sans risque.

FROM node:22-alpine

# OpenSSL : requis par le moteur Prisma sur Alpine.
#
# Client PostgreSQL : `pg_dump` et `pg_restore` pour les sauvegardes
# automatiques (src/sauvegardes.js). Sa version majeure doit être **au
# moins** celle du serveur : un pg_dump plus ancien refuse de sauvegarder
# (« server version mismatch »), et la console Plateforme affiche alors la
# sauvegarde en échec. Pour un serveur PostgreSQL 18, construire avec
# --build-arg PG_CLIENT=postgresql18-client.
ARG PG_CLIENT=postgresql17-client
RUN apk add --no-cache openssl ${PG_CLIENT}

WORKDIR /app

# Les manifestes d'abord, pour que la couche d'installation soit réutilisée
# tant que les dépendances ne bougent pas.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/

# Dépendances de développement comprises : le CLI `prisma` en est une, et
# `migrate deploy` en a besoin à chaque démarrage du conteneur. L'image est
# un peu plus lourde ; le démarrage, lui, ne télécharge jamais rien.
RUN npm ci --workspace @companyos/api --include-workspace-root

COPY packages/shared packages/shared
COPY apps/api/prisma apps/api/prisma

RUN npm run prisma:generate --workspace @companyos/api

COPY apps/api/src apps/api/src

# Le stockage des fichiers vit hors de l'image — voir le volume dans
# docker-compose.prod.yml. Sans volume, chaque redéploiement viderait le
# cloud des espaces de travail.
ENV STORAGE_LOCAL_PATH=/data/storage
ENV SAUVEGARDE_DOSSIER=/data/sauvegardes
ENV PORT=4000
ENV NODE_ENV=production

# Ne pas tourner en root : si une faille d'exécution de code est trouvée un
# jour dans une dépendance, elle s'exécute avec les droits de ce compte et
# pas ceux de l'hôte du conteneur. `node` existe déjà dans l'image officielle.
RUN mkdir -p /data/storage /data/sauvegardes \
  && chown -R node:node /data/storage /data/sauvegardes /app
USER node

WORKDIR /app/apps/api

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:4000/health || exit 1

CMD ["sh", "-c", "npx prisma migrate deploy && node prisma/seed.js && node src/index.js"]
