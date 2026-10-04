import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@content': resolve(import.meta.dirname, 'content/avalanche'),
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  define: {
    __DEBUG_TOOLS__: 'false',
    __STUDIO__: 'false',
    __TEST_API__: 'false',
    __BUILD_LABEL__: '""',
    __SDK_PATH__: '"/sdk.js"',
    __CONTENT_PACK__: '"avalanche"',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
