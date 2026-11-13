# Comrade Shop POS — all-in-one image (frontend build + Node server + SQLite)
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
# The server bundle is self-contained (esbuild) — no node_modules needed.
# Data persists in /app/data — mount a volume to keep it across rebuilds.
VOLUME ["/app/data"]
EXPOSE 5105 5106 3000
CMD ["node", "dist/boot.js"]
