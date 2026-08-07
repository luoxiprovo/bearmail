FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production WEBUI_ROOT=/app/dist WEBUI_PORT=8080
WORKDIR /app
COPY --from=build /src/dist ./dist
COPY server.mjs ./server.mjs
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -q -O - http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server.mjs"]
