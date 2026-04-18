#!/usr/bin/env bash
# Claude Code status line — directory, git, model, API usage with dot progress
set -fo pipefail  # disable globbing, catch pipe failures

input=$(cat)

if [ -z "$input" ]; then
    printf "Claude"
    exit 0
fi

# ANSI colors
blue='\033[38;2;0;153;255m'
orange='\033[38;2;255;176;85m'
green='\033[38;2;0;160;0m'
cyan='\033[38;2;46;149;153m'
red='\033[38;2;255;85;85m'
yellow='\033[38;2;230;200;0m'
white='\033[38;2;220;220;220m'
dim='\033[2m'
reset='\033[0m'

# ===== Extract data from JSON =====
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // empty')
[[ "$cwd" == /* ]] || cwd=""  # reject non-absolute paths (prevents flag injection)
model=$(echo "$input" | jq -r '.model.display_name // empty')

# --- Directory (truncate to last 3 segments) ---
dir_display=""
if [ -n "$cwd" ]; then
    dir_display=$(echo "$cwd" | awk -F'/' '{
        n = split($0, parts, "/")
        if (n <= 3) { print $0 }
        else { print "..." "/" parts[n-2] "/" parts[n-1] "/" parts[n] }
    }')
    dir_display=$(printf '\033[44;97;1m %s \033[0m' "$dir_display")
fi

# --- Git branch + lines added/removed ---
git_part=""
if [ -n "$cwd" ] && git -C "$cwd" rev-parse --git-dir >/dev/null 2>&1; then
    branch=$(git -C "$cwd" symbolic-ref --short HEAD 2>/dev/null || git -C "$cwd" rev-parse --short HEAD 2>/dev/null)
    if [ -n "$branch" ]; then
        # Count lines added/removed (staged + unstaged)
        diff_stat=$(git -C "$cwd" diff --numstat 2>/dev/null; git -C "$cwd" diff --cached --numstat 2>/dev/null)
        added=0
        removed=0
        if [ -n "$diff_stat" ]; then
            added=$(echo "$diff_stat" | awk '$1 ~ /^[0-9]+$/ {s+=$1} END {print s+0}')
            removed=$(echo "$diff_stat" | awk '$2 ~ /^[0-9]+$/ {s+=$2} END {print s+0}')
        fi
        branch_label=" $branch"
        [ "$added" -gt 0 ] || [ "$removed" -gt 0 ] && branch_label="$branch_label +${added} -${removed}"
        git_part=$(printf '\033[48;5;208;30;1m%s \033[0m' "$branch_label")
    fi
fi

# --- Model ---
model_part=""
[ -n "$model" ] && model_part=$(printf '\033[2m%s\033[0m' "$model")

# ===== Build dot progress bar =====
# Usage: build_bar <pct> <width> [pace_pct]
# Filled dots color by pace; empty dots color by absolute remaining
build_bar() {
    local pct=$1 width=$2 pace_pct="${3:-}"

    [ "$pct" -lt 0 ] 2>/dev/null && pct=0
    [ "$pct" -gt 100 ] 2>/dev/null && pct=100

    local filled=$(( pct * width / 100 ))
    local empty=$(( width - filled ))

    # Filled dot color: pace-based
    local filled_color
    if [ -n "$pace_pct" ] && [ "$pace_pct" -ge 0 ] 2>/dev/null; then
        local above_pace=$(( pct - pace_pct ))
        if [ "$above_pace" -lt 0 ]; then
            filled_color="$blue"
        elif [ "$above_pace" -le 20 ]; then
            filled_color="$green"
        elif [ "$above_pace" -le 50 ]; then
            filled_color="$yellow"
        else
            filled_color="$red"
        fi
    else
        if [ "$pct" -ge 90 ]; then filled_color="$red"
        elif [ "$pct" -ge 70 ]; then filled_color="$yellow"
        elif [ "$pct" -ge 50 ]; then filled_color="$orange"
        else filled_color="$green"
        fi
    fi

    # Empty dot color: absolute remaining
    local empty_color
    if [ "$pct" -ge 90 ]; then empty_color="$red"
    elif [ "$pct" -ge 70 ]; then empty_color="$yellow"
    elif [ "$pct" -ge 50 ]; then empty_color="$orange"
    else empty_color="$dim"
    fi

    local filled_str="" empty_str=""
    for ((i=0; i<filled; i++)); do filled_str+="●"; done
    for ((i=0; i<empty; i++)); do empty_str+="○"; done

    printf '%b' "${filled_color}${filled_str}${empty_color}${empty_str}${reset}"
}

# ===== OAuth token from macOS Keychain =====
get_oauth_token() {
    if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
        echo "$CLAUDE_CODE_OAUTH_TOKEN"
        return 0
    fi
    if command -v security >/dev/null 2>&1; then
        local blob
        blob=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null)
        if [ -n "$blob" ]; then
            local token
            token=$(echo "$blob" | jq -r '.claudeAiOauth.accessToken // empty' 2>/dev/null)
            if [ -n "$token" ] && [ "$token" != "null" ]; then
                echo "$token"
                return 0
            fi
        fi
    fi
    local creds_file="${HOME}/.claude/.credentials.json"
    if [ -f "$creds_file" ]; then
        local token
        token=$(jq -r '.claudeAiOauth.accessToken // empty' "$creds_file" 2>/dev/null)
        if [ -n "$token" ] && [ "$token" != "null" ]; then
            echo "$token"
            return 0
        fi
    fi
    echo ""
}

# ===== Calculate pace percentage =====
calc_pace_pct() {
    local resets_epoch=$1 window_secs=$2
    [ -z "$resets_epoch" ] || [ -z "$window_secs" ] && return
    [ "$window_secs" -le 0 ] 2>/dev/null && return
    local now_ts
    now_ts=$(date +%s)
    local window_start=$(( resets_epoch - window_secs ))
    local elapsed=$(( now_ts - window_start ))
    [ "$elapsed" -lt 0 ] && elapsed=0
    [ "$elapsed" -gt "$window_secs" ] && elapsed="$window_secs"
    awk -v elapsed="$elapsed" -v window="$window_secs" 'BEGIN {printf "%.0f", (elapsed / window) * 100}'
}

# ===== ISO to epoch (cross-platform) =====
iso_to_epoch() {
    local iso_str="$1"
    # Validate input contains only expected ISO 8601 characters
    [[ "$iso_str" =~ ^[0-9T:Z.+\ -]+$ ]] || return 1
    local epoch
    epoch=$(date -d "${iso_str}" +%s 2>/dev/null)
    if [ -n "$epoch" ]; then echo "$epoch"; return 0; fi
    local stripped="${iso_str%%.*}"
    stripped="${stripped%%Z}"
    stripped="${stripped%%+*}"
    stripped="${stripped%%-[0-9][0-9]:[0-9][0-9]}"
    if [[ "$iso_str" == *"Z"* ]] || [[ "$iso_str" == *"+00:00"* ]]; then
        epoch=$(env TZ=UTC date -j -f "%Y-%m-%dT%H:%M:%S" "$stripped" +%s 2>/dev/null)
    else
        epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$stripped" +%s 2>/dev/null)
    fi
    [ -n "$epoch" ] && echo "$epoch" && return 0
    return 1
}

# ===== Format reset time =====
format_reset_time() {
    local iso_str="$1"
    [ -z "$iso_str" ] || [ "$iso_str" = "null" ] && return
    local epoch
    epoch=$(iso_to_epoch "$iso_str")
    [ -z "$epoch" ] && return
    local result
    result=$(date -j -r "$epoch" +"%l:%M%p" 2>/dev/null)
    if [ -n "$result" ]; then
        echo "$result" | sed 's/^ //' | tr '[:upper:]' '[:lower:]'
    else
        date -d "@$epoch" +"%l:%M%P" 2>/dev/null | sed 's/^ //'
    fi
}

# ===== API Usage (cached) =====
# Use a user-private cache directory to avoid symlink attacks in /tmp
cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/claude-statusline"
mkdir -p "$cache_dir"
chmod 700 "$cache_dir"
cache_file="$cache_dir/usage-cache.json"
cache_max_age=300

is_valid_usage() {
    [ -n "$1" ] && echo "$1" | jq -e '.five_hour' >/dev/null 2>&1
}

needs_refresh=true
usage_data=""

if [ -f "$cache_file" ]; then
    cached=$(cat "$cache_file" 2>/dev/null)
    if is_valid_usage "$cached"; then
        usage_data="$cached"
        cache_mtime=$(stat -f %m "$cache_file" 2>/dev/null || stat -c %Y "$cache_file" 2>/dev/null)
        now=$(date +%s)
        cache_age=$(( now - cache_mtime ))
        [ "$cache_age" -lt "$cache_max_age" ] && needs_refresh=false
    fi
fi

if $needs_refresh; then
    token=$(get_oauth_token)
    if [ -n "$token" ] && [ "$token" != "null" ]; then
        # Pass auth header via stdin to avoid token exposure in process list
        response=$(curl -s --max-time 5 \
            -H "Accept: application/json" \
            -H "Content-Type: application/json" \
            -H @- \
            -H "anthropic-beta: oauth-2025-04-20" \
            -H "User-Agent: claude-code/2.1.69" \
            "https://api.anthropic.com/api/oauth/usage" <<< "Authorization: Bearer $token" 2>/dev/null)
        if is_valid_usage "$response"; then
            usage_data="$response"
            install -m 600 /dev/null "$cache_file" 2>/dev/null
            echo "$response" > "$cache_file"
        fi
    fi
fi

# ===== LINE 1: dir | git branch +N -M | model =====
line1=""
parts=()
[ -n "$dir_display" ] && parts+=("$dir_display")
[ -n "$git_part" ]    && parts+=("$git_part")
[ -n "$model_part" ]  && parts+=("$model_part")
line1="${parts[*]}"

# ===== LINE 2: context window + usage bars =====
line2=""
sep=" ${dim}|${reset} "

# Context window usage (from stdin JSON)
ctx_pct=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
ctx_bar=$(build_bar "$ctx_pct" 15)
line2="${white}context:${reset} ${ctx_bar} ${cyan}${ctx_pct}%${reset}"

if [ -n "$usage_data" ] && echo "$usage_data" | jq -e . >/dev/null 2>&1; then
    bar_width=10

    # 5-hour (current)
    five_pct=$(echo "$usage_data" | jq -r '.five_hour.utilization // 0' | awk '{printf "%.0f", $1}')
    five_reset_iso=$(echo "$usage_data" | jq -r '.five_hour.resets_at // empty')
    five_reset_epoch=""
    [ -n "$five_reset_iso" ] && five_reset_epoch=$(iso_to_epoch "$five_reset_iso")
    five_pace=""
    [ -n "$five_reset_epoch" ] && five_pace=$(calc_pace_pct "$five_reset_epoch" 18000)
    five_bar=$(build_bar "$five_pct" "$bar_width" "$five_pace")
    five_reset_display=""
    [ -n "$five_reset_iso" ] && five_reset_display=$(format_reset_time "$five_reset_iso")

    # 7-day (weekly)
    seven_pct=$(echo "$usage_data" | jq -r '.seven_day.utilization // 0' | awk '{printf "%.0f", $1}')
    seven_reset_iso=$(echo "$usage_data" | jq -r '.seven_day.resets_at // empty')
    seven_reset_epoch=""
    [ -n "$seven_reset_iso" ] && seven_reset_epoch=$(iso_to_epoch "$seven_reset_iso")
    seven_pace=""
    [ -n "$seven_reset_epoch" ] && seven_pace=$(calc_pace_pct "$seven_reset_epoch" 604800)
    seven_bar=$(build_bar "$seven_pct" "$bar_width" "$seven_pace")

    line2+="${sep}${white}current:${reset} ${five_bar} ${cyan}${five_pct}%${reset}"
    [ -n "$five_reset_display" ] && line2+=" ${dim}resets ${five_reset_display}${reset}"
    line2+="${sep}${white}weekly:${reset} ${seven_bar} ${cyan}${seven_pct}%${reset}"
fi

# ===== Output =====
printf "%b" "$line1"
[ -n "$line2" ] && printf "\n%b" "$line2"

exit 0
