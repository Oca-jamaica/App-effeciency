#!/usr/bin/env bash
# Starts a throwaway Postgres 16 on port 54329 for `npm run db:test` (Linux, Debian packages).
# In CI the workflow uses a Postgres service container instead.
set -euo pipefail
BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
DIR=${PG_DIR:-/var/lib/postgresql/ascend-test}
if [ ! -d "$DIR/data" ]; then
  mkdir -p "$DIR" && chown postgres:postgres "$DIR"
  su postgres -c "$BIN/initdb -D $DIR/data -A trust -U postgres >/dev/null"
fi
su postgres -c "$BIN/pg_ctl -D $DIR/data -o '-p 54329 -k $DIR -c listen_addresses=localhost' -l $DIR/log.txt start" >/dev/null || true
for _ in $(seq 1 20); do pg_isready -h localhost -p 54329 >/dev/null 2>&1 && exit 0; sleep 0.5; done
echo "Postgres did not start; see $DIR/log.txt" >&2; exit 1
