# Bot Office

Unlisted live view of Tuan Muda's Grok Bots. Not linked from the portfolio.

**Live URL:** https://mudagogo2021-beep.github.io/tuanmuda/bot-office/

The page is a static three.js office. It reads `status.json` every 30 seconds. A bot is marked **stuck?** if its `updated` timestamp is older than `stuckAfterMinutes` (default 120). Bots with no `updated` value stay **unknown** and are not flagged stuck.

## Report a status

From this folder, or with a full path to the script:

```bash
python3 update_status.py mudasir working "Bot office page and disk cleanup"
python3 update_status.py "Map Maker" idle "waiting for a new map brief"
python3 update_status.py --list
python3 update_status.py lawyer working "reviewing a contract" --no-push
```

The first form writes `status.json`, commits only that file, and pushes so the live page updates. Use `--no-push` for a local edit.

Do not add this folder to `projects.json`.
