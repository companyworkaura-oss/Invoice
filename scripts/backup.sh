#!/usr/bin/env bash
# Backs up the application database using pg_dump's custom format (compressed,
# suitable for pg_restore). Reads connection info from DATABASE_URL — the
# same env var the API itself uses — so this script never hard-codes
# credentials or a host.
#
# Usage:
#   DATABASE_URL=postgres://user:pass@host:5432/dbname ./scripts/backup.sh [output-dir]
#
# Output defaults to ./backups/<dbname>-<UTC timestamp>.dump

set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Error: DATABASE_URL is not set." >&2
  exit 1
fi

OUT_DIR="${1:-backups}"
mkdir -p "$OUT_DIR"

DB_NAME=$(basename "${DATABASE_URL%%\?*}")
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT_FILE="$OUT_DIR/${DB_NAME}-${TIMESTAMP}.dump"

echo "Backing up '$DB_NAME' to $OUT_FILE ..."
pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$OUT_FILE"
echo "Done: $OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))"
