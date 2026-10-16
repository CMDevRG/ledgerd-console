import { Table, Td, Th } from '../../ui/Table';
import { ExchangeView } from './ExchangeView';
import type { ScenarioResult, Step } from './types';

/**
 * The outcome of a scenario: the verdict first, shown loudly when it is not "as designed", then
 * every step in order with what was sent, what came back, and what was checked.
 */
export function ScenarioResultView({ result }: { result: ScenarioResult }) {
  return (
    <div className="flex flex-col gap-4">
      <Verdict result={result} />
      <ol className="flex flex-col gap-4">
        {result.steps.map((step, index) => (
          <li key={index}>
            <StepView step={step} n={index + 1} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function Verdict({ result }: { result: ScenarioResult }) {
  if (result.verdict === 'as-designed') {
    return (
      <p
        role="status"
        className="rounded-md border-2 border-green-800 bg-green-50 p-3 font-semibold text-green-950 dark:border-green-300 dark:bg-green-950 dark:text-green-50"
      >
        <span aria-hidden="true">✓ </span>Behaved as designed
      </p>
    );
  }
  if (result.verdict === 'unexpected') {
    return (
      <div
        role="alert"
        className="rounded-md border-4 border-red-800 bg-red-50 p-4 text-red-950 dark:border-red-300 dark:bg-red-950 dark:text-red-50"
      >
        <p className="text-lg font-bold">
          <span aria-hidden="true">✗ </span>UNEXPECTED
        </p>
        <p>
          ledgerd did not do what its design promises. The checks marked “Failed” below show where.
        </p>
      </div>
    );
  }
  return (
    <div
      role="alert"
      className="rounded-md border-2 border-amber-700 bg-amber-50 p-3 text-amber-950 dark:border-amber-300 dark:bg-amber-950 dark:text-amber-50"
    >
      <p className="font-semibold">
        <span aria-hidden="true">! </span>Could not run
      </p>
      <p>
        {result.error ?? 'The scenario could not be carried out.'} A scenario that cannot reach the
        ledger proves nothing either way.
      </p>
    </div>
  );
}

function StepView({ step, n }: { step: Step; n: number }) {
  return (
    <section className="flex flex-col gap-2" aria-label={`Step ${String(n)}: ${step.title}`}>
      <h3 className="font-semibold">
        Step {n}: {step.title}
      </h3>
      <p className="max-w-prose text-sm">{step.explanation}</p>
      {step.exchanges.map((exchange, i) => (
        <ExchangeView key={i} exchange={exchange} n={i + 1} />
      ))}
      {step.checks.length === 0 ? null : (
        <Table caption={`Checks of step ${String(n)}`} hideCaption>
          <thead>
            <tr>
              <Th>Check</Th>
              <Th>Expected</Th>
              <Th>Actual</Th>
              <Th>Result</Th>
            </tr>
          </thead>
          <tbody>
            {step.checks.map((c, i) => (
              <tr key={i}>
                <Td>{c.label}</Td>
                <Td>
                  <code className="font-mono">{c.expected}</code>
                </Td>
                <Td>
                  <code className="font-mono">{c.actual}</code>
                </Td>
                <Td>
                  {c.ok ? (
                    <>
                      <span aria-hidden="true">✓ </span>Passed
                    </>
                  ) : (
                    <strong>
                      <span aria-hidden="true">✗ </span>Failed
                    </strong>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}
