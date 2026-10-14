# Upload Events Lambda image (ADR-016): the bundled handler plus the ClamAV scanner.
# Build from the repo root:
#   docker build --platform linux/amd64 -f workers/upload-events/Dockerfile -t docbeam-upload-events .
# Rebuilt every day by .github/workflows/upload-events-image.yml so the virus definitions stay current.

# The official image ships with the latest signature database (tags without _base).
FROM --platform=linux/amd64 clamav/clamav:stable AS definitions

FROM --platform=linux/amd64 node:22-trixie-slim AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends g++ make cmake autoconf automake libtool python3 unzip xz-utils libcurl4-openssl-dev \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY workers/upload-events/package.json workers/upload-events/
RUN npm ci --workspace @docbeam/shared --workspace @docbeam/worker-upload-events --include-workspace-root --ignore-scripts
COPY packages/shared packages/shared
COPY workers/upload-events workers/upload-events
RUN npx tsc -b workers/upload-events && npm run bundle --workspace @docbeam/worker-upload-events
# The Lambda runtime interface client, built for this image (native module).
WORKDIR /ric
RUN npm init -y >/dev/null && npm install aws-lambda-ric@4.0.2

FROM --platform=linux/amd64 node:22-trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends clamav libcurl4 ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=definitions /var/lib/clamav/ /var/lib/clamav/
ENV LAMBDA_TASK_ROOT=/var/task
WORKDIR /var/task
COPY --from=build /ric/node_modules /opt/ric/node_modules
COPY --from=build /repo/workers/upload-events/dist/lambda/ /var/task/
# Lambda runs the image as a non-root user with a read-only file system except /tmp.
ENTRYPOINT ["/usr/local/bin/node", "/opt/ric/node_modules/aws-lambda-ric/bin/index.mjs"]
CMD ["index.handler"]
