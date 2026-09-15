import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test, expect } from 'vitest';
test('household enrollment and recovery enforce their boundaries over actual HTTP', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['scripts/verify-enrollment.cjs'], { timeout: 45000 });
  expect(stdout).toContain('Enrollment integration passed');
}, 50000);
