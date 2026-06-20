#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Demo end-to-end de la API Zentto Web3.
# Requiere: stack levantado (docker compose up) + `jq` instalado.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

BASE="${BASE:-http://localhost:4100/api}"

say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }

wait_job() {
  local job_id="$1"
  for _ in $(seq 1 60); do
    state=$(curl -s "$BASE/mining/jobs/$job_id" | jq -r '.state')
    [ "$state" = "completed" ] && return 0
    [ "$state" = "failed" ] && { echo "Minado falló"; return 1; }
    sleep 0.5
  done
  echo "Timeout esperando el minado"; return 1
}

say "Salud del servicio"
curl -s "$BASE/health" | jq '.status'

say "Creando wallets (minero + Alice + Bob)"
miner=$(curl -s -X POST "$BASE/wallets")
alice=$(curl -s -X POST "$BASE/wallets")
bob=$(curl -s -X POST "$BASE/wallets")
MINER=$(echo "$miner" | jq -r '.address')
MINER_PK=$(echo "$miner" | jq -r '.privateKey')
ALICE=$(echo "$alice" | jq -r '.address')
BOB=$(echo "$bob" | jq -r '.address')
echo "Minero: $MINER"
echo "Alice : $ALICE"
echo "Bob   : $BOB"

say "Minando bloque #1 (recompensa para el minero)"
job=$(curl -s -X POST "$BASE/mining" -H 'Content-Type: application/json' -d "{\"minerAddress\":\"$MINER\"}" | jq -r '.jobId')
wait_job "$job"
curl -s "$BASE/wallets/$MINER/balance" | jq

say "El minero firma y envía 30 a Alice"
signed=$(curl -s -X POST "$BASE/wallets/sign" -H 'Content-Type: application/json' \
  -d "{\"privateKey\":\"$MINER_PK\",\"toAddress\":\"$ALICE\",\"amount\":30,\"fee\":1}")
curl -s -X POST "$BASE/transactions" -H 'Content-Type: application/json' -d "$signed" | jq '{id, status}'

say "Minando bloque #2 (confirma la transferencia)"
job=$(curl -s -X POST "$BASE/mining" -H 'Content-Type: application/json' -d "{\"minerAddress\":\"$MINER\"}" | jq -r '.jobId')
wait_job "$job"

say "Balances finales"
echo "Minero:"; curl -s "$BASE/wallets/$MINER/balance" | jq '.confirmed'
echo "Alice :"; curl -s "$BASE/wallets/$ALICE/balance" | jq '.confirmed'

say "Validando integridad de la cadena"
curl -s "$BASE/chain/validate" | jq '{valid, height}'

say "Screening AML de Alice"
curl -s "$BASE/compliance/screen/$ALICE" | jq '{riskLevel, score, signals}'

say "Informe de cumplimiento (scoring + IA/determinista)"
curl -s -X POST "$BASE/compliance/report" -H 'Content-Type: application/json' \
  -d "{\"address\":\"$ALICE\"}" | jq '{generatedBy: .report.generatedBy, summary: .report.summary}'

say "Grafo cross-chain"
curl -s "$BASE/analytics/graph" | jq '{nodes: (.nodes|length), edges: (.edges|length)}'

say "Demo completada ✅"
