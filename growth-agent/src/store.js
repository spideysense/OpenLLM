// Dead-simple JSON-file store so the agent RUNS immediately with zero infra.
// Swap for Supabase/Postgres later by reimplementing this interface — the rest
// of the code only uses get/set/push/all.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
const file = (name) => join(DIR, `${name}.json`);

export function load(name, fallback) {
  try { return JSON.parse(readFileSync(file(name), 'utf8')); } catch { return fallback; }
}
export function save(name, value) {
  writeFileSync(file(name), JSON.stringify(value, null, 2));
  return value;
}
export function push(name, item) {
  const arr = load(name, []);
  const rec = { ...item, _id: item._id || `${name}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, _at: new Date().toISOString() };
  arr.push(rec);
  save(name, arr);
  return rec; // return the record, not the array
}
