#!/usr/bin/env bash
# Restores a database from a pg_dump custom-format backup produced by
# scripts/backup.sh. The target database must already exist and be empty
# (or --clean-compatible) — this script does not create or drop databases,
# since that decision belongs to whoever is operating the restore.
#
# Usage:
#   DATABASE_URL=postgres://user:pass@host:5432/dbname ./scripts/restore.sh path/to/backup.dump

set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Error: DATABASE_URL is not set." >&2
  exit 1
fi

DUMP_FILE="${1:-}"
if [ -z "$DUMP_FILE" ] || [ ! -f "$DUMP_FILE" ]; then
  echo "Usage: DATABASE_URL=... ./scripts/restore.sh path/to/backup.dump" >&2
  exit 1
fi

DB_NAME=$(basename "${DATABASE_URL%%\?*}")
echo "Restoring $DUMP_FILE into '$DB_NAME' ..."
read -r -p "This will overwrite existing objects in '$DB_NAME'. Continue? [y/N] " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "Aborted."
  exit 1
fi

pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$DATABASE_URL" "$DUMP_FILE"
echo "Restore complete."
