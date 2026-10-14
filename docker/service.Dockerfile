# One Dockerfile for the three ECS services. Build from the repo root:
#   docker build --platform linux/amd64 -f docker/service.Dockerfile --build-arg SERVICE=auth -t docbeam-auth .
# SERVICE is auth, platform or docbeam-api. The image runs the server; the migrate task runs
# `node dist/migrate.js` with the same image.
ARG NODE_IMAGE=node:22-bookworm-slim

FROM --platform=linux/amd64 ${NODE_IMAGE} AS manifests
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/worker-runtime/package.json packages/worker-runtime/
COPY services/auth/package.json services/auth/
COPY services/platform/package.json services/platform/
COPY services/docbeam-api/package.json services/docbeam-api/
COPY workers/fanout/package.json workers/fanout/
COPY workers/delivery/package.json workers/delivery/
COPY workers/upload-events/package.json workers/upload-events/
COPY workers/dlq/package.json workers/dlq/
COPY workers/ws/package.json workers/ws/
COPY workers/sweeper/package.json workers/sweeper/
COPY web/package.json web/

FROM manifests AS build
ARG SERVICE
RUN npm ci --workspace @docbeam/shared --workspace @docbeam/${SERVICE} --include-workspace-root
COPY packages/shared packages/shared
COPY services/${SERVICE} services/${SERVICE}
RUN npx tsc -b services/${SERVICE}

FROM manifests AS deps
ARG SERVICE
RUN npm ci --omit=dev --workspace @docbeam/shared --workspace @docbeam/${SERVICE}

FROM --platform=linux/amd64 ${NODE_IMAGE}
ARG SERVICE
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=deps /repo/node_modules node_modules
COPY --from=build /repo/packages/shared/package.json packages/shared/
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/services/${SERVICE}/package.json services/${SERVICE}/
COPY --from=build /repo/services/${SERVICE}/dist services/${SERVICE}/dist
COPY --from=build /repo/services/${SERVICE}/migrations services/${SERVICE}/migrations
WORKDIR /repo/services/${SERVICE}
USER node
CMD ["node", "dist/server.js"]
