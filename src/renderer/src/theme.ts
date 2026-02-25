export const colors = {
  bg: '#1a1b26',
  surface: '#24273a',
  elevated: '#2a2d3d',
  border: '#363a4f',
  text: {
    primary: '#cdd6f4',
    secondary: '#a6adc8',
    muted: '#6c7086'
  },
  accent: {
    teal: '#89b4fa',
    gold: '#f9e2af',
    green: '#a6e3a1',
    red: '#f38ba8',
    peach: '#fab387',
    mauve: '#cba6f7'
  },
  tier: { L1: '#a6e3a1', L2: '#89b4fa', L3: '#cba6f7' },
  priority: { low: '#6c7086', medium: '#89b4fa', high: '#fab387', critical: '#f38ba8' },
  status: {
    backlog: '#6c7086', brainstorming: '#cba6f7', design_review: '#f9e2af',
    planning: '#89b4fa', implementing: '#fab387', code_review: '#f9e2af',
    verifying: '#a6e3a1', done: '#a6e3a1', blocked: '#f38ba8'
  }
} as const

export const fonts = {
  ui: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  mono: "'JetBrains Mono', 'Fira Code', monospace"
} as const
