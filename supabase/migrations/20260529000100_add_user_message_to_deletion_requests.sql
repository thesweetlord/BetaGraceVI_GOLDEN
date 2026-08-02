ALTER TABLE deletion_requests
  ADD COLUMN IF NOT EXISTS user_message text;
