import { describe, expect, it } from 'vitest';

import { ApiError } from '../../api/problem';
import { check, Run, verdictOf } from './steps';
import type { Exchange, LabApi, Step } from './types';

const exchange = (status = 200): Exchange => ({
  method: 'GET',
  path: '/x',
  requestHeaders: {},
  status,
  responseHeaders: {},
  responseBody: {},
  ms: 1,
});
const okApi: LabApi = { send: () => Promise.resolve(exchange()) };

const step = (...oks: boolean[]): Step => ({
  title: 't',
  explanation: 'e',
  exchanges: [],
  checks: oks.map((ok) => check('c', 'a', ok ? 'a' : 'b')),
});

describe('check', () => {
  it('passes when expected equals actual, unless told otherwise', () => {
    expect(check('l', '201', '201').ok).toBe(true);
    expect(check('l', '201', '422').ok).toBe(false);
    expect(check('l', 'x', 'y', true).ok).toBe(true);
  });
});

describe('verdictOf', () => {
  it('is as-designed only when every check passed', () => {
    expect(verdictOf([step(true, true), step(true)])).toBe('as-designed');
  });

  it('is unexpected as soon as one check fails, wherever it is', () => {
    expect(verdictOf([step(true), step(true, false)])).toBe('unexpected');
    expect(verdictOf([step(false)])).toBe('unexpected');
  });

  it('is unexpected, not as-designed, when nothing was checked: that proves nothing', () => {
    expect(verdictOf([])).toBe('unexpected');
    expect(verdictOf([step()])).toBe('unexpected');
  });

  it('is could-not-run whenever there was a failure, whatever the checks said', () => {
    expect(verdictOf([step(true)], 'no answer')).toBe('could-not-run');
  });
});

describe('Run', () => {
  it('records the exchanges of each step in that step, in order, with its checks', async () => {
    const run = new Run(okApi);
    await run.step('one', 'first', async (ctx) => {
      await ctx.send({ method: 'GET', path: '/a' });
      await ctx.send({ method: 'GET', path: '/b' });
      return [check('c', '1', '1')];
    });
    await run.step('two', 'second', async (ctx) => {
      await ctx.send({ method: 'GET', path: '/c' });
      return [check('d', '1', '1')];
    });
    const result = run.finish('overdraft');
    expect(result.steps.map((s) => [s.title, s.exchanges.length, s.checks.length])).toEqual([
      ['one', 2, 1],
      ['two', 1, 1],
    ]);
    expect(result.verdict).toBe('as-designed');
    expect(result.id).toBe('overdraft');
  });

  it('stops at a request with no answer: could-not-run, the step kept, later steps not run', async () => {
    let calls = 0;
    const api: LabApi = {
      send: () => {
        calls += 1;
        return calls === 2
          ? Promise.reject(new ApiError('network', 'The console could not reach the server.'))
          : Promise.resolve(exchange());
      },
    };
    const run = new Run(api);
    await run.step('one', '', async (ctx) => {
      await ctx.send({ method: 'GET', path: '/a' });
      return [check('c', '1', '1')];
    });
    await run.step('two', '', async (ctx) => {
      await ctx.send({ method: 'GET', path: '/b' });
      return [check('never', '1', '1')];
    });
    await run.step('three', '', () => {
      throw new Error('must not run');
    });
    const result = run.finish('retry');

    expect(result.verdict).toBe('could-not-run');
    expect(result.error).toBe('The console could not reach the server.');
    expect(result.steps.map((s) => s.title)).toEqual(['one', 'two']); // "three" never started
    expect(result.steps[1]?.exchanges).toHaveLength(0);
    expect(result.steps[1]?.checks).toEqual([]);
    expect(calls).toBe(2);
    expect(run.stopped).toBe(true);
  });

  it('also stops on any other error thrown by a step, and says so', async () => {
    const run = new Run(okApi);
    await run.step('boom', '', () => Promise.reject(new TypeError('bad data')));
    const result = run.finish('retry');
    expect(result.verdict).toBe('could-not-run');
    expect(result.error).toBe('bad data');
  });

  it('can be unexpected without any failure: a check that failed', async () => {
    const run = new Run(okApi);
    await run.step('s', '', () => Promise.resolve([check('c', '201', '200')]));
    expect(run.finish('retry').verdict).toBe('unexpected');
  });
});
