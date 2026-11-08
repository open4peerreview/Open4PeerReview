import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'features/ai-chat/__tests__/**/*.test.ts',
      'lib/__tests__/**/*.test.ts',
      'app/api/snapshot/__tests__/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
