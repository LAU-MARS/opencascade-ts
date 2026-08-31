#!/usr/bin/env bash
# Waits for the Docker daemon (Docker Desktop may still be booting), then runs
# the full wasm build, logging everything to etc/docker-build.log.
# Launched detached by the repo owner / CI; see docs/BUILDING.md.

cd "$(dirname "$0")/.." || exit 1
exec > etc/docker-build.log 2>&1

echo "[watch] waiting for docker daemon..."
for _ in $(seq 1 120); do
  if docker info >/dev/null 2>&1; then
    break
  fi
  sleep 10
done

if ! docker info >/dev/null 2>&1; then
  echo "[watch] ERROR: docker daemon never became ready (waited 20 min)"
  exit 1
fi

echo "[watch] daemon ready at $(date)"
echo "[watch] starting OCCT wasm build (first run compiles OCCT: expect 1-2 h)"
bash etc/build-wasm.sh
status=$?
echo "[watch] build finished with status ${status} at $(date)"
exit $status
