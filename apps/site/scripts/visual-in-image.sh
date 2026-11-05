#!/usr/bin/env bash
# The website's screenshot comparison (scripts/visual-screens.mjs) in the pinned Playwright image
# (SITE_PLAYWRIGHT_IMAGE), where the baselines were recorded: it serves the built site (out/) here
# and runs the browser in the image with this Node on the host network.
# Usage: apps/site/scripts/visual-in-image.sh <evidence dir>. CI and the screenshots workflow run it.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${SITE_PLAYWRIGHT_IMAGE:?set SITE_PLAYWRIGHT_IMAGE to the Playwright image}"
evidence="$(realpath -m "${1:?evidence dir}")"
mkdir -p "$evidence"
test -f out/index.html
python3 -m http.server 4321 --bind 127.0.0.1 --directory out >/dev/null 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT
for _ in $(seq 30); do curl -fsS -o /dev/null http://127.0.0.1:4321/en/ && break; sleep 1; done
node_home="$(dirname "$(dirname "$(node -p process.execPath)")")"
repo="$(cd ../.. && pwd)"
docker run --rm --network host --ipc host \
  -v "$repo:$repo" -v "$evidence:$evidence" -v "$node_home:/opt/node:ro" \
  -w "$PWD" --user "$(id -u):$(id -g)" -e HOME=/tmp -e SITE_UPDATE_SCREENSHOTS \
  "$SITE_PLAYWRIGHT_IMAGE" /opt/node/bin/node scripts/visual-screens.mjs http://127.0.0.1:4321 "$evidence"
