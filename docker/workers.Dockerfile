# Local only: the `workers` and `ws-local` containers in Docker Compose. They run the Lambda handlers
# through packages/worker-runtime. On AWS the handlers run in Lambda instead. Build from the repo root.
FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY services services
COPY workers workers
COPY web/package.json web/
RUN npm ci --ignore-scripts && npx tsc -b packages/worker-runtime && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/packages packages
COPY --from=build /repo/workers workers
WORKDIR /repo/packages/worker-runtime
USER node
CMD ["node", "dist/workers.js"]
