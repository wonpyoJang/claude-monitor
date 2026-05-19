#!/usr/bin/env bash
set -euo pipefail

MONITOR_URL="https://claude-monitor-nine.vercel.app"
CLAUDE_DIR="${HOME}/.claude"
SCRIPTS_DIR="${CLAUDE_DIR}/scripts"

echo ""
echo "Claude Code Monitor — 클라이언트 설치"
echo "======================================"
echo ""

# 기본 환경 확인
if [[ ! -d "$CLAUDE_DIR" ]]; then
  echo "❌ ~/.claude 디렉토리가 없습니다. Claude Code가 먼저 설치되어 있어야 합니다."
  exit 1
fi

if ! command -v python3 &>/dev/null; then
  echo "❌ python3 가 필요합니다."
  exit 1
fi

mkdir -p "$SCRIPTS_DIR"

# 입력 받기 (환경변수로 미리 전달하면 프롬프트 생략)
if [[ -z "${INGEST_TOKEN:-}" ]]; then
  echo "INGEST_TOKEN은 $MONITOR_URL/settings 에서 확인하세요."
  printf "INGEST_TOKEN: "
  read -r TOKEN < /dev/tty
else
  TOKEN="$INGEST_TOKEN"
  echo "INGEST_TOKEN: (환경변수에서 읽음)"
fi
if [[ -z "$TOKEN" ]]; then
  echo "❌ 토큰을 입력해주세요."
  exit 1
fi

printf "이 Mac의 이름 (예: work-mac, home-mac) [기본값: $(hostname -s)]: "
read -r ALIAS < /dev/tty
ALIAS="${ALIAS:-$(hostname -s)}"

echo ""

# Step 1: log-turn.py 설치
echo "1/3  log-turn.py 다운로드..."
curl -fsSL "$MONITOR_URL/client/log-turn.py" -o "$SCRIPTS_DIR/log-turn.py"
chmod +x "$SCRIPTS_DIR/log-turn.py"
echo "     ✓ $SCRIPTS_DIR/log-turn.py"

# Step 2: monitor.json 생성
echo "2/3  monitor.json 생성..."
python3 - <<PYEOF
import json, os
from pathlib import Path

p = Path.home() / ".claude" / "monitor.json"
cfg = {
    "url": "$MONITOR_URL",
    "token": "$TOKEN",
    "device": {
        "id": None,
        "alias": "$ALIAS",
        "hostname": None,
        "os": None,
    }
}
p.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n")
PYEOF
echo "     ✓ $CLAUDE_DIR/monitor.json"

# Step 3: settings.json Stop hook 등록
echo "3/3  settings.json Stop hook 등록..."
python3 - <<'PYEOF'
import json, sys
from pathlib import Path

settings_path = Path.home() / ".claude" / "settings.json"
hook_cmd = "~/.claude/scripts/log-turn.py"

cfg = json.loads(settings_path.read_text()) if settings_path.exists() else {}

stop_list = cfg.setdefault("hooks", {}).setdefault("Stop", [])

# 이미 등록돼 있으면 skip
for group in stop_list:
    for h in group.get("hooks", []):
        if hook_cmd in h.get("command", ""):
            print("     ✓ 이미 Stop hook에 등록되어 있습니다.")
            sys.exit(0)

new_hook = {"type": "command", "command": hook_cmd, "timeout": 10}
if stop_list:
    # 기존 첫 번째 그룹에 추가
    stop_list[0].setdefault("hooks", []).append(new_hook)
else:
    stop_list.append({"hooks": [new_hook]})

settings_path.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n")
print("     ✓ settings.json Stop hook 등록 완료")
PYEOF

echo ""
echo "✅ 설치 완료!"
echo ""
echo "이제 Claude Code 세션이 끝날 때마다 자동으로 대시보드에 기록됩니다."
echo "확인: $MONITOR_URL"
echo ""
