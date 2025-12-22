-- Add indexes to keep job and request lookups fast under load.
CREATE INDEX IF NOT EXISTS edit_jobs_status_created_idx
  ON edit_jobs(status, created_at DESC);

CREATE INDEX IF NOT EXISTS edit_jobs_request_created_idx
  ON edit_jobs(edit_request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS edit_requests_account_created_idx
  ON edit_requests(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS edit_requests_status_created_idx
  ON edit_requests(status, created_at DESC);
