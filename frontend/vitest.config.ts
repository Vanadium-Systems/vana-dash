import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      sonner: path.resolve(__dirname, 'src/shared/components/ui/toast.tsx'),
      'lucide-react': path.resolve(__dirname, 'src/shared/components/icons/index.ts'),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
  },
})
