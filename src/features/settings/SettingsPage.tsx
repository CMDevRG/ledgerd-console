import { useRef, useState, type SyntheticEvent } from 'react';

import { PageHeading } from '../../app/PageHeading';
import { DEFAULT_SCALES, defaultScale, isValidScale, resolveScale } from '../../money';
import { Button } from '../../ui/Button';
import { Amount } from '../../ui/Amount';
import { Field, Input } from '../../ui/Field';
import { useAnnounce } from '../../ui/LiveRegion';
import { Table, Td, Th } from '../../ui/Table';
import { useSettings } from './SettingsProvider';
import { isCurrencyCode, THEMES, type ThemePreference } from './store';

const THEME_LABELS: Record<ThemePreference, string> = {
  system: 'Match the system',
  light: 'Light',
  dark: 'Dark',
};

/** The scales without one currency's entry. */
const without = (
  scales: Readonly<Record<string, number>>,
  currency: string,
): Record<string, number> =>
  Object.fromEntries(Object.entries(scales).filter(([code]) => code !== currency));

const SCALE_RULE = 'Use a whole number from 0 to 30';

/** The scale a text means, or undefined if it is not a whole number from 0 to 30. */
function parseScale(text: string): number | undefined {
  if (!/^\d{1,2}$/.test(text.trim())) return undefined;
  const scale = Number.parseInt(text, 10);
  return isValidScale(scale) ? scale : undefined;
}

export default function SettingsPage() {
  const [settings, update] = useSettings();

  return (
    <>
      <PageHeading title="Settings" />
      <p className="mb-6 max-w-prose text-slate-700 dark:text-slate-300">
        These settings only change how this console looks in this browser. They never change the
        ledger.
      </p>

      <section aria-labelledby="appearance" className="mb-8">
        <h2 id="appearance" className="mb-2 text-lg font-semibold">
          Appearance
        </h2>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium">Theme</legend>
          {THEMES.map((theme) => (
            <label key={theme} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="theme"
                value={theme}
                checked={settings.theme === theme}
                onChange={() => {
                  update({ theme });
                }}
              />
              {THEME_LABELS[theme]}
            </label>
          ))}
        </fieldset>
      </section>

      <section aria-labelledby="amounts" className="mb-8">
        <h2 id="amounts" className="mb-2 text-lg font-semibold">
          Amounts
        </h2>
        <p className="mb-3 max-w-prose text-sm text-slate-700 dark:text-slate-300">
          ledgerd stores whole minor units (for example cents) and does not know where the decimal
          point goes. The decimal places below are only how this console writes amounts.
        </p>
        <label className="mb-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.rawUnits}
            onChange={(event) => {
              update({ rawUnits: event.target.checked });
            }}
          />
          Show amounts as whole minor units, exactly as ledgerd stores them
        </label>
        <Scales />
      </section>
    </>
  );
}

function Scales() {
  const [settings, update] = useSettings();
  const announce = useAnnounce();
  const currencies = [
    ...new Set([...Object.keys(DEFAULT_SCALES), ...Object.keys(settings.scales)]),
  ].sort();
  const hasOverrides = Object.keys(settings.scales).length > 0;

  const resetAll = (): void => {
    update({ scales: {} });
    announce('Decimal places reset to the defaults');
  };

  return (
    <div className="flex flex-col gap-4">
      <Table caption="Decimal places per currency">
        <thead>
          <tr>
            <Th>Currency</Th>
            <Th>Decimal places</Th>
            <Th>Example</Th>
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {currencies.map((currency) => (
            <ScaleRow key={currency} currency={currency} />
          ))}
        </tbody>
      </Table>
      <div>
        <Button onClick={resetAll} disabled={!hasOverrides}>
          Reset all to the defaults
        </Button>
      </div>
      <AddCurrency existing={currencies} />
    </div>
  );
}

function ScaleRow({ currency }: { currency: string }) {
  const [settings, update] = useSettings();
  const announce = useAnnounce();
  const shown = resolveScale(currency, settings.scales);
  const overridden = currency in settings.scales;
  // The text being typed, while the person is editing; otherwise the saved value is shown.
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const parsed = draft === undefined ? shown : parseScale(draft);
  const error = parsed === undefined ? SCALE_RULE : undefined;

  const commit = (scale: number): void => {
    // A known currency set back to its default needs no override; a custom one keeps its row.
    const next =
      currency in DEFAULT_SCALES && scale === defaultScale(currency)
        ? without(settings.scales, currency)
        : { ...settings.scales, [currency]: scale };
    update({ scales: next });
  };

  // What is typed is saved when the person leaves the field or presses Enter, not on every
  // key: "31" passes through "3", which must not be saved on the way. The example beside the
  // field does follow the typing.
  const save = (): void => {
    if (parsed !== undefined && parsed !== shown) commit(parsed);
  };

  return (
    <tr>
      <Td>
        <span className="font-mono">{currency}</span>
      </Td>
      <Td>
        <Field label={<span className="sr-only">Decimal places for {currency}</span>} error={error}>
          {(control) => (
            <Input
              {...control}
              inputMode="numeric"
              className="w-24"
              value={draft ?? String(shown)}
              onChange={(event) => {
                setDraft(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') save();
              }}
              onBlur={() => {
                save();
                setDraft(undefined);
              }}
            />
          )}
        </Field>
      </Td>
      <Td>
        <Amount minor={123456789n} currency={currency} scale={parsed ?? shown} />
      </Td>
      <Td>
        {overridden && currency in DEFAULT_SCALES ? (
          <Button
            aria-label={`Reset ${currency} to the default`}
            onClick={() => {
              update({ scales: without(settings.scales, currency) });
              setDraft(undefined);
              announce(`${currency} reset to ${String(defaultScale(currency))} decimal places`);
            }}
          >
            Reset
          </Button>
        ) : null}
      </Td>
    </tr>
  );
}

function AddCurrency({ existing }: { existing: string[] }) {
  const [settings, update] = useSettings();
  const announce = useAnnounce();
  const [code, setCode] = useState('');
  const [scaleText, setScaleText] = useState('2');
  const [errors, setErrors] = useState<{ code?: string; scale?: string }>({});
  const codeInput = useRef<HTMLInputElement>(null);
  const scaleInput = useRef<HTMLInputElement>(null);

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    const found: { code?: string; scale?: string } = {};
    if (!isCurrencyCode(code)) found.code = 'Use 2 to 10 capital letters or digits, such as EURC';
    else if (existing.includes(code))
      found.code = `${code} is already in the list; change it there`;
    const scale = parseScale(scaleText);
    if (scale === undefined) found.scale = SCALE_RULE;
    setErrors(found);

    if (found.code !== undefined) codeInput.current?.focus();
    else if (found.scale !== undefined) scaleInput.current?.focus();
    if (scale === undefined || found.code !== undefined) return;

    update({ scales: { ...settings.scales, [code]: scale } });
    announce(`${code} added with ${String(scale)} decimal places`);
    setCode('');
    setScaleText('2');
    codeInput.current?.focus();
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-labelledby="add-currency"
      className="flex flex-col gap-3"
    >
      <h3 id="add-currency" className="font-semibold">
        Add a currency
      </h3>
      <div className="flex flex-wrap items-start gap-3">
        <Field label="Currency code" hint="For example EURC" error={errors.code}>
          {(control) => (
            <Input
              {...control}
              ref={codeInput}
              value={code}
              autoComplete="off"
              spellCheck={false}
              className="w-40 font-mono"
              onChange={(event) => {
                setCode(event.target.value.toUpperCase());
              }}
            />
          )}
        </Field>
        <Field label="Decimal places" hint="0 to 30" error={errors.scale}>
          {(control) => (
            <Input
              {...control}
              ref={scaleInput}
              value={scaleText}
              inputMode="numeric"
              className="w-28"
              onChange={(event) => {
                setScaleText(event.target.value);
              }}
            />
          )}
        </Field>
      </div>
      <div>
        <Button type="submit" variant="primary">
          Add currency
        </Button>
      </div>
    </form>
  );
}
