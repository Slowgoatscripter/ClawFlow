import { defineConfig } from 'vitest/config'

// Note: better-sqlite3 in this project is compiled for Electron's bundled Node (ABI 143).
// Tests that use db.ts must be run via Electron as the Node runtime, not system Node.
// Use: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron <vitest-path> run
// Or:  pnpm test
export default defineConfig({
  test: {
    environment: 'node'
  }
})
