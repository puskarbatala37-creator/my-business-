FROM node:22-bookworm-slim AS build
# Build tools, in case the database driver has to be compiled (no ready-made download for the host).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app/server
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data WEB_DIST=/app/web/dist
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/package.json ./
COPY --from=build /app/web/dist /app/web/dist
VOLUME /data
EXPOSE 3000
CMD ["node", "dist/index.js"]
