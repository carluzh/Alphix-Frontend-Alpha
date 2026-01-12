import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom', // Use jsdom for React component/hook tests
    setupFiles: ['./test/setupTests.ts'],
    include: ['lib/**/*.test.ts', 'lib/**/*.test.tsx', 'test/**/*.test.ts', 'test/**/*.test.tsx', 'pages/api/**/*.test.ts'],
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
