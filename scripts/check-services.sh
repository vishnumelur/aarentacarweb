#!/usr/bin/env bash
set -euo pipefail
echo "Checking local services..."
pg_isready -h localhost -p 5432 -U aarental >/dev/null && echo "  postgres  OK" || { echo "  postgres  DOWN"; exit 1; }
redis-cli -h localhost ping >/dev/null && echo "  redis     OK" || { echo "  redis     DOWN"; exit 1; }
curl -sf http://localhost:9000/minio/health/live >/dev/null && echo "  minio     OK" || { echo "  minio     DOWN"; exit 1; }
echo "All services up."
