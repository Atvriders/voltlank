-- Convert every timestamp-without-time-zone column to timestamptz so that all
-- date handling is timezone-safe (fixes queue `runAt` comparisons and future
-- multi-timezone user data).

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type = 'timestamp without time zone'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I TYPE timestamptz', 'public', r.table_name, r.column_name);
  END LOOP;
END $$;
