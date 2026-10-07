import { expect, mock, test } from 'claude-code/testing'
import type { ProcessRunResult } from 'claude-code'

const ok = (stdout: string): ProcessRunResult => ({
  exitCode: 0,
  stdout,
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false,
})

const PROPS = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 }, view: {} }

const GIT: Record<string, string> = {
  status: '# branch.oid abc\n# branch.head feat/x\n# branch.ab +0 -0\n? a.ts\n',
  'rev-parse': '/repo/.git\n/repo/.git\n',
  diff: '4\t1\tf.ts\n',
}

test('draws both lines above the prompt on terminal and desktop', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-07T10:00:00Z') })
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', async () => ({ value: '/home/me/repo' }))
  on('session.model', async () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', async () => ({
    value: {
      startedAt: 0,
      context: { tokens: 50_000, window: 200_000, percent: 25 },
      rateLimits: [{ kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-10T10:00:00Z' }],
    },
  }))
  on('process.run', async ($, e) => ({ value: ok(GIT[e.argv[1] ?? ''] ?? '') }))

  await $.session.start({ cwd: '/home/me/repo', surface: 'terminal', isInteractive: true })

  const props = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 }, view: {} }

  const terminal = await $.ui.mount({ plugin: 'rich-statusline', surface: 'terminal', component: 'AbovePrompt', props })
  const texts = (await terminal.findAll({ type: 'Text' })).map(t => t.text)
  for (const group of [' repo ', ' feat/x +8 -2 ?1 ', 'ctx ███▊░░░░░░░░░░░ 25% 50k/200k', '|', '|']) {
    expect(texts).toContain(group)
  }
  expect(texts.some(t => /^7d ████░{6} 40% \( 3d - Sat \d+:00[ap]m \)$/.test(t))).toBe(true)
  await terminal.unmount()

  const desktop = await $.ui.mount({ plugin: 'rich-statusline', surface: 'desktop', component: 'AbovePrompt', props })
  const bars = await desktop.findAll({ type: 'Svg' })
  // Not interactive: an interactive SVG draws in a frame with a white background.
  expect(bars.map(b => [b.props.alt, b.props.width, b.props.isInteractive])).toEqual([
    ['25%', 105, undefined],
    ['40%', 70, undefined],
  ])
  expect(await desktop.find({ type: 'Text', text: 'ctx ' })).toBeDefined()
  await desktop.unmount()
})

test('the model Button opens the model picker in the terminal only', async ($, on) => {
  mock.clock(on, { now: 0 })
  let model = 'claude-opus-5-5'
  const ran: string[] = []
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', async () => ({ value: '/home/me/repo' }))
  on('session.model', async () => ({ value: model }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  on('process.run', async () => ({ value: { exitCode: 128, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.run', async ($, e) => {
    ran.push(`/${e.command}${e.args ? ` ${e.args}` : ''}`)
    model = 'claude-sonnet-5-5'
    return { text: '' }
  })
  await $.session.start({ cwd: '/home/me/repo', surface: 'terminal', isInteractive: true })

  const terminal = await $.ui.mount({ plugin: 'rich-statusline', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  const button = await terminal.find({ type: 'Button', key: 'model' })
  expect(button?.props).toMatchObject({ label: 'Opus 5.5', hotkey: 'm', plain: true })
  await terminal.press({ key: 'model' })
  expect(ran).toEqual(['/model'])
  expect((await terminal.find({ type: 'Button', key: 'model' }))?.props.label).toBe('Sonnet 5.5')
  await terminal.unmount()

  const desktop = await $.ui.mount({ plugin: 'rich-statusline', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await desktop.find({ type: 'Button' })).toBeUndefined()
  expect(await desktop.find({ type: 'Text', text: 'Sonnet 5.5' })).toBeDefined()
  await desktop.unmount()
})
