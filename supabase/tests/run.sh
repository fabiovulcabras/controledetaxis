#!/usr/bin/env bash
# Testes das regras do banco. Para cada arquivo de teste: recria o banco, simula o mínimo do Supabase,
# aplica schema.sql e exemplo.sql e roda os cenários. Qualquer "FALHA" ou erro de SQL encerra com erro.
# Conexão pelas variáveis padrão do psql (PGHOST, PGPORT, PGUSER, PGPASSWORD).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
MIG="$DIR/.."
BANCO="${BANCO_TESTE:-taxis_teste}"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)

falhou=0
for teste in "$DIR"/[0-9][0-9]_*.sql; do
  echo "### $(basename "$teste")"
  "${PSQL[@]}" -d postgres -c "drop database if exists $BANCO" -c "create database $BANCO" >/dev/null
  "${PSQL[@]}" -d "$BANCO" -f "$DIR/stub_supabase.sql" >/dev/null
  migracoes=$(cd "$MIG" && ls [0-9][0-9][0-9]_*.sql 2>/dev/null | sort)
  for f in schema.sql $migracoes exemplo.sql; do "${PSQL[@]}" -d "$BANCO" -f "$MIG/$f" >/dev/null || { echo "Erro ao aplicar $f"; exit 1; }; done
  saida="$("${PSQL[@]}" -d "$BANCO" -f "$teste" 2>&1)" || { echo "$saida"; echo "Erro de SQL em $(basename "$teste")"; exit 1; }
  echo "$saida"
  if grep -q "FALHA" <<<"$saida"; then falhou=1; fi
  echo "$(grep -c '  OK' <<<"$saida") ok, $(grep -c 'FALHA' <<<"$saida" || true) falha(s)"
done
"${PSQL[@]}" -d postgres -c "drop database if exists $BANCO" >/dev/null
exit $falhou
