-- Non-destructive migration to enforce unique job_id values on artifacts.
-- Duplicate artifact rows are archived before applying the unique constraint.

CREATE TABLE IF NOT EXISTS artifacts_job_id_duplicates (
  id uuid PRIMARY KEY,
  job_id text NOT NULL,
  session_id text,
  topic text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  artifact text,
  char_count integer,
  sections_completed integer NOT NULL DEFAULT 0,
  total_sections integer NOT NULL DEFAULT 7,
  mode_context text,
  error text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

WITH duplicates AS (
  SELECT id
  FROM (
    SELECT id,
      ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY created_at, id) AS rn
    FROM artifacts
    WHERE job_id IS NOT NULL
  ) t
  WHERE t.rn > 1
)
INSERT INTO artifacts_job_id_duplicates
SELECT a.*
FROM artifacts a
JOIN duplicates d ON a.id = d.id;

DELETE FROM artifacts
WHERE id IN (SELECT id FROM duplicates);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE c.conname = 'artifacts_job_id_unique'
      AND t.relname = 'artifacts'
  ) THEN
    ALTER TABLE artifacts
      ADD CONSTRAINT artifacts_job_id_unique UNIQUE (job_id);
  END IF;
END
$$;
