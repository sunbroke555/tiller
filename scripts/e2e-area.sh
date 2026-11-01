#!/usr/bin/env bash
# Print the e2e spec files of a feature area, for `make e2e-area AREA=<id>`.
# Area ids are those of docs/feature-map.json (plus spec names like shell-polish):
#
#   scripts/e2e-area.sh lxc-config        → tests/lxc-config.spec.ts
#   scripts/e2e-area.sh guest-lifecycle   → tests/guest-core.spec.ts
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
area=${1:-}
[[ -n $area ]] || { echo "用法: $0 <area id>（见 docs/feature-map.json）" >&2; exit 2; }

case $area in
  guest-summary-power | guest-lifecycle) specs=(guest-core) ;;
  guest-snapshots-backup) specs=(guest-backup) ;;
  backup-jobs) specs=(backup-jobs) ;;
  auth | app-shell | overview) specs=(shell-polish shells permissions smoke) ;;
  node-system) specs=(node-system) ;; # writes go to pvelab-c3: needs lab-cluster.env
  *) specs=("$area") ;;
esac

out=()
for s in "${specs[@]}"; do
  f=tests/$s.spec.ts
  [[ -f $ROOT/e2e/$f ]] || { echo "e2e-area: 没有 e2e/${f}（area id 见 docs/feature-map.json）" >&2; exit 2; }
  out+=("$f")
done
echo "${out[*]}"
