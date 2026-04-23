# claude-statusline

A rich statusline for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) that shows your directory, git status, model, and usage limits at a glance.

![preview](assets/statusline-preview.png)

## Features

| Line | Segments |
|------|----------|
| **Line 1** | Directory, git branch with ahead/behind + `+N -M` lines + untracked count, model name |
| **Line 2** | Context window usage bar, 5-hour usage dot bar, 7-day usage dot bar, countdown + absolute reset time |

All data comes from the JSON that Claude Code pipes to the statusline script on stdin. **No API calls, no auth tokens, no caching.**

### Dot colors

Filled dots (●) reflect your **pace** — how fast you're consuming quota relative to time remaining:

| Color | Meaning |
|-------|---------|
| Blue | Under pace (healthy buffer) |
| Green | Within 20% of pace (on track) |
| Yellow | 20-50% above pace (outpacing) |
| Red | 50%+ above pace (significantly outpacing) |

Pace coloring only applies to the 5-hour and 7-day bars. The context bar has no reset window, so its filled dots use the absolute-remaining scale below.

Empty dots (○) reflect **absolute remaining**:

| Color | Meaning |
|-------|---------|
| Dim | Under 50% used |
| Orange | 50-69% used |
| Yellow | 70-89% used |
| Red | 90%+ used |

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
- [`jq`](https://jqlang.github.io/jq/) — JSON processor
- `git` — for branch/diff info (pre-installed on most systems)

## Install

### Quick install

```bash
git clone git@github.com:TheBabaYaga/claude-statusline.git
cd claude-statusline
./install.sh
```

The install script will:
1. Install `jq` if missing (via Homebrew, apt, dnf, or pacman)
2. Copy `statusline-command.sh` to `~/.claude/`
3. Configure `~/.claude/settings.json` with the statusline command

### Manual install

1. Install `jq`:

   ```bash
   # macOS
   brew install jq

   # Debian/Ubuntu
   sudo apt-get install jq

   # Fedora
   sudo dnf install jq

   # Arch
   sudo pacman -S jq
   ```

2. Copy the script:

   ```bash
   cp statusline-command.sh ~/.claude/statusline-command.sh
   chmod +x ~/.claude/statusline-command.sh
   ```

3. Add to `~/.claude/settings.json`:

   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "bash ~/.claude/statusline-command.sh"
     }
   }
   ```

4. Restart Claude Code.

## How it works

Claude Code invokes the statusline script after every response and pipes it a JSON payload on stdin containing the current directory, model, context-window usage, and rate-limit state (percentages and reset epochs for the 5-hour and 7-day windows). The script reads that JSON with `jq`, runs `git` locally for branch stats, and prints a formatted string.

- **No network access.** The script never contacts Anthropic (or anything else).
- **No credentials.** No OAuth token, keychain lookup, or API key is read.
- **Input is validated.** The working directory is rejected unless it's an absolute path, and rate-limit numbers are rejected unless they're plain non-negative integers — so nothing untrusted reaches shell arithmetic.

The `rate_limits` block is only populated for Claude.ai Pro/Max subscribers after the first API response; if it's absent, the 5-hour and 7-day bars are simply omitted.

## License

MIT
