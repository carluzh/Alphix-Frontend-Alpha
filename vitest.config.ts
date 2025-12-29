import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node', // Use node for faster tests, jsdom only when needed
    setupFiles: ['./test/setupTests.ts'],
    include: ['lib/**/*.test.ts', 'lib/**/*.test.tsx'],
    exclude: [
      'node_modules',
      'interface',
      'polar',
      '.next',
      'dist',
    ],
    testTimeout: 30000,
    reporters: ['verbose'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '@liquidity': path.resolve(__dirname, './components/liquidity'),
    },
  },
})
