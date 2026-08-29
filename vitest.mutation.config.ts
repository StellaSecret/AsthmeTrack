import { defineConfig } from 'vitest/config';

// Config used by Stryker only. Per-mutant vitest runs intentionally "fail"
// (that is how a mutant is detected as killed), so the default reporter
// produces a misleading "Vitest Test Report" summary/annotation for every
// mutant. A silent reporter keeps the mutation run output clean.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    reporters: ['dot'],
  },
});