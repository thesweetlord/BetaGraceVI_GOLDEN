CREATE TABLE IF NOT EXISTS artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id text NOT NULL UNIQUE,
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
