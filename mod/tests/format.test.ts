import { describe, expect, test } from 'claude-code/testing'

import { barSegs, barSvg, C, clockTime, countdown, modelName, paceOf, parseStatus, row, sumNumstat, tokens } from '../hooks/format'
import type { Item } from '../hooks/format'

const HOUR = 3_600_000

describe('barSegs', () => {
  test('colors a full context bar by cell position', () => {
    expect(barSegs({ pct: 100, width: 10, pace: 'gradient' }).map(s => [s.text, s.color])).toEqual([
      ['████', C.green],
      ['██', C.orange],
      ['██', C.yellow],
      ['██', C.red],
    ])
  })

  test('draws a partial cell in 1/8 steps', () => {
    expect(barSegs({ pct: 49, width: 15, pace: 'gradient' })).toEqual([
      { text: '███████', color: C.green },
      { text: '▍', color: C.orange },
      { text: '░░░░░░░', dim: true },
    ])
  })

  test('colors the fill by pace and the track by usage', () => {
    expect(barSegs({ pct: 30, width: 10, pace: 50 })).toEqual([
      { text: '███', color: C.blue },
      { text: '░░░░░░░', dim: true },
    ])
    expect(barSegs({ pct: 60, width: 10, pace: 30 })).toEqual([
      { text: '██████', color: C.yellow },
      { text: '░░░░', color: C.orange },
    ])
    expect(barSegs({ pct: 40, width: 10, pace: 30 })[0]?.color).toBe(C.green)
  })

  test('clamps out-of-range values', () => {
    expect(barSegs({ pct: 150, width: 4 })).toEqual([{ text: '████', color: C.red }])
    expect(barSegs({ pct: -5, width: 4 })).toEqual([{ text: '░░░░', dim: true }])
  })
})

test('barSvg cuts the gradient bands at the exact percent', () => {
  const svg = barSvg({ pct: 75, width: 10, pace: 'gradient' }, 100, 8)
  expect(svg).toContain(`<rect x="0" width="50" height="8" fill="${C.green}"/>`)
  expect(svg).toContain(`<rect x="50" width="20" height="8" fill="${C.orange}"/>`)
  expect(svg).toContain(`<rect x="70" width="5" height="8" fill="${C.yellow}"/>`)
  expect(svg).not.toContain(C.red)
  expect(svg).toContain(`fill="${C.yellow}" fill-opacity="0.3"`)
})

test('paceOf measures how far through the window we are', () => {
  expect(paceOf(5 * HOUR, 5 * HOUR, 2.5 * HOUR)).toBe(50)
  expect(paceOf(5 * HOUR, 5 * HOUR, -HOUR)).toBe(0)
  expect(paceOf(5 * HOUR, 5 * HOUR, 9 * HOUR)).toBe(100)
})

test('countdown', () => {
  expect(countdown(1000, 2000)).toBe('now')
  expect(countdown(45 * 60_000, 0)).toBe('45min')
  expect(countdown(3 * HOUR, 0)).toBe('3h')
  expect(countdown(2.5 * HOUR, 0)).toBe('2h 30min')
  expect(countdown(74 * HOUR, 0)).toBe('3d 2h')
  expect(countdown(6 * 24 * HOUR, 0)).toBe('6d')
})

test('clockTime adds the weekday after 24h', () => {
  const at = new Date(2026, 9, 11, 13, 5).getTime() // a Sunday
  expect(clockTime(at, at - HOUR)).toBe('1:05pm')
  expect(clockTime(at, at - 48 * HOUR)).toBe('Sun 1:05pm')
  expect(clockTime(at, at + 1)).toBe('')
})

test('tokens', () => {
  expect(tokens(950)).toBe('950')
  expect(tokens(118_400)).toBe('118k')
  expect(tokens(1_000_000)).toBe('1m')
  expect(tokens(1_500_000)).toBe('1.5m')
})

test('parseStatus reads branch, ahead/behind and untracked files', () => {
  const out = '# branch.oid abcdef1234\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 a b f.ts\n? new.ts\n? other.ts\n'
  expect(parseStatus(out)).toEqual({ branch: 'main', ahead: 2, behind: 1, untracked: 2 })
  expect(parseStatus('# branch.oid abcdef1234\n# branch.head (detached)\n').branch).toBe('abcdef1')
})

test('sumNumstat skips binary files', () => {
  expect(sumNumstat('3\t1\ta.ts\n-\t-\timg.png\n10\t0\tb.ts\n')).toEqual({ added: 13, removed: 1 })
})

test('modelName shortens Claude model IDs', () => {
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(modelName('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5')
  expect(modelName('Opus 5.5')).toBe('Opus 5.5')
})

test('row lays out compact groups that wrap between each other', () => {
  const now = Date.parse('2026-10-07T10:00:00Z')
  const groups = row({
    dir: 'repo',
    git: { branch: 'main', isWorktree: true, ahead: 1, behind: 0, added: 5, removed: 2, untracked: 3 },
    model: 'claude-opus-5-5',
    effort: 'high',
    context: { tokens: 118_000, window: 1_000_000, percent: 11.8 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-07T12:30:00Z' },
      { kind: 'spend_limit', percentUsed: 5 },
    ],
    now,
  })
  const text = groups.map(g => g.map(i => ('bar' in i ? barSegs(i.bar).map(s => s.text).join('') : i.text)).join(''))
  expect(text.slice(0, 6)).toEqual([' repo ', ' ⎇ main ↑1 +5 -2 ?3 ', 'Opus 5.5 · high', '|', 'ctx █▊░░░░░░░░░░░░░ 11% 118k/1m', '|'])
  expect(text[6]).toMatch(/^5h ██▍░{7} 23% \( 2h 30min - \d+:30[ap]m \)$/)
  expect(text).toHaveLength(7)
  expect(groups[1]?.[0]).toMatchObject({ bg: C.worktreeBg })
})

test('row shows only the context bar when nothing else is known', () => {
  const groups = row({ dir: '', git: null, model: '', context: { window: 0 }, rateLimits: [], now: 0 })
  expect(groups).toHaveLength(1)
  expect(groups[0]?.[1]).toMatchObject({ bar: { pct: 0 } })
  expect(groups[0]).toHaveLength(3) // no token count before the first response
})
