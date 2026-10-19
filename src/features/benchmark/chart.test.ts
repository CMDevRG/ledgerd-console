import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { layoutBars, niceScale } from './chart';

describe('niceScale', () => {
  it.each([
    [274, 300, 50],
    [856, 1000, 200],
    [85, 100, 20],
    [7, 8, 2],
    [0.9, 1, 0.2],
    [1, 1, 0.2],
    [100, 100, 20],
    [101, 120, 20],
  ])('a maximum of %s gets an axis up to %s in steps of %s', (max, top, step) => {
    const scale = niceScale(max);
    expect(scale.max).toBe(top);
    expect(scale.step).toBeCloseTo(step);
  });

  it('starts at zero and goes up in equal steps to the top', () => {
    const { ticks, step, max } = niceScale(274);
    expect(ticks).toEqual([0, 50, 100, 150, 200, 250, 300]);
    expect(ticks.at(-1)).toBe(max);
    expect(step).toBe(50);
  });

  it('still gives a usable axis for nothing to show', () => {
    for (const bad of [0, -5, NaN, Infinity])
      expect(niceScale(bad)).toEqual({ max: 1, step: 1, ticks: [0, 1] });
  });

  it('always reaches the largest value, with few ticks, for any maximum (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.001, max: 1e7, noNaN: true }), (max) => {
        const scale = niceScale(max);
        expect(scale.max).toBeGreaterThanOrEqual(max - 1e-9);
        expect(scale.ticks.length).toBeLessThanOrEqual(8);
        expect(scale.ticks[0]).toBe(0);
        // not absurdly far above the data: at most one step too high
        expect(scale.max - max).toBeLessThan(scale.step + 1e-9);
        for (let i = 1; i < scale.ticks.length; i += 1) {
          expect((scale.ticks[i] ?? 0) - (scale.ticks[i - 1] ?? 0)).toBeCloseTo(scale.step, 6);
        }
      }),
    );
  });
});

const base = { width: 640, height: 320, margin: { top: 20, right: 10, bottom: 40, left: 50 } };

describe('layoutBars', () => {
  const layout = layoutBars({
    ...base,
    categories: 3,
    values: [
      [10, 20, 40],
      [5, null, 30],
    ],
    axisMax: 40,
  });

  it('leaves out a bar for a value that is missing', () => {
    expect(layout.bars).toHaveLength(5);
    expect(layout.bars.some((b) => b.series === 1 && b.category === 1)).toBe(false);
  });

  it('makes the height of a bar proportional to its value, on a common baseline', () => {
    const baseline = layout.plot.y + layout.plot.height;
    for (const bar of layout.bars) {
      expect(bar.y + bar.height).toBeCloseTo(baseline);
      expect(bar.height).toBeCloseTo((bar.value / 40) * layout.plot.height);
    }
    const tallest = layout.bars.find((b) => b.value === 40);
    expect(tallest?.y).toBeCloseTo(layout.plot.y); // the top value reaches the top of the plot
  });

  it('puts each series side by side inside its group, and groups apart', () => {
    const [a, b] = [
      layout.bars.find((x) => x.series === 0 && x.category === 0),
      layout.bars.find((x) => x.series === 1 && x.category === 0),
    ];
    expect(b?.x).toBeCloseTo((a?.x ?? 0) + (a?.width ?? 0));
    const next = layout.bars.find((x) => x.series === 0 && x.category === 1);
    expect(next?.x ?? 0).toBeGreaterThan((b?.x ?? 0) + (b?.width ?? 0));
  });

  it('keeps every bar inside the plot and none overlapping another (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 3 }),
        fc.array(
          fc.array(fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }), {
            minLength: 6,
            maxLength: 6,
          }),
          { minLength: 3, maxLength: 3 },
        ),
        (categories, seriesCount, all) => {
          const values = all.slice(0, seriesCount);
          const l = layoutBars({ ...base, categories, values, axisMax: 100 });
          for (const bar of l.bars) {
            expect(bar.x).toBeGreaterThanOrEqual(l.plot.x - 1e-9);
            expect(bar.x + bar.width).toBeLessThanOrEqual(l.plot.x + l.plot.width + 1e-9);
            expect(bar.y).toBeGreaterThanOrEqual(l.plot.y - 1e-9);
            expect(bar.height).toBeGreaterThanOrEqual(0);
          }
          const sorted = [...l.bars].sort((a, b) => a.x - b.x);
          for (let i = 1; i < sorted.length; i += 1) {
            expect((sorted[i]?.x ?? 0) + 1e-9).toBeGreaterThanOrEqual(
              (sorted[i - 1]?.x ?? 0) + (sorted[i - 1]?.width ?? 0),
            );
          }
        },
      ),
    );
  });

  it('centres a label under each group', () => {
    expect(layout.groupCenters).toHaveLength(3);
    const slot = layout.plot.width / 3;
    expect(layout.groupCenters[1]).toBeCloseTo(layout.plot.x + slot * 1.5);
  });
});
