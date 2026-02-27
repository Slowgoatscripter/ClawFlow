import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'
import type { Plugin } from 'vite'

function copySkillDefaults(): Plugin {
  return {
    name: 'copy-skill-defaults',
    apply: 'build',
    closeBundle() {
      const src = path.resolve(__dirname, 'src/skills/defaults')
      const dest = path.resolve(__dirname, 'out/skills/defaults')

      if (!fs.existsSync(src)) return

      function copyDir(from: string, to: string): void {
        fs.mkdirSync(to, { recursive: true })
        for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
          const srcPath = path.join(from, entry.name)
          const destPath = path.join(to, entry.name)
          if (entry.isDirectory()) {
            copyDir(srcPath, destPath)
          } else {
            fs.copyFileSync(srcPath, destPath)
          }
        }
      }

      copyDir(src, dest)
      console.log('[copy-skill-defaults] Copied skill defaults to out/skills/defaults')
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copySkillDefaults()],
    build: {
      rollupOptions: {
        external: ['keytar']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react(), tailwindcss()]
  }
})
