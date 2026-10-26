#!/usr/bin/env bash
# Creates the local dev and test databases. The owner is a normal (non-superuser) role, like Supabase's.
set -euo pipefail
sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'folio_owner') THEN
    CREATE ROLE folio_owner LOGIN PASSWORD 'folio_owner' CREATEROLE;
  END IF;
END $$;
SQL
for db in folio folio_test; do
  sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = '$db'" | grep -q 1 \
    || sudo -u postgres createdb -O folio_owner "$db"
done
echo "Local databases ready: folio, folio_test (owner folio_owner)"
