FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

COPY ui/package.json ui/package-lock.json ./ui/
RUN cd ui && npm ci
COPY ui/ ./ui/
RUN cd ui && npx vite build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
VOLUME /data
ENV DAMASQAS_DATA_DIR=/data
EXPOSE 3888
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3888/api/health || exit 1
CMD ["node", "dist/index.js"]
