import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    // Testele de integrare împart aceeași DB — le rulăm secvențial
    fileParallelism: false,
  },
})
