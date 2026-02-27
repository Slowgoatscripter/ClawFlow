export const colors = {
  bg: '#0a0b10',
  surface: '#12131a',
  elevated: '#1a1b26',
  overlay: '#1e1f2e',
  border: '#2a2b3d',
  borderBright: '#3a3b5d',
  text: {
    primary: '#e4e6f0',
    secondary: '#8b8fa3',
    muted: '#4a4d63',
  },
  accent: {
    cyan: '#00e5ff',
    magenta: '#ff2d78',
    amber: '#ffb836',
    green: '#3ddc84',
    violet: '#a78bfa',
    peach: '#ff8a65',
  },
  tier: { L1: '#3ddc84', L2: '#00e5ff', L3: '#a78bfa' },
  priority: { low: '#8b8fa3', medium: '#ffb836', high: '#ff8a65', critical: '#ff2d78' },
  status: {
    backlog: '#4a4d63', brainstorming: '#a78bfa', design_review: '#ffb836',
    planning: '#00e5ff', implementing: '#ff8a65', code_review: '#ffb836',
    verifying: '#3ddc84', done: '#3ddc84', blocked: '#ff2d78',
    paused: '#4a4d63'
  }
} as const

export const fonts = {
  ui: "'Geist', -apple-system, BlinkMacSystemFont, sans-serif",
  mono: "'Geist Mono', 'JetBrains Mono', 'Fira Code', monospace"
} as const
