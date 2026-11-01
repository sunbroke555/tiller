#!/usr/bin/env bash
# Regenerate the PNG / ICO app icons from the SVG sources (run on the test
# server: rt -- scripts/gen-icons.sh). Needs rsvg-convert (librsvg) and
# ImageMagick.
#   web/public/favicon.svg   rounded tile: favicon, pwa-*.png
#   web/icons/maskable.svg   full bleed:   maskable-icon, apple-touch-icon
set -euo pipefail
cd "$(dirname "$0")/../web"
out=public
tile=public/favicon.svg
bleed=icons/maskable.svg

for s in 64 192 512; do rsvg-convert -w $s -h $s "$tile" -o "$out/pwa-${s}x${s}.png"; done
rsvg-convert -w 512 -h 512 "$bleed" -o "$out/maskable-icon-512x512.png"
rsvg-convert -w 180 -h 180 "$bleed" -o "$out/apple-touch-icon-180x180.png"

tmp=$(mktemp -d)
for s in 16 32 48; do rsvg-convert -w $s -h $s "$tile" -o "$tmp/$s.png"; done
magick "$tmp/16.png" "$tmp/32.png" "$tmp/48.png" "$out/favicon.ico"
rm -rf "$tmp"
ls -l "$out"/*.png "$out"/favicon.ico
