/** Round, readable axis for values from 0 to `max`: a top value and the ticks up to it. */
export interface Scale {
  max: number;
  step: number;
  ticks: number[];
}

/**
 * The smallest axis, of a step like 1, 2, 2.5, 5 or 10 times a power of ten, that has at most
 * `maxTicks` intervals and reaches `max`. A max of 0 (nothing to show) still gets a usable axis.
 */
export function niceScale(max: number, maxTicks = 6): Scale {
  if (!(max > 0) || !Number.isFinite(max)) return { max: 1, step: 1, ticks: [0, 1] };
  const rough = max / maxTicks;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? 10 * power;
  const top = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let i = 0; i <= Math.round(top / step); i += 1)
    ticks.push(Number((i * step).toPrecision(12)));
  return { max: Number(top.toPrecision(12)), step, ticks };
}

export interface Bar {
  category: number;
  series: number;
  value: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Layout {
  /** The drawing area, inside the margins. */
  plot: { x: number; y: number; width: number; height: number };
  bars: Bar[];
  /** The x of the middle of each group, for its label. */
  groupCenters: number[];
  /** The y of a value on the axis. */
  yOf: (value: number) => number;
}

export interface LayoutInput {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
  categories: number;
  /** values[series][category], null where there is none. */
  values: readonly (readonly (number | null)[])[];
  axisMax: number;
  /** Space between groups, as a fraction of a group's slot (0 to 1). */
  groupGap?: number;
}

/** Where each bar goes. A missing value gets no bar. Pure, so it can be tested. */
export function layoutBars(input: LayoutInput): Layout {
  const { width, height, margin, categories, values, axisMax } = input;
  const plot = {
    x: margin.left,
    y: margin.top,
    width: width - margin.left - margin.right,
    height: height - margin.top - margin.bottom,
  };
  const slot = plot.width / Math.max(categories, 1);
  const gap = (input.groupGap ?? 0.3) * slot;
  const seriesCount = Math.max(values.length, 1);
  const barWidth = (slot - gap) / seriesCount;
  const yOf = (value: number): number => plot.y + plot.height - (value / axisMax) * plot.height;

  const bars: Bar[] = [];
  values.forEach((series, s) => {
    series.forEach((value, c) => {
      if (value === null || c >= categories) return;
      const y = yOf(value);
      bars.push({
        category: c,
        series: s,
        value,
        x: plot.x + c * slot + gap / 2 + s * barWidth,
        y,
        width: barWidth,
        height: plot.y + plot.height - y,
      });
    });
  });
  return {
    plot,
    bars,
    groupCenters: Array.from({ length: categories }, (_, c) => plot.x + c * slot + slot / 2),
    yOf,
  };
}
