import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/api/**/*.test.ts'],
    testTimeout: 45000,
    hookTimeout: 45000,
    globals: true,
  },
});
