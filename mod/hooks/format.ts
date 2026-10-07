// Pure layout logic: turns a View into colored segments, one array per line.
// Same rules as statusline-command.sh (v1).
import type { Git, View } from '../types'

// button: the terminal draws this segment as a Button that runs that slash command.
export type Seg = { text: string; color?: string; bg?: string; dim?: boolean; bold?: boolean; button?: 'model' | 'effort' }

export const C = {
  blue: '#0099ff',
  orange: '#ffb055',
  green: '#00a000',
  cyan: '#2e9599',
  red: '#ff5555',
  yellow: '#e6c800',
  white: '#dcdcdc',
  dirBg: '#0087ff',
  branchBg: '#ff8700',
  worktreeBg: '#875fff',
  chipText: '#000000',
  dirText: '#ffffff',
}

const HOUR = 3_600_000
const WINDOWS: Record<string, { label: string; ms: number }> = {
  five_hour: { label: '5h', ms: 5 * HOUR },
  seven_day: { label: '7d', ms: 7 * 24 * HOUR },
}

const byLevel = (pct: number) =>
  pct >= 90 ? C.red : pct >= 70 ? C.yellow : pct >= 50 ? C.orange : undefined

// Joins a segment into the previous one when the style is the same.
function push(segs: Seg[], seg: Seg) {
  const last = segs.at(-1)
  if (last && last.color === seg.color && last.dim === seg.dim && !last.bg && !seg.bg) {
    last.text += seg.text
  } else {
    segs.push({ ...seg })
  }
}

// A progress bar. pace: a number colors the fill by pace delta, 'gradient' by
// position, undefined by overall usage. The track is colored by overall usage.
export type Bar = { pct: number; width: number; pace?: number | 'gradient' }
export type Item = Seg | { bar: Bar }
// sep: a "|" goes before the group when it shares a line with the group before.
export type Group = { items: Item[]; sep?: boolean }

const clamp = (pct: number) => Math.min(100, Math.max(0, pct))
const BANDS: [number, number, string][] = [
  [0, 50, C.green],
  [50, 70, C.orange],
  [70, 90, C.yellow],
  [90, 100, C.red],
]

function fillColor({ pct, pace }: Bar, pos: number): string {
  const p = Math.floor(clamp(pct))
  if (pace === 'gradient') return byLevel(pos) ?? C.green
  if (pace !== undefined) {
    const above = p - pace
    return above < 0 ? C.blue : above <= 20 ? C.green : above <= 50 ? C.yellow : C.red
  }
  return byLevel(p) ?? C.green
}

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

// Terminal: full cells, one partial cell in 1/8 steps, then the track.
export function barSegs(bar: Bar): Seg[] {
  const { width } = bar
  const eighths = Math.round((clamp(bar.pct) * width * 8) / 100)
  const full = Math.floor(eighths / 8)
  const part = EIGHTHS[eighths % 8] ?? ''
  const segs: Seg[] = []
  for (let i = 0; i < full; i++) push(segs, { text: '█', color: fillColor(bar, Math.floor(((i + 1) * 100) / width)) })
  if (part) push(segs, { text: part, color: fillColor(bar, Math.floor(((full + 1) * 100) / width)) })
  const track = byLevel(Math.floor(clamp(bar.pct)))
  const rest = '░'.repeat(width - full - (part ? 1 : 0))
  if (rest) push(segs, track ? { text: rest, color: track } : { text: rest, dim: true })
  return segs
}

// Desktop: an SVG bar with rounded ends, exact to the pixel.
export function barSvg(bar: Bar, w: number, h: number): string {
  const p = clamp(bar.pct)
  const pieces =
    bar.pace === 'gradient'
      ? BANDS.filter(([from]) => from < p).map(([from, to, color]): [number, number, string] => [from, Math.min(to, p), color])
      : [[0, p, fillColor(bar, p)] as [number, number, string]]
  const x = (pct: number) => +((pct * w) / 100).toFixed(2)
  const rects = pieces
    .map(([from, to, color]) => `<rect x="${x(from)}" width="${x(to) - x(from)}" height="${h}" fill="${color}"/>`)
    .join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<clipPath id="r"><rect width="${w}" height="${h}" rx="${h / 2}"/></clipPath>` +
    `<g clip-path="url(#r)"><rect width="${w}" height="${h}" fill="${byLevel(Math.floor(p)) ?? '#808080'}" fill-opacity="0.3"/>${rects}</g></svg>`
  )
}

// How far through the window we are, 0-100.
export function paceOf(resetsAt: number, windowMs: number, now: number): number {
  const elapsed = Math.min(windowMs, Math.max(0, now - (resetsAt - windowMs)))
  return Math.round((elapsed / windowMs) * 100)
}

// "45min", "2h 30min", "3h", "3d 2h", "6d", "now"
export function countdown(resetsAt: number, now: number): string {
  const secs = Math.floor((resetsAt - now) / 1000)
  if (secs <= 0) return 'now'
  const mins = Math.ceil(secs / 60)
  if (mins < 60) return `${mins}min`
  if (mins < 1440) {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return m === 0 ? `${h}h` : `${h}h ${m}min`
  }
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  return h === 0 ? `${d}d` : `${d}d ${h}h`
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// "1:10pm" under 24h, "Sun 10:45am" after. Local time.
export function clockTime(resetsAt: number, now: number): string {
  if (resetsAt <= now) return ''
  const d = new Date(resetsAt)
  const h = d.getHours()
  const time = `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`
  return resetsAt - now < 24 * HOUR ? time : `${DAYS[d.getDay()]} ${time}`
}

// 950 -> "950", 118000 -> "118k", 1000000 -> "1m", 1500000 -> "1.5m"
export function tokens(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000
    return Number.isInteger(v) ? `${v}m` : `${v.toFixed(1)}m`
  }
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return `${n}`
}

// Reads `git status --porcelain=v2 --branch --untracked-files=all`.
export function parseStatus(out: string): Pick<Git, 'branch' | 'ahead' | 'behind' | 'untracked'> {
  let head = ''
  let oid = ''
  let ahead = 0
  let behind = 0
  let untracked = 0
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head ')) head = line.slice(14)
    else if (line.startsWith('# branch.oid ')) oid = line.slice(13)
    else if (line.startsWith('# branch.ab ')) {
      const [a, b] = line.slice(12).split(' ')
      ahead = Math.abs(Number(a)) || 0
      behind = Math.abs(Number(b)) || 0
    } else if (line.startsWith('? ')) untracked++
  }
  const branch = head === '(detached)' ? oid.slice(0, 7) : head
  return { branch, ahead, behind, untracked }
}

// Sums `git diff --numstat` output. Binary files ("-\t-") count as zero.
export function sumNumstat(out: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of out.split('\n')) {
    const [a, r] = line.split('\t')
    added += Number(a) || 0
    removed += Number(r) || 0
  }
  return { added, removed }
}

// More effort, a warmer color. A level this list does not know stays cyan.
const EFFORT_COLORS: Record<string, string> = {
  low: C.blue,
  medium: C.green,
  high: C.yellow,
  xhigh: C.orange,
  max: C.red,
}

export const effortColor = (level: string) => EFFORT_COLORS[level] ?? C.cyan

// "claude-opus-5-5" -> "Opus 5.5". Other names stay as they are.
export function modelName(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)(?:\D|$)/.exec(id)
  if (!m || !m[1]) return id
  return `${m[1][0]?.toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`
}

// The groups of the status line, in order.
export function row(v: View): Group[] {
  const groups: Group[] = []
  if (v.dir) groups.push({ items: [{ text: ` ${v.dir} `, color: C.dirText, bg: C.dirBg, bold: true }] })

  const g = v.git
  if (g && g.branch) {
    let label = g.isWorktree ? ` ⎇ ${g.branch}` : ` ${g.branch}`
    if (g.ahead > 0) label += ` ↑${g.ahead}`
    if (g.behind > 0) label += ` ↓${g.behind}`
    if (g.added > 0 || g.removed > 0) label += ` +${g.added} -${g.removed}`
    if (g.untracked > 0) label += ` ?${g.untracked}`
    groups.push({ items: [{ text: `${label} `, color: C.chipText, bg: g.isWorktree ? C.worktreeBg : C.branchBg, bold: true }] })
  }

  if (v.model) {
    const model: Item[] = [{ text: modelName(v.model), dim: true, button: 'model' }]
    if (v.effort) model.push({ text: ' · ', dim: true }, { text: v.effort, color: effortColor(v.effort), button: 'effort' })
    groups.push({ items: model })
  }

  const ctxPct = Math.floor(v.context.percent ?? 0)
  const { tokens: used, window } = v.context
  const hasTokens = used !== undefined && window > 0
  // tokens / window is finer than the whole-number percent.
  const ctxFill = hasTokens ? (used / window) * 100 : ctxPct
  const context: Item[] = [
    { text: 'ctx ', color: C.white },
    { bar: { pct: ctxFill, width: 15, pace: 'gradient' } },
    { text: ` ${ctxPct}%`, color: C.cyan },
  ]
  if (hasTokens) context.push({ text: ` ${tokens(used)}/${tokens(window)}`, dim: true })
  groups.push({ items: context, sep: groups.length > 0 || undefined })

  for (const limit of v.rateLimits) {
    const win = WINDOWS[limit.kind]
    if (!win) continue
    const pct = Math.floor(limit.percentUsed)
    const resetsAt = limit.resetsAt ? Date.parse(limit.resetsAt) : NaN
    const hasReset = !Number.isNaN(resetsAt)
    const pace = hasReset ? paceOf(resetsAt, win.ms, v.now) : undefined
    const group: Item[] = [
      { text: `${win.label} `, color: C.white },
      { bar: { pct: limit.percentUsed, width: 10, pace } },
      { text: ` ${pct}%`, color: C.cyan },
    ]
    if (hasReset) {
      const parts = [countdown(resetsAt, v.now), clockTime(resetsAt, v.now)].filter(Boolean)
      group.push({ text: ` ( ${parts.join(' - ')} )`, dim: true })
    }
    groups.push({ items: group, sep: true })
  }

  return groups
}

const SEP: Item[] = [{ text: '|', dim: true }]

// Columns a group takes. In the terminal a Button adds its hotkey ("m: "), and a colored one a dot ("● ").
function width(items: Item[], isTerminal: boolean): number {
  let n = 0
  for (const item of items) {
    if ('bar' in item) {
      n += item.bar.width
      continue
    }
    n += [...item.text].length
    if (isTerminal && item.button) n += item.color ? 5 : 3
  }
  return n
}

// Packs the groups into lines of at most `columns`. A "|" goes only between two groups on one line.
export function lines(groups: Group[], columns: number, isTerminal: boolean): Item[][][] {
  const out: Item[][][] = []
  let line: Item[][] = []
  let used = 0
  for (const group of groups) {
    const w = width(group.items, isTerminal)
    const sep = group.sep ? 2 : 0 // the "|" and its gap
    if (line.length && used + 1 + sep + w > columns) {
      out.push(line)
      line = []
      used = 0
    }
    if (line.length) {
      if (group.sep) line.push(SEP)
      used += 1 + sep
    }
    line.push(group.items)
    used += w
  }
  if (line.length) out.push(line)
  return out
}
