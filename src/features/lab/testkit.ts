import type { IdSource } from './types';

/** Predictable names and keys: `run-1`, `key-1`, `key-2`... */
export function fixedIds(): IdSource {
  let runs = 0;
  let keys = 0;
  return {
    runId: () => {
      runs += 1;
      return `r${String(runs)}`;
    },
    key: () => {
      keys += 1;
      return `key-${String(keys)}`;
    },
  };
}
