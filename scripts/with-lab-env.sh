#!/usr/bin/env bash
# Run a command with the lab credentials from ~/.config/pve-web/lab.env
# exported (on the test server), e.g.:
#   rt -- scripts/with-lab-env.sh make e2e PORT=8111 SPEC=tests/shell-polish.spec.ts
set -euo pipefail
set -a
# shellcheck disable=SC1090
. "${PVE_LAB_ENV:-$HOME/.config/pve-web/lab.env}"
set +a
exec "$@"
