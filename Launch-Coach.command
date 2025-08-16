#!/bin/zsh
set -euo pipefail
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$SELF_DIR/server"
VENV="$SERVER_DIR/.venv"
PY="$VENV/bin/python3"
PIP="$VENV/bin/pip"
LOG="$SERVER_DIR/server.log"
PID="$SERVER_DIR/.uvicorn.pid"
HOST=127.0.0.1
PORT=3002

echo "[Coach] Préparation de l'environnement…"
command -v python3 >/dev/null || { echo "[Coach] python3 introuvable"; exit 1; }
[ -x "$PY" ] || python3 -m venv "$VENV"
"$PIP" install --upgrade pip >/dev/null
"$PIP" install -r "$SERVER_DIR/requirements.txt"

# Nettoyage PID éventuel
if [ -f "$PID" ] && ! ps -p "$(cat "$PID" 2>/dev/null)" >/dev/null 2>&1; then
  rm -f "$PID"
fi

cd "$SELF_DIR"
if [ -f "$PID" ] && ps -p "$(cat "$PID" 2>/dev/null)" >/dev/null 2>&1; then
  echo "[Coach] Serveur déjà actif (PID $(cat "$PID"))."
else
  : > "$LOG"
  echo "[Coach] Démarrage du serveur…"
  nohup "$PY" -m uvicorn server.app:app --host "$HOST" --port "$PORT" >>"$LOG" 2>&1 &
  echo $! > "$PID"; sleep 1
fi

echo "[Coach] Ouverture de l'interface…"
open "$SELF_DIR/coach.html"
echo "[Coach] Prêt."
