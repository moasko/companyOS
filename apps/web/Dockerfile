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

# La construction du shell est le moment le plus gourmand du déploiement :
# elle empaquette Monaco, les visionneuses de documents et le moteur 3D, et
# sort une quarantaine de mégaoctets. Sur un petit VPS, Node se voit
# attribuer un tas trop étroit et le processus est tué par le noyau — le
# journal de Dokploy affiche alors « killed », sans autre explication.
#
# Le tas est donc fixé explicitement plutôt que deviné. À baisser si la
# machine a moins de 4 Go, à condition d'avoir du swap :
#
#   docker build --build-arg NODE_HEAP_MO=1536 …
ARG NODE_HEAP_MO=3072
ENV NODE_OPTIONS=--max-old-space-size=$NODE_HEAP_MO

RUN npm run build --workspace @companyos/web

# ---------------------------------------------------------------------------

FROM nginx:1.27-alpine

# La même URL d'API que celle figée dans le bundle. Un `ARG` ne traverse
# pas les étapes : il faut le redéclarer ici.
ARG VITE_API_URL

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# La politique de sécurité doit nommer l'origine de l'API, sinon le
# navigateur refuse les appels du shell vers elle. Comme l'adresse de
# l'API, elle est fixée au **démarrage** du conteneur (docker-entrypoint.sh),
# à partir d'un modèle : la même image sert n'importe quel domaine.
# L'adresse éventuellement figée au build sert de repli.
ENV COMPANYOS_API_BUILD=${VITE_API_URL}
RUN cp /etc/nginx/conf.d/default.conf /etc/nginx/companyos.conf.modele \
    && sed -i "s|__API_ORIGIN__||g" /etc/nginx/conf.d/default.conf \
    && nginx -t

COPY --from=build /app/apps/web/build /usr/share/nginx/html

# Adresse de l'API lue au démarrage plutôt que figée : la même image sert
# n'importe quel domaine (installation par install.sh). Voir le script.
COPY --chmod=755 apps/web/docker-entrypoint.sh /docker-entrypoint.d/40-companyos-config.sh

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
