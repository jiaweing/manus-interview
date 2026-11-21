# Build from products/flopside: docker build -t flopside .
FROM oven/bun:1.4.5 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun run build

FROM oven/bun:1.4.5 AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 WEB_PORT=3000
# Bun's bundle has no runtime node_modules; Next is exported static HTML/JS/CSS.
COPY --from=build --chown=bun:bun /app/apps/server/dist ./apps/server/dist
COPY --from=build --chown=bun:bun /app/apps/web/out ./apps/web/out
USER bun
EXPOSE 3000
# Exactly one Bun process, no Next runtime server/supervisor/cluster/replicas.
CMD ["bun", "apps/server/dist/index.js"]
