DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'account_memberships') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'account_memberships_role_check'
    ) THEN
      ALTER TABLE account_memberships
        ADD CONSTRAINT account_memberships_role_check
        CHECK (role IN ('customer', 'admin', 'super-admin', 'owner', 'member', 'viewer'));
    END IF;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'edit_usage') THEN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'accounts') THEN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'edit_usage_account_id_fkey'
      ) THEN
        ALTER TABLE edit_usage
          ADD CONSTRAINT edit_usage_account_id_fkey
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;
      END IF;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'edit_usage_account_unique'
    ) THEN
      ALTER TABLE edit_usage
        ADD CONSTRAINT edit_usage_account_unique UNIQUE (account_id);
    END IF;
  END IF;
END;
$$;
