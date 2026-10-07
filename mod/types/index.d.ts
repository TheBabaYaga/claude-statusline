export type Git = {
  branch: string
  isWorktree: boolean
  ahead: number
  behind: number
  added: number
  removed: number
  untracked: number
}

export type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }

export type View = {
  dir: string
  git: Git | null
  model: string
  effort?: string
  context: { tokens?: number; window: number; percent?: number }
  rateLimits: RateLimit[]
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    'rich-statusline': { view: View }
  }
}
