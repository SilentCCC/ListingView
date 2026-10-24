# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY client/package*.json client/
COPY server/package*.json server/
RUN npm ci
RUN npm --prefix client ci
RUN npm --prefix server ci
COPY client client
COPY server server
RUN npm --prefix client run build
RUN npm --prefix server run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5172
ENV DATA_DIR=/data
ENV CLIENT_DIST_DIR=/app/client/dist
ENV CORS_ORIGIN=http://localhost:5172
COPY --from=build /app/server/package*.json server/
COPY --from=build /app/server/node_modules server/node_modules
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
RUN mkdir -p /data/uploads && chown -R node:node /app /data
USER node
EXPOSE 5172
VOLUME ["/data"]
CMD ["npm", "--prefix", "server", "run", "start"]


