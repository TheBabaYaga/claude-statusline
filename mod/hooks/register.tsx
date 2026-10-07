import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Git, View } from '../types'
import { barSegs, barSvg, parseStatus, row, sumNumstat } from './format'
import type { Item, Seg } from './format'

const EMPTY: View = { dir: '', git: null, model: '', context: { window: 0 }, rateLimits: [], now: 0 }
const view = atom({ plugin: 'rich-statusline', key: 'view' } as const, EMPTY)

async function readGit($: EngineInterface, cwd: string): Promise<Git | null> {
  const git = (...args: string[]) => $.process.run(['git', ...args], { cwd })
  try {
    const [status, dirs, unstaged, staged] = await Promise.all([
      git('status', '--porcelain=v2', '--branch', '--untracked-files=all'),
      git('rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'),
      git('diff', '--numstat'),
      git('diff', '--cached', '--numstat'),
    ])
    if (status.exitCode !== 0) return null
    const [gitDir, commonDir] = dirs.stdout.trim().split('\n')
    const a = sumNumstat(unstaged.stdout)
    const b = sumNumstat(staged.stdout)
    return {
      ...parseStatus(status.stdout),
      isWorktree: dirs.exitCode === 0 && gitDir !== commonDir,
      added: a.added + b.added,
      removed: a.removed + b.removed,
    }
  } catch {
    return null // git is not installed, or it timed out
  }
}

async function refresh($: EngineInterface) {
  const [cwd, model, usage, now] = await Promise.all([
    $.session.cwd(),
    $.session.model(),
    $.session.usage(),
    $.clock.now(),
  ])
  const git = await readGit($, cwd)
  const { tokens, window, percent } = usage.context
  await update($, view, v => ({
    ...v,
    dir: cwd.split('/').filter(Boolean).at(-1) ?? cwd,
    git,
    model,
    context: { tokens, window, percent },
    rateLimits: usage.rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })),
    now,
  }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    // Keeps the reset countdowns and the git chip current between turns.
    $.clock.every(30_000, () => void refresh($))
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await refresh($)
    return result
  })

  // /model has no change event: read the model again once the command ends.
  on('command.run', { command: 'model' }, async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    return result
  })

  on('session.measure', async ($, e, next) => {
    const now = await $.clock.now()
    const { tokens, window, percent } = e.context
    await update($, view, v => ({
      ...v,
      context: { tokens, window, percent },
      rateLimits: e.rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })),
      now,
    }))
    return next(e)
  })

  // The effort level is only known per model request.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const effort = e.effort === undefined ? undefined : String(e.effort)
      await update($, view, v => (v.effort === effort ? v : { ...v, effort }))
    }
    return yield* next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const v = await read($, view)
    if (!v.dir) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const seg = (s: Seg) => (
      <Text color={s.color} backgroundColor={s.bg} dimColor={s.dim} bold={s.bold}>
        {s.text}
      </Text>
    )
    // Desktop draws each bar as an SVG. The terminal draws it as block characters.
    const Svg = e.surface === 'desktop' ? $.ui.resolve(e).Svg : undefined
    const group = (items: Item[]) =>
      Svg ? (
        <Box flexDirection="row" alignItems="center">
          {items.map(item =>
            'bar' in item ? (
              <Svg
                source={barSvg(item.bar, item.bar.width * 7, 8)}
                alt={`${Math.floor(item.bar.pct)}%`}
                width={item.bar.width * 7}
                height={8}
              />
            ) : (
              seg(item)
            ),
          )}
        </Box>
      ) : items.some(item => 'button' in item && item.button) ? (
        // The model name opens the built-in model picker.
        <Box flexDirection="row">
          {items.map(item =>
            'bar' in item ? null : item.button ? (
              <Button
                key={item.button}
                label={item.text}
                hotkey="m"
                plain
                dimColor
                onPress={async () => {
                  // A plugin's own call skips its command.run hook, so refresh here.
                  await $.command.run({ command: 'model' })
                  await refresh($)
                }}
              />
            ) : (
              seg(item)
            ),
          )}
        </Box>
      ) : (
        <Text wrap="truncate">{items.flatMap(item => ('bar' in item ? barSegs(item.bar) : [item])).map(seg)}</Text>
      )

    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {row(v).map(group)}
      </Box>
    )
  })
}
