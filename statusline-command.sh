#!/usr/bin/env bash
# Claude Code status line — directory, git, model, context + rate limits.
# Reads everything from Claude Code's stdin JSON. No API call, no auth tokens.
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

# --- Directory (current dir only) ---
dir_display=""
if [ -n "$cwd" ]; then
    dir_display=$(basename "$cwd")
    dir_display=$(printf '\033[44;97;1m %s \033[0m' "$dir_display")
fi

# --- Git branch + lines added/removed ---
git_part=""
if [ -n "$cwd" ] && git -C "$cwd" rev-parse --git-dir >/dev/null 2>&1; then
    branch=$(git -C "$cwd" symbolic-ref --short HEAD 2>/dev/null || git -C "$cwd" rev-parse --short HEAD 2>/dev/null)
    if [ -n "$branch" ]; then
        diff_stat=$(git -C "$cwd" diff --numstat 2>/dev/null; git -C "$cwd" diff --cached --numstat 2>/dev/null)
        added=0
        removed=0
        if [ -n "$diff_stat" ]; then
            added=$(echo "$diff_stat" | awk '$1 ~ /^[0-9]+$/ {s+=$1} END {print s+0}')
            removed=$(echo "$diff_stat" | awk '$2 ~ /^[0-9]+$/ {s+=$2} END {print s+0}')
        fi

        ahead=0
        behind=0
        if upstream=$(git -C "$cwd" rev-list --left-right --count '@{upstream}...HEAD' 2>/dev/null); then
            behind=$(echo "$upstream" | awk '{print $1+0}')
            ahead=$(echo "$upstream" | awk '{print $2+0}')
        fi

        untracked=$(git -C "$cwd" ls-files --others --exclude-standard 2>/dev/null | awk 'END {print NR+0}')

        branch_label=" $branch"
        [ "$ahead" -gt 0 ] && branch_label="$branch_label ↑${ahead}"
        [ "$behind" -gt 0 ] && branch_label="$branch_label ↓${behind}"
        [ "$added" -gt 0 ] || [ "$removed" -gt 0 ] && branch_label="$branch_label +${added} -${removed}"
        [ "$untracked" -gt 0 ] && branch_label="$branch_label ?${untracked}"
        git_part=$(printf '\033[48;5;208;30;1m%s \033[0m' "$branch_label")
    fi
fi

# --- Model ---
model_part=""
[ -n "$model" ] && model_part=$(printf '\033[2m%s\033[0m' "$model")

# ===== Build dot progress bar =====
# Usage: build_bar <pct> <width> [pace_pct]
# Filled dots color by pace; empty dots color by absolute remaining.
build_bar() {
    local pct=$1 width=$2 pace_pct="${3:-}"

    [ "$pct" -lt 0 ] 2>/dev/null && pct=0
    [ "$pct" -gt 100 ] 2>/dev/null && pct=100

    local filled=$(( pct * width / 100 ))
    local empty=$(( width - filled ))

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

# ===== Pace: how far through the window we are (0-100) =====
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
    awk -v e="$elapsed" -v w="$window_secs" 'BEGIN {printf "%.0f", (e / w) * 100}'
}

# ===== Countdown until reset =====
# <60min  -> "45min"
# <24h    -> "2h 30min" / "3h"
# >=24h   -> "3d 2h" / "6d"
format_reset_countdown() {
    local ts=$1
    [ -z "$ts" ] && return
    local now diff_secs diff_mins
    now=$(date +%s)
    diff_secs=$(( ts - now ))
    [ "$diff_secs" -le 0 ] && echo "now" && return
    diff_mins=$(( (diff_secs + 59) / 60 ))
    if [ "$diff_mins" -lt 60 ]; then
        echo "${diff_mins}min"
    elif [ "$diff_mins" -lt 1440 ]; then
        local h=$(( diff_mins / 60 )) m=$(( diff_mins % 60 ))
        if [ "$m" -eq 0 ]; then echo "${h}h"; else echo "${h}h ${m}min"; fi
    else
        local d=$(( diff_mins / 1440 )) h=$(( (diff_mins % 1440) / 60 ))
        if [ "$h" -eq 0 ]; then echo "${d}d"; else echo "${d}d ${h}h"; fi
    fi
}

# ===== Absolute reset time =====
# <24h  -> "1:10pm"
# >=24h -> "Sun 10:45am"
format_reset_absolute() {
    local ts=$1
    [ -z "$ts" ] && return
    local now diff_secs fmt raw
    now=$(date +%s)
    diff_secs=$(( ts - now ))
    [ "$diff_secs" -le 0 ] && return
    if [ "$diff_secs" -lt 86400 ]; then fmt="%l:%M%p"; else fmt="%a %l:%M%p"; fi
    raw=$(date -r "$ts" "+$fmt" 2>/dev/null || date -d "@$ts" "+$fmt" 2>/dev/null)
    [ -z "$raw" ] && return
    echo "$raw" | sed -e 's/  */ /g' -e 's/^ //' -e 's/AM$/am/' -e 's/PM$/pm/'
}

format_reset_segment() {
    local ts=$1
    [ -z "$ts" ] && return
    local cd abs
    cd=$(format_reset_countdown "$ts")
    abs=$(format_reset_absolute "$ts")
    if [ -n "$cd" ] && [ -n "$abs" ]; then echo "( $cd - $abs )"
    elif [ -n "$cd" ]; then echo "( $cd )"
    elif [ -n "$abs" ]; then echo "( $abs )"
    fi
}

# ===== LINE 1: dir | git branch +N -M | model =====
line1=""
parts=()
[ -n "$dir_display" ] && parts+=("$dir_display")
[ -n "$git_part" ]    && parts+=("$git_part")
[ -n "$model_part" ]  && parts+=("$model_part")
line1="${parts[*]}"

# ===== LINE 2: context window + rate limits (from stdin, no API call) =====
line2=""
sep=" ${dim}|${reset} "

ctx_pct=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
five_pct=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty' | cut -d. -f1)
five_resets=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
seven_pct=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty' | cut -d. -f1)
seven_resets=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')

# Reject anything that isn't a plain non-negative integer before it reaches arithmetic.
[[ "$ctx_pct"     =~ ^[0-9]+$ ]] || ctx_pct=0
[[ "$five_pct"    =~ ^[0-9]+$ ]] || five_pct=""
[[ "$five_resets" =~ ^[0-9]+$ ]] || five_resets=""
[[ "$seven_pct"   =~ ^[0-9]+$ ]] || seven_pct=""
[[ "$seven_resets" =~ ^[0-9]+$ ]] || seven_resets=""

ctx_bar=$(build_bar "$ctx_pct" 15)
line2="${white}context:${reset} ${ctx_bar} ${cyan}${ctx_pct}%${reset}"

if [ -n "$five_pct" ]; then
    five_pace=""
    [ -n "$five_resets" ] && five_pace=$(calc_pace_pct "$five_resets" 18000)
    five_bar=$(build_bar "$five_pct" 10 "$five_pace")
    line2+="${sep}${white}current:${reset} ${five_bar} ${cyan}${five_pct}%${reset}"
    five_seg=$(format_reset_segment "$five_resets")
    [ -n "$five_seg" ] && line2+=" ${dim}${five_seg}${reset}"
fi

if [ -n "$seven_pct" ]; then
    seven_pace=""
    [ -n "$seven_resets" ] && seven_pace=$(calc_pace_pct "$seven_resets" 604800)
    seven_bar=$(build_bar "$seven_pct" 10 "$seven_pace")
    line2+="${sep}${white}weekly:${reset} ${seven_bar} ${cyan}${seven_pct}%${reset}"
    seven_seg=$(format_reset_segment "$seven_resets")
    [ -n "$seven_seg" ] && line2+=" ${dim}${seven_seg}${reset}"
fi

# ===== Output =====
printf "%b" "$line1"
[ -n "$line2" ] && printf "\n%b" "$line2"

exit 0
