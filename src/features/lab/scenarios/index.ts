import type { Scenario } from '../types';
import { concurrency } from './concurrency';
import { doubleReversal } from './doubleReversal';
import { keyReuse } from './keyReuse';
import { numberAmount } from './numberAmount';
import { overdraft } from './overdraft';
import { precision } from './precision';
import { retry } from './retry';
import { unbalanced } from './unbalanced';

/** The scenarios the Lab offers, in the order they are shown. */
export const SCENARIOS: readonly Scenario[] = [
  overdraft,
  retry,
  keyReuse,
  unbalanced,
  numberAmount,
  precision,
  doubleReversal,
  concurrency,
];
