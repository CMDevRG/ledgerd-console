import { useId } from 'react';

import { Table, Td, Th } from '../../ui/Table';
import { layoutBars, niceScale } from './chart';

export interface BarSeries {
  name: string;
  /** One value per category; null where none was recorded. */
  values: readonly (number | null)[];
}

interface SvgBarChartProps {
  title: string;
  /** What the chart shows, in words, for people who cannot see it. */
  description: string;
  /** The groups along the bottom ("10 virtual users"). */
  categories: readonly string[];
  series: readonly BarSeries[];
  /** The unit of the values ("transfers per second"), shown on the table and the axis. */
  unit: string;
  format?: (value: number) => string;
}

const WIDTH = 640;
const HEIGHT = 320;
const MARGIN = { top: 24, right: 16, bottom: 44, left: 56 };

// Each series is told apart by its fill pattern as well as its colour, so the chart does not
// depend on seeing colour.
const SERIES_CLASS = [
  { solid: 'fill-blue-800 dark:fill-blue-300', hatch: 'stroke-blue-800 dark:stroke-blue-300' },
  {
    solid: 'fill-orange-700 dark:fill-orange-300',
    hatch: 'stroke-orange-700 dark:stroke-orange-300',
  },
] as const;

/**
 * A grouped bar chart drawn as SVG, with its numbers in a table underneath: the chart is a
 * picture of that table, not the only place the numbers are. The picture itself is announced
 * as one image with a title and a description.
 */
export function SvgBarChart({
  title,
  description,
  categories,
  series,
  unit,
  format = (v) => String(Math.round(v)),
}: SvgBarChartProps) {
  const base = useId().replaceAll(':', '_');
  const titleId = `${base}-title`;
  const descId = `${base}-desc`;
  const patternId = (s: number): string => `${base}-hatch-${String(s)}`;

  const top = Math.max(
    0,
    ...series.flatMap((s) => s.values.filter((v): v is number => v !== null)),
  );
  const scale = niceScale(top);
  const layout = layoutBars({
    width: WIDTH,
    height: HEIGHT,
    margin: MARGIN,
    categories: categories.length,
    values: series.map((s) => s.values),
    axisMax: scale.max,
  });

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="font-semibold">{title}</figcaption>

      <ul className="flex flex-wrap gap-4 text-sm" aria-label="Legend">
        {series.map((s, i) => {
          const colour = SERIES_CLASS[i % SERIES_CLASS.length];
          return (
            <li key={s.name} className="flex items-center gap-2">
              <svg width="18" height="18" aria-hidden="true">
                <rect width="18" height="18" className={colour?.solid} />
                {i % 2 === 1 ? (
                  <rect width="18" height="18" fill={`url(#${patternId(i)})`} />
                ) : null}
              </svg>
              {s.name}
            </li>
          );
        })}
      </ul>

      <svg
        role="img"
        aria-labelledby={titleId}
        aria-describedby={descId}
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        className="h-auto w-full max-w-3xl"
      >
        <title id={titleId}>{title}</title>
        <desc id={descId}>{description}</desc>
        <defs>
          {series.map((_, i) =>
            i % 2 === 1 ? (
              <pattern
                key={i}
                id={patternId(i)}
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <line
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="6"
                  strokeWidth="3"
                  className="stroke-white dark:stroke-slate-950"
                />
              </pattern>
            ) : null,
          )}
        </defs>

        {scale.ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={layout.plot.x}
              x2={layout.plot.x + layout.plot.width}
              y1={layout.yOf(tick)}
              y2={layout.yOf(tick)}
              className="stroke-slate-300 dark:stroke-slate-700"
              strokeWidth="1"
            />
            <text
              x={layout.plot.x - 8}
              y={layout.yOf(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="12"
              className="fill-slate-800 dark:fill-slate-200"
            >
              {format(tick)}
            </text>
          </g>
        ))}

        {layout.bars.map((bar) => {
          const colour = SERIES_CLASS[bar.series % SERIES_CLASS.length];
          return (
            <g key={`${String(bar.series)}-${String(bar.category)}`}>
              <rect
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                className={colour?.solid}
              />
              {bar.series % 2 === 1 ? (
                <rect
                  x={bar.x}
                  y={bar.y}
                  width={bar.width}
                  height={bar.height}
                  fill={`url(#${patternId(bar.series)})`}
                />
              ) : null}
              <text
                x={bar.x + bar.width / 2}
                y={bar.y - 4}
                textAnchor="middle"
                fontSize="11"
                className="fill-slate-900 dark:fill-slate-100"
              >
                {format(bar.value)}
              </text>
            </g>
          );
        })}

        {categories.map((category, c) => (
          <text
            key={category}
            x={layout.groupCenters[c]}
            y={layout.plot.y + layout.plot.height + 20}
            textAnchor="middle"
            fontSize="12"
            className="fill-slate-800 dark:fill-slate-200"
          >
            {category}
          </text>
        ))}
        <text x={layout.plot.x} y={14} fontSize="12" className="fill-slate-800 dark:fill-slate-200">
          {unit}
        </text>
      </svg>

      <Table caption={`${title}: the numbers`} hideCaption>
        <thead>
          <tr>
            <Th>{unit}</Th>
            {series.map((s) => (
              <Th key={s.name} numeric>
                {s.name}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map((category, c) => (
            <tr key={category}>
              <Th scope="row">{category}</Th>
              {series.map((s) => (
                <Td key={s.name} numeric>
                  {s.values[c] === null || s.values[c] === undefined
                    ? 'not recorded'
                    : format(s.values[c])}
                </Td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </figure>
  );
}
