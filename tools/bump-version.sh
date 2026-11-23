#!/bin/sh
# Rewrites the cache-busting ?v= query on every asset reference in the HTML pages.
# World modules loaded by assets/world-loader.js inherit the loader's own ?v=,
# so this one command versions every file the site loads.
#
#   tools/bump-version.sh            # uses today's date, e.g. 20261123
#   tools/bump-version.sh 20261123b  # explicit version
set -eu
cd "$(dirname "$0")/.."
version="${1:-$(date +%Y%m%d)}"
case "$version" in *[!A-Za-z0-9._-]*|'') echo "invalid version: $version" >&2; exit 1;; esac
for page in index.html planet.html 404.html; do
  sed -i.bak -E "s/(assets\/[A-Za-z0-9._-]+\.(css|js))\?v=[A-Za-z0-9._-]+/\1?v=$version/g" "$page"
  rm -f "$page.bak"
done
echo "asset version → $version"
grep -ho 'assets/[^"]*?v=[^"]*' index.html planet.html 404.html | sort -u
