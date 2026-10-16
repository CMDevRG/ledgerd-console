import type { Scenario } from '../types';
import { overdraft } from './overdraft';

/** The scenarios the Lab offers, in the order they are shown. */
export const SCENARIOS: readonly Scenario[] = [overdraft];
