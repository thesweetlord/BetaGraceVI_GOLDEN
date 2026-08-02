Migration workflow

- Migrations live in `supabase/migrations` (this is the `out` path in `drizzle.config.ts`).
- To generate a new migration (based on current `shared/db-schema.ts`):

  ```bash
  npx drizzle-kit generate --schema ./shared/db-schema.ts --out ./supabase/migrations
  ```

- To apply existing migrations in the repo to the database:

  ```bash
  npm run migrate:up
  # or
  npx drizzle-kit up --config drizzle.config.ts
  ```

  This applies the stored SQL migrations in `supabase/migrations`.

- To synchronize the live database to match the schema file (`shared/db-schema.ts`) with a preview and manual confirmation use:

  ```bash
  npm run db:push
  # or to auto-approve destructive statements (USE WITH CAUTION):
  npx drizzle-kit push --force
  ```

Guidelines
- Review generated SQL files before applying them.
- Do NOT use `--force` in production or when you need to preserve existing data.
- If `db:push` proposes data loss, abort and reconcile by either:
  - creating targeted migrations that preserve or transform data, or
  - cleaning legacy data intentionally and committing the cleanup migration.

If you need help writing a non-destructive migration for a specific change, open an issue or ask for assistance.
