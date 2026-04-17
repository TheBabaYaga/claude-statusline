# claude-statusline

A rich statusline for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) that shows your directory, git status, model, and API usage at a glance.

![preview](assets/statusline-preview.png)

## Features

| Line | Segments |
|------|----------|
| **Line 1** | Directory (truncated), git branch with `+N -M` lines changed, model name |
| **Line 2** | 5-hour usage dot bar, 7-day usage dot bar, reset times |

### Dot colors

Filled dots (●) reflect your **pace** — how fast you're consuming quota relative to time remaining:

| Color | Meaning |
|-------|---------|
| Blue | Under pace (healthy buffer) |
| Green | Within 20% of pace (on track) |
| Yellow | 20-50% above pace (outpacing) |
| Red | 50%+ above pace (significantly outpacing) |

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
- `curl` — HTTP client (pre-installed on macOS/Linux)
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

- **Git info**: Runs `git diff --numstat` (unstaged) and `git diff --cached --numstat` (staged) to count lines added/removed.
- **API usage**: Reads your OAuth token from macOS Keychain (or `~/.claude/.credentials.json` on Linux) and calls the Anthropic usage API. Responses are cached to `~/.cache/claude-statusline/` for 5 minutes to avoid rate limiting.
- **Security**: Auth tokens are passed to curl via stdin (not visible in `ps`), cache directory is `chmod 700`, and all external input is validated before use.

## License

MIT
