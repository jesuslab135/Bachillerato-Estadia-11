# SGA-Militar backend — imagen de producción.
# Multi-stage: compila TypeScript y genera el cliente Prisma en el mismo target
# (linux musl) donde correrá. El runtime conserva node_modules completo porque
# las migraciones (prisma CLI) y el seed (tsx) se ejecutan dentro del contenedor.

FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json package-lock.json ./
EXPOSE 3000
# migrate deploy es idempotente: aplica solo las migraciones pendientes antes de arrancar.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
