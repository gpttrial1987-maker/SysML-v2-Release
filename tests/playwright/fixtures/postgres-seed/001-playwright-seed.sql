-- Seeded schema for Playwright integration tests.
-- The SysML v2 API container performs all schema migrations automatically.
-- This script simply ensures deterministic database settings before the
-- migrations run and acts as a marker that the seeded volume was applied.
\connect sysml2
SET TIME ZONE 'UTC';
COMMENT ON DATABASE sysml2 IS 'Playwright seeded baseline';
