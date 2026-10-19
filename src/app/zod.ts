import { z } from 'zod';

/*
 * zod can speed up validation by compiling a validator with `new Function`. The Content Security
 * Policy forbids that (no 'unsafe-eval'): zod would catch the refusal, but the browser reports
 * each refusal as a policy violation. Turning it off keeps the console free of them, at no cost
 * that matters for responses this small.
 */
z.config({ jitless: true });
