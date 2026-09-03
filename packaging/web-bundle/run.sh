#!/bin/sh
# InfraKit Studio — self-hosted web bundle.
#
# The backend binary serves BOTH the app UI and its API on one port — the
# same binary the desktop build uses as a sidecar, run standalone here with
# --static-dir. No separate web server needed.
#
#   ./run.sh                       # http://127.0.0.1:8080, this machine only
#   INFRAKIT_ADDR=0.0.0.0:8080 ./run.sh --tls auto     # expose on the LAN
#
# First start prints a  SETUP-TOKEN <...>  line — open the URL and paste it
# to create the admin account.
set -e
cd "$(dirname "$0")"

ADDR="${INFRAKIT_ADDR:-127.0.0.1:8080}"
DATA="${INFRAKIT_DATA_DIR:-./data}"

echo "InfraKit Studio  →  http://$ADDR"
echo "Data directory:  $DATA   (back this up)"
echo

exec ./infrakit-backend \
  --addr "$ADDR" \
  --auth on \
  --static-dir ./web \
  --data-dir "$DATA" \
  "$@"
