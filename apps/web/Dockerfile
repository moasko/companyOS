# Shell CompanyOS — build Vite servi par nginx.
#
# Le contexte de build est la **racine du dépôt**, pas ce dossier : les
# workspaces npm ont besoin du package.json et du lockfile de la racine, et
# le shell dépend de packages/shared.
#
#   docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=… .
#
# L'URL de l'API est figée **au build** (import.meta.env) : elle passe en
# argument, pas en variable d'exécution. Changer d'API = reconstruire.

FROM node:22-alpine AS build

WORKDIR /app

# Les manifestes d'abord : tant qu'ils ne changent pas, Docker réutilise la
# couche d'installation, qui est de loin la plus longue.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

RUN npm ci --workspace @companyos/web --include-workspace-root

COPY packages/shared packages/shared
COPY apps/web apps/web

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build --workspace @companyos/web

# ---------------------------------------------------------------------------

FROM nginx:1.27-alpine

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/build /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
