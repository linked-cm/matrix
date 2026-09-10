import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    server: {
      deps: {
        // LINKED primitives ship component CSS beside their ESM. Inline the package so Vite,
        // rather than Node's native loader, transforms those style imports during package tests.
        inline: [/@_linked\/primitives/],
      },
    },
  },
});
