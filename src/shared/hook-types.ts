export interface ValidationHook {
  name: string
  command: string
  args?: string[]
  cwd?: string
  timeout?: number
  required: boolean
}

export interface HookResult {
  name: string
  success: boolean
  output: string
  duration: number
}

export interface HookPreset {
  name: string
  description: string
  hooks: Record<string, ValidationHook[]>
}

export const HOOK_PRESETS: HookPreset[] = [
  {
    name: 'typescript',
    description: 'TypeScript type checking after implementation',
    hooks: {
      'post.implement': [
        { name: 'TypeScript Check', command: 'npx', args: ['tsc', '--noEmit'], timeout: 30000, required: true }
      ]
    }
  },
  {
    name: 'full-js',
    description: 'TypeScript + ESLint + Tests',
    hooks: {
      'post.implement': [
        { name: 'TypeScript Check', command: 'npx', args: ['tsc', '--noEmit'], timeout: 30000, required: true },
        { name: 'ESLint', command: 'npx', args: ['eslint', 'src/', '--quiet'], timeout: 60000, required: false }
      ],
      'post.code_review': [
        { name: 'Test Suite', command: 'npm', args: ['test'], timeout: 120000, required: true }
      ]
    }
  },
  {
    name: 'python',
    description: 'Python compile check + pytest',
    hooks: {
      'post.implement': [
        { name: 'Python Compile', command: 'python', args: ['-m', 'py_compile'], timeout: 15000, required: true }
      ],
      'post.code_review': [
        { name: 'Pytest', command: 'pytest', args: [], timeout: 120000, required: true }
      ]
    }
  }
]
