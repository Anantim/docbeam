# One-off DB bootstrap task (Step 0.2, D-G11). Build from the repo root:
#   docker build --platform linux/amd64 -f docker/db-bootstrap/Dockerfile -t docbeam-db-bootstrap .
FROM --platform=linux/amd64 postgres:16-alpine
RUN apk add --no-cache bash
COPY docker/db-bootstrap/bootstrap.sh /usr/local/bin/bootstrap.sh
# The RDS certificate bundle, so psql can use PGSSLMODE=verify-full (D-M5-4).
COPY --chmod=644 packages/shared/certs/rds-ca-bundle.pem /etc/rds-ca-bundle.pem
USER postgres
ENTRYPOINT ["/usr/local/bin/bootstrap.sh"]
