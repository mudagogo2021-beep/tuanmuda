#!/usr/bin/env python3
"""Set one bot's status in status.json and push it to the live office page.

Usage:
  python3 update_status.py mudasir working "Bot office page and disk cleanup"
  python3 update_status.py "Map Maker" idle "waiting for a new map brief"
  python3 update_status.py --list
  python3 update_status.py lawyer working "reviewing a contract" --no-push
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
STATUS = ROOT / "status.json"
REL = "bot-office/status.json"
VALID = ("working", "idle", "stuck", "unknown")
TZ = ZoneInfo("America/New_York")
LIVE = "https://mudagogo2021-beep.github.io/tuanmuda/bot-office/"


def now_iso() -> str:
    return datetime.now(TZ).isoformat(timespec="seconds")


def load() -> dict:
    return json.loads(STATUS.read_text(encoding="utf-8"))


def find_bot(data: dict, key: str) -> dict | None:
    needle = key.strip().lower()
    for bot in data.get("bots", []):
        if bot.get("id", "").lower() == needle or bot.get("name", "").lower() == needle:
            return bot
    return None


def list_bots(data: dict) -> None:
    for bot in data.get("bots", []):
        updated = bot.get("updated") or "—"
        print(f"{bot.get('id'):20}  {bot.get('name'):22}  {bot.get('status'):8}  {bot.get('task')}  ({updated})")


def main() -> int:
    p = argparse.ArgumentParser(description="Report a Grok Bot's status to the unlisted office page.")
    p.add_argument("bot", nargs="?", help="Bot id or name, e.g. mudasir or 'Map Maker'")
    p.add_argument("status", nargs="?", choices=VALID, help="working, idle, stuck, or unknown")
    p.add_argument("task", nargs="?", help="Current task. Omit to leave the existing task unchanged.")
    p.add_argument("--list", action="store_true", help="Print every bot and exit")
    p.add_argument("--no-push", action="store_true", help="Write status.json only; do not commit or push")
    p.add_argument("--message", help="Optional git commit message")
    args = p.parse_args()

    data = load()
    if args.list or not args.bot:
        list_bots(data)
        return 0

    if not args.status:
        p.error("status is required unless you pass --list")

    bot = find_bot(data, args.bot)
    if not bot:
        known = ", ".join(f"{b.get('id')} ({b.get('name')})" for b in data.get("bots", []))
        print("Unknown bot: " + args.bot + "\nKnown: " + known, file=sys.stderr)
        return 1

    ts = now_iso()
    bot["status"] = args.status
    if args.task is not None:
        bot["task"] = args.task
    bot["updated"] = ts
    data["updated"] = ts
    STATUS.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Updated {bot['name']}: {bot['status']} - {bot.get('task', '')} @ {ts}")

    if args.no_push:
        return 0

    subprocess.check_call(["git", "add", "--", REL], cwd=REPO)
    staged = subprocess.run(["git", "diff", "--cached", "--quiet", "--", REL], cwd=REPO)
    if staged.returncode == 0:
        print("No git change to commit.")
        return 0
    msg = args.message or f"office: {bot['name']} is {bot['status']}"
    subprocess.check_call(["git", "commit", "-m", msg], cwd=REPO)
    subprocess.check_call(["git", "push"], cwd=REPO)
    print(f"Pushed. Live in about a minute: {LIVE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
