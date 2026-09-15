// @vitest-environment node
import { it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
it('runs the household service and vault security contracts against actual HTTP and encrypted disk storage', async () => {
  const result = await promisify(execFile)(process.execPath, ['scripts/verify-household.cjs'], { timeout: 25000, maxBuffer: 1024 * 1024 });
  expect(result.stdout).toContain('Household integration passed');
}, 30000);
