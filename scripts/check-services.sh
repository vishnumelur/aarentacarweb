#!/usr/bin/env bash
# Confirms the local development services are accepting connections.
#
# Probes TCP directly via bash's /dev/tcp rather than pg_isready / redis-cli / curl.
# Those are client tools that a fresh machine will not have, and their absence used to
# be reported as "DOWN" — which sent people debugging a container that was running fine.
# "I cannot reach it" and "the tool to check is missing" are different states.
set -uo pipefail

fail=0

probe() {
  local name=$1 port=$2
  if timeout 2 bash -c "exec 3<>/dev/tcp/localhost/$port" 2>/dev/null; then
    printf '  %-9s OK        (localhost:%s)\n' "$name" "$port"
  else
    printf '  %-9s DOWN      (nothing listening on localhost:%s)\n' "$name" "$port"
    fail=1
  fi
}

echo "Checking local services..."
probe postgres 5432
probe redis    6379
probe minio    9000

if [ "$fail" -ne 0 ]; then
  echo
  echo "Start them with:"
  echo "  docker compose -f docker-compose.dev.yml up -d"
  echo
  echo "If Docker reports a permission error, your shell has not picked up the docker"
  echo "group yet — open a new terminal, or prefix the command with sudo."
  exit 1
fi

echo "All services up."
