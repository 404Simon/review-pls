#!/bin/sh
set -eu

missing=""

require_env() {
  eval "value=\${$1:-}"
  if [ -z "$value" ]; then
    echo "Missing required environment variable: $1" >&2
    missing="1"
  fi
}

require_env DATABASE_URL
require_env BETTER_AUTH_URL
require_env BETTER_AUTH_SECRET
require_env REGISTRATION_CODE

if [ -n "$missing" ]; then
  echo "Refusing to start." >&2
  exit 1
fi

if [ "${#BETTER_AUTH_SECRET}" -lt 32 ]; then
  echo "BETTER_AUTH_SECRET must be at least 32 characters long." >&2
  echo "Generate one with: openssl rand -base64 48" >&2
  exit 1
fi

database_dir=$(dirname "$DATABASE_URL")

if [ ! -d "$database_dir" ]; then
  echo "Database directory '$database_dir' does not exist." >&2
  echo "Mount it as a volume (for example /data) before starting the container." >&2
  exit 1
fi

if [ ! -w "$database_dir" ]; then
  echo "Database directory '$database_dir' is not writable by uid $(id -u)." >&2
  echo "Fix the host permissions, e.g. sudo chown -R 1000:1000 ./data" >&2
  exit 1
fi

exec node server.js
