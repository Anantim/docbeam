-- The audit trail is append-only (TDD DocBeam DB, D-G8). Default privileges give the app role
-- every right on a new table, so UPDATE, DELETE and TRUNCATE are taken back here. The owner role
-- keeps them and runs only migrations.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM docbeam_app;
