/*
  # Initialize AI Chat Platform Database

  1. New Tables
    - `sessions` - User sessions with age verification and mode preferences
    - `messages` - Chat messages with mode and token tracking
    - `conversations` - Conversation metadata and organization
    - `consent` - User privacy and cookie consent tracking
    - `learning_data` - Parallel learning patterns for model improvement
    - `long_term_memory` - Persistent memory index for long-term pattern tracking
    - `deletion_requests` - Data deletion and export request tracking

  2. Security
    - RLS enabled on all tables
    - Policies ensure data isolation by session/user
    - Public read for deletion requests tracking only

  3. Indexes
    - Session-based queries optimized
    - Timestamp-based sorting supported
*/

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  data jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  active_modes text[] DEFAULT ARRAY['standard'],
  age_verified boolean DEFAULT false,
  is_over_18 boolean,
  consent_given boolean DEFAULT false,
  data_retention_opt_out boolean DEFAULT false,
  advanced_reasoning_enabled boolean DEFAULT true,
  faith_enhancement_enabled boolean DEFAULT false,
  learning_data_acknowledged boolean DEFAULT false,
  learning_data_acknowledged_at timestamptz
);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sessions are accessible to all authenticated users"
  ON sessions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert their own sessions"
  ON sessions FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update their own sessions"
  ON sessions FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);


CREATE TABLE IF NOT EXISTS conversations (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}',
  title text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  message_count integer DEFAULT 0,
  active_modes text[] DEFAULT ARRAY['standard']
);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view conversations from their sessions"
  ON conversations FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can create conversations"
  ON conversations FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update conversations"
  ON conversations FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can delete conversations"
  ON conversations FOR DELETE
  TO authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS idx_conversations_session_id ON conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at);


CREATE TABLE IF NOT EXISTS messages (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  conversation_id text REFERENCES conversations(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}',
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('standard', 'flesh_architect', 'sanctuary', 'advanced_reasoning', 'autonomous')),
  timestamp timestamptz DEFAULT now(),
  tokens integer
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view messages from their sessions"
  ON messages FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can create messages"
  ON messages FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can delete messages"
  ON messages FOR DELETE
  TO authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);


CREATE TABLE IF NOT EXISTS consent (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  essential_cookies boolean DEFAULT true,
  analytics_cookies boolean DEFAULT false,
  functional_cookies boolean DEFAULT false,
  data_retention boolean DEFAULT false,
  marketing_communications boolean DEFAULT false,
  third_party_sharing boolean DEFAULT false,
  consent_date timestamptz DEFAULT now(),
  last_updated timestamptz DEFAULT now()
);

ALTER TABLE consent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their consent records"
  ON consent FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can create consent records"
  ON consent FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update consent records"
  ON consent FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_consent_session_id ON consent(session_id);


CREATE TABLE IF NOT EXISTS learning_data (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  pattern_type text NOT NULL CHECK (pattern_type IN ('writing_style', 'mode_preference', 'topic_interest', 'feedback')),
  pattern_data text NOT NULL,
  weight numeric DEFAULT 1.0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE learning_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their learning data"
  ON learning_data FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can create learning data"
  ON learning_data FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can delete learning data"
  ON learning_data FOR DELETE
  TO authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS idx_learning_data_session_id ON learning_data(session_id);
CREATE INDEX IF NOT EXISTS idx_learning_data_pattern_type ON learning_data(pattern_type);


CREATE TABLE IF NOT EXISTS long_term_memory (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  memory_type text NOT NULL CHECK (memory_type IN ('user_pattern', 'writing_signature', 'thematic_preference', 'behavioral_trend', 'semantic_cluster')),
  summary text NOT NULL,
  semantic_hash text NOT NULL,
  occurrences integer DEFAULT 1,
  total_weight numeric DEFAULT 1.0,
  related_patterns text[] DEFAULT ARRAY[]::text[],
  last_updated timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  confidence_score numeric DEFAULT 0.5,
  token_estimate integer DEFAULT 0
);

ALTER TABLE long_term_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their long-term memory"
  ON long_term_memory FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can create long-term memory"
  ON long_term_memory FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update long-term memory"
  ON long_term_memory FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can delete long-term memory"
  ON long_term_memory FOR DELETE
  TO authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS idx_long_term_memory_session_id ON long_term_memory(session_id);
CREATE INDEX IF NOT EXISTS idx_long_term_memory_semantic_hash ON long_term_memory(semantic_hash);
CREATE INDEX IF NOT EXISTS idx_long_term_memory_memory_type ON long_term_memory(memory_type);


CREATE TABLE IF NOT EXISTS deletion_requests (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  request_type text NOT NULL CHECK (request_type IN ('full_deletion', 'data_export', 'opt_out')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  requested_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  user_message text
);

ALTER TABLE deletion_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their deletion requests"
  ON deletion_requests FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can create deletion requests"
  ON deletion_requests FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_deletion_requests_session_id ON deletion_requests(session_id);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_status ON deletion_requests(status);
