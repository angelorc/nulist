-- Full-access API keys created before the "full" preset gained template
-- create/update/delete still store the old preset and get 403 on template
-- writes. Give them the current API_KEY_SCOPES.full (shared/auth/permissions.ts).
-- Matched: stored permissions equal to the old full preset, and keys labelled
-- `scope: full` in their metadata (JSON text, sometimes double-encoded) that
-- store no permissions. Sending keys and custom permissions are left alone.
WITH decoded AS (
  SELECT
    id,
    CASE WHEN pg_input_is_valid(permissions, 'jsonb') THEN permissions::jsonb END AS granted,
    CASE WHEN pg_input_is_valid(metadata, 'jsonb') THEN metadata::jsonb END AS meta
  FROM apikey
),
unwrapped AS (
  SELECT
    id,
    granted,
    CASE
      WHEN jsonb_typeof(meta) = 'string' AND pg_input_is_valid(meta #>> '{}', 'jsonb')
        THEN (meta #>> '{}')::jsonb
      ELSE meta
    END AS meta
  FROM decoded
)
UPDATE apikey
SET permissions = '{"contact":["create","read","update","delete","import","export"],"list":["create","read","update","delete"],"segment":["read"],"topic":["read"],"template":["create","read","update","delete"],"broadcast":["create","read","update","delete","send"],"transactional":["read","send"],"suppression":["read"]}'
FROM unwrapped
WHERE apikey.id = unwrapped.id
  AND (
    unwrapped.granted = '{"contact":["create","read","update","delete","import","export"],"list":["create","read","update","delete"],"segment":["read"],"topic":["read"],"template":["read"],"broadcast":["create","read","update","delete","send"],"transactional":["read","send"],"suppression":["read"]}'::jsonb
    OR (
      apikey.permissions IS NULL
      AND jsonb_typeof(unwrapped.meta) = 'object'
      AND unwrapped.meta ->> 'scope' = 'full'
    )
  );
