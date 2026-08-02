DROP TABLE IF EXISTS anchor_token_cache;
DROP TABLE IF EXISTS scene_anchor_history;
DROP TABLE IF EXISTS generated_images;
DROP TABLE IF EXISTS images;
ALTER TABLE IF EXISTS messages DROP COLUMN IF EXISTS created_at;
