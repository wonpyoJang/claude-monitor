#!/usr/bin/env python3
# Stop hook: append per-turn token/cost/efficiency metrics to ~/.claude/logs/sessions.jsonl
# Reads hook payload from stdin (session_id, transcript_path, cwd).
# Parses the transcript JSONL, locates the current turn (since last real user prompt),
# aggregates usage, computes cost/efficiency, optionally extracts an impact marker.

import json
import os
import platform
import re
import shlex
import socket
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

LOG_PATH = Path.home() / ".claude" / "logs" / "sessions.jsonl"
MONITOR_CONFIG = Path.home() / ".claude" / "monitor.json"
SCRIPT_PATH = Path(__file__).resolve()

CLIENT_VERSION = "1.0.0"

# USD per 1M tokens. Edit if prices change.
# Long-context (>200K input) doubles input/cache pricing for Opus 4.7 1M.
PRICING = {
    "claude-opus-4-7":   {"input": 15.0, "output": 75.0, "cache_5m": 18.75, "cache_1h": 30.0, "cache_read": 1.50},
    "claude-opus-4-6":   {"input": 15.0, "output": 75.0, "cache_5m": 18.75, "cache_1h": 30.0, "cache_read": 1.50},
    "claude-sonnet-4-6": {"input":  3.0, "output": 15.0, "cache_5m":  3.75, "cache_1h":  6.0, "cache_read": 0.30},
    "claude-haiku-4-5":  {"input":  1.0, "output":  5.0, "cache_5m":  1.25, "cache_1h":  2.0, "cache_read": 0.10},
    "_default":          {"input": 15.0, "output": 75.0, "cache_5m": 18.75, "cache_1h": 30.0, "cache_read": 1.50},
}
LONG_CTX_THRESHOLD = 200_000
LONG_CTX_MULTIPLIER = 2.0

# Accepts either hidden <!--turn-impact:3/5 note--> or visible 〔턴 임팩트: 3/5 — note〕
IMPACT_PATTERNS = [
    re.compile(r"<!--\s*turn-impact\s*[:=]\s*(\d+)\s*/\s*5\s*(?:[—\-–:]\s*([^>\n]*?))?\s*-->", re.IGNORECASE),
    re.compile(r"〔\s*턴\s*임팩트\s*:\s*(\d+)\s*/\s*5\s*(?:[—\-–:]\s*([^〕\n]*))?\s*〕"),
]


def normalize_model(model_id: str) -> str:
    if not model_id:
        return "_default"
    m = re.match(r"(claude-[a-z]+-\d+-\d+)", model_id)
    return m.group(1) if m else "_default"


def price_for(model_id: str) -> dict:
    return PRICING.get(normalize_model(model_id), PRICING["_default"])


def compute_cost(usage: dict, model_id: str) -> float:
    p = price_for(model_id)
    input_t = usage.get("input_tokens", 0) or 0
    output_t = usage.get("output_tokens", 0) or 0
    cache_read = usage.get("cache_read_input_tokens", 0) or 0
    cache_total = usage.get("cache_creation_input_tokens", 0) or 0

    cc = usage.get("cache_creation") or {}
    cache_5m = cc.get("ephemeral_5m_input_tokens", 0) or 0
    cache_1h = cc.get("ephemeral_1h_input_tokens", 0) or 0
    # Fallback: if sub-breakdown missing, treat all as 5m.
    if cache_5m + cache_1h == 0 and cache_total > 0:
        cache_5m = cache_total

    total_input_side = input_t + cache_read + cache_5m + cache_1h
    multiplier = LONG_CTX_MULTIPLIER if total_input_side > LONG_CTX_THRESHOLD else 1.0

    cost = (
        input_t * p["input"]
        + output_t * p["output"]  # output not multiplied by long-ctx in current Anthropic pricing
        + cache_5m * p["cache_5m"]
        + cache_1h * p["cache_1h"]
        + cache_read * p["cache_read"]
    ) / 1_000_000
    # Apply long-ctx multiplier to input-side only
    if multiplier != 1.0:
        cost = (
            input_t * p["input"] * multiplier
            + output_t * p["output"]
            + cache_5m * p["cache_5m"] * multiplier
            + cache_1h * p["cache_1h"] * multiplier
            + cache_read * p["cache_read"] * multiplier
        ) / 1_000_000
    return cost


def is_real_user_prompt(m: dict) -> bool:
    if m.get("type") != "user":
        return False
    if m.get("isMeta"):
        return False
    msg = m.get("message") or {}
    content = msg.get("content")
    if isinstance(content, str):
        return True
    if isinstance(content, list):
        # If every block is tool_result, it's not a real prompt
        for b in content:
            if isinstance(b, dict) and b.get("type") != "tool_result":
                return True
        return False
    return False


def extract_impact(text: str):
    if not text:
        return None, None
    for pat in IMPACT_PATTERNS:
        m = pat.search(text)
        if m:
            try:
                score = int(m.group(1))
            except Exception:
                continue
            note = (m.group(2) or "").strip() or None
            return score, note
    return None, None


def auto_impact(tool_calls: int, edit_calls: int, cost_usd: float, output_tokens: int):
    # Heuristic fallback when no manual marker. Score 5 reserved for manual only.
    if tool_calls == 0 and output_tokens < 500:
        score = 1
    elif edit_calls >= 3 and cost_usd >= 5.0:
        score = 4
    elif edit_calls >= 1 or tool_calls >= 4:
        score = 3
    elif tool_calls <= 3 and edit_calls == 0:
        score = 2
    else:
        score = 2
    note = f"auto: tools={tool_calls} edits={edit_calls} cost=${cost_usd:.2f} out={output_tokens}"
    return score, note


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0

    transcript_path = payload.get("transcript_path") or ""
    session_id = payload.get("session_id") or ""
    cwd = payload.get("cwd") or ""
    if not transcript_path or not os.path.exists(transcript_path):
        return 0

    messages = []
    try:
        with open(transcript_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    messages.append(json.loads(line))
                except Exception:
                    pass
    except Exception:
        return 0

    # session_duration_s: first message timestamp → now
    session_duration_s = None
    first_ts_str = messages[0].get("timestamp") if messages else None
    if first_ts_str:
        try:
            first_ts = datetime.fromisoformat(first_ts_str.replace("Z", "+00:00"))
            session_duration_s = int((datetime.now(timezone.utc) - first_ts).total_seconds())
        except Exception:
            pass

    last_user_idx = -1
    for i in range(len(messages) - 1, -1, -1):
        if is_real_user_prompt(messages[i]):
            last_user_idx = i
            break
    if last_user_idx == -1:
        return 0

    turn_msgs = messages[last_user_idx + 1:]

    totals = {"input_tokens": 0, "output_tokens": 0,
              "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}
    cost = 0.0
    model_seen = None
    tool_calls = 0
    edit_calls = 0
    agent_spawned = 0
    error_count = 0
    tool_names = {}
    file_exts: dict = {}
    last_text = ""

    for m in turn_msgs:
        # error count from tool_result blocks in user messages
        if m.get("type") == "user":
            for block in (m.get("message", {}).get("content") or []):
                if isinstance(block, dict) and block.get("type") == "tool_result":
                    if block.get("is_error"):
                        error_count += 1
            continue

        if m.get("type") != "assistant":
            continue
        msg = m.get("message") or {}
        model_seen = msg.get("model", model_seen)
        usage = msg.get("usage") or {}
        for k in totals:
            totals[k] += usage.get(k, 0) or 0
        cost += compute_cost(usage, msg.get("model") or "")

        for block in (msg.get("content") or []):
            if not isinstance(block, dict):
                continue
            btype = block.get("type")
            if btype == "tool_use":
                tool_calls += 1
                name = block.get("name") or "?"
                tool_names[name] = tool_names.get(name, 0) + 1
                if name in ("Edit", "Write", "NotebookEdit", "MultiEdit"):
                    edit_calls += 1
                    fp = (block.get("input") or {}).get("file_path", "")
                    ext = Path(fp).suffix.lower() if fp else ""
                    if ext:
                        file_exts[ext] = file_exts.get(ext, 0) + 1
                elif name == "Agent":
                    agent_spawned += 1
            elif btype == "text":
                t = block.get("text") or ""
                if t:
                    last_text = t

    input_side = (totals["input_tokens"]
                  + totals["cache_creation_input_tokens"]
                  + totals["cache_read_input_tokens"])
    cache_hit_rate = (totals["cache_read_input_tokens"] / input_side) if input_side else 0.0
    output_input_ratio = (totals["output_tokens"] / input_side) if input_side else 0.0
    tokens_per_dollar = (input_side + totals["output_tokens"]) / cost if cost > 0 else 0.0

    impact_score, impact_note = extract_impact(last_text)
    if impact_score is not None:
        impact_source = "manual"
    else:
        impact_score, impact_note = auto_impact(
            tool_calls, edit_calls, cost, totals["output_tokens"]
        )
        impact_source = "auto"

    entry = {
        "ts": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "session_id": session_id,
        "cwd": cwd,
        "model": normalize_model(model_seen or ""),
        "tokens": totals,
        "input_side_total": input_side,
        "cost_usd": round(cost, 6),
        "tool_calls": tool_calls,
        "edit_calls": edit_calls,
        "agent_spawned": agent_spawned,
        "error_count": error_count,
        "file_exts": file_exts or None,
        "session_duration_s": session_duration_s,
        "tool_breakdown": tool_names,
        "cache_hit_rate": round(cache_hit_rate, 4),
        "output_input_ratio": round(output_input_ratio, 4),
        "tokens_per_dollar": round(tokens_per_dollar, 1),
        "impact_score": impact_score,
        "impact_source": impact_source,
        "impact_note": impact_note,
    }

    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass

    send_to_monitor(entry)
    return 0


def load_monitor_config():
    try:
        with open(MONITOR_CONFIG, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def ensure_device(cfg):
    device = cfg.get("device") or {}
    changed = False
    if not device.get("id"):
        device["id"] = str(uuid.uuid4())
        changed = True
    if not device.get("hostname"):
        device["hostname"] = socket.gethostname()
        changed = True
    if not device.get("os"):
        device["os"] = f"{platform.system()} {platform.release()}"
        changed = True
    cfg["device"] = device
    if changed:
        try:
            with open(MONITOR_CONFIG, "w", encoding="utf-8") as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)
        except OSError:
            pass
    return cfg


def check_update(url: str) -> None:
    """Check server version; silently self-replace if newer."""
    try:
        import urllib.request
        version_url = url.rstrip("/") + "/api/client/version"
        with urllib.request.urlopen(version_url, timeout=5) as resp:
            data = json.loads(resp.read().decode())
        server_version = data.get("version", "")
        if not server_version or server_version == CLIENT_VERSION:
            return
        # Download new script
        new_url = url.rstrip("/") + "/client/log-turn.py"
        fd, tmp = tempfile.mkstemp(prefix="log-turn-update-", suffix=".py")
        try:
            with urllib.request.urlopen(new_url, timeout=10) as resp:
                content = resp.read()
            with os.fdopen(fd, "wb") as f:
                f.write(content)
            # Atomic replace
            os.chmod(tmp, 0o755)
            os.replace(tmp, str(SCRIPT_PATH))
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
    except Exception:
        pass


def send_to_monitor(entry):
    cfg = load_monitor_config()
    if not cfg:
        return
    url = cfg.get("url")
    token = cfg.get("token")
    if not url or not token:
        return
    cfg = ensure_device(cfg)
    device = cfg["device"]
    check_update(url)
    tokens = entry.get("tokens") or {}
    payload = {
        "device": {
            "id": device.get("id"),
            "alias": device.get("alias"),
            "hostname": device.get("hostname"),
            "os": device.get("os"),
            "client_version": CLIENT_VERSION,
        },
        "session_id": entry.get("session_id"),
        "cwd": entry.get("cwd"),
        "ts": entry.get("ts"),
        "model": entry.get("model"),
        "tokens_input": tokens.get("input_tokens"),
        "tokens_output": tokens.get("output_tokens"),
        "tokens_cache_read": tokens.get("cache_read_input_tokens"),
        "tokens_cache_creation": tokens.get("cache_creation_input_tokens"),
        "cost_usd": entry.get("cost_usd"),
        "tool_calls": entry.get("tool_calls"),
        "edit_calls": entry.get("edit_calls"),
        "cache_hit_rate": entry.get("cache_hit_rate"),
        "impact_score": entry.get("impact_score"),
        "impact_source": entry.get("impact_source"),
        "impact_note": entry.get("impact_note"),
        "session_duration_s": entry.get("session_duration_s"),
        "file_exts": entry.get("file_exts"),
        "error_count": entry.get("error_count"),
        "agent_spawned": entry.get("agent_spawned"),
    }
    try:
        fd, tmpfile = tempfile.mkstemp(prefix="cc-monitor-", suffix=".json")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        endpoint = url.rstrip("/") + "/api/turns"
        cmd = (
            f"trap 'rm -f {shlex.quote(tmpfile)}' EXIT; "
            f"curl -sS -X POST "
            f"-H {shlex.quote('Authorization: Bearer ' + token)} "
            f"-H 'Content-Type: application/json' "
            f"--data-binary @{shlex.quote(tmpfile)} "
            f"--max-time 10 {shlex.quote(endpoint)} "
            f">/dev/null 2>&1"
        )
        subprocess.Popen(
            ["bash", "-c", cmd],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
            close_fds=True,
        )
    except Exception:
        pass


if __name__ == "__main__":
    sys.exit(main() or 0)
