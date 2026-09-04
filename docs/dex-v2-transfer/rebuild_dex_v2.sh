#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
EXPECTED="38446cb5738cec000682adaf63db1ca881db1eee0ad47cc755d3d2302579829f"

cat chunks/part_*.b64 | tr -d '\n' | base64 -d > Dex_v2.zip
ACTUAL="$(sha256sum Dex_v2.zip | awk '{print $1}')"

if [[ "$ACTUAL" != "$EXPECTED" ]]; then
  echo "ERRO: SHA-256 incorreto"
  echo "Esperado: $EXPECTED"
  echo "Obtido:   $ACTUAL"
  exit 1
fi

echo "SHA-256 OK: $ACTUAL"
rm -rf Dex
unzip -q Dex_v2.zip
echo "Pronto: $(pwd)/Dex/Claude"
