import { PageHeading } from '../../app/PageHeading';
import { Button } from '../../ui/Button';
import { useLabAccountCount, useScenarioRunner, LAB_PREFIX } from './hooks';
import { ScenarioResultView } from './ScenarioResultView';
import { SCENARIOS } from './scenarios';

export default function LabPage() {
  const { states, running, run } = useScenarioRunner();
  const count = useLabAccountCount();

  return (
    <>
      <PageHeading title="Failure Lab" />
      <p className="mb-4 max-w-prose text-slate-700 dark:text-slate-300">
        Each scenario tries to break one of ledgerd's promises and shows, request by request, what
        happened and whether it is what the design says should happen.
      </p>

      <div
        role="note"
        className="mb-6 flex max-w-prose flex-col gap-1 rounded-md border-2 border-amber-700 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-300 dark:bg-amber-950 dark:text-amber-50"
      >
        <p className="font-semibold">
          <span aria-hidden="true">! </span>These scenarios write real data
        </p>
        <p>
          They create accounts whose code starts with{' '}
          <code className="font-mono">{LAB_PREFIX}</code> and record transactions in the connected
          ledger. They do not touch other accounts. A ledger is append-only, so lab accounts stay
          once created.
        </p>
        <p aria-live="polite">
          {count.isPending
            ? 'Counting lab accounts…'
            : count.isError
              ? 'The lab accounts could not be counted.'
              : `This ledger has ${count.data.capped ? 'at least ' : ''}${String(count.data.count)} lab ${count.data.count === 1 ? 'account' : 'accounts'}.`}
        </p>
      </div>

      <div className="flex flex-col gap-8">
        {SCENARIOS.map((scenario) => {
          const state = states[scenario.id] ?? { status: 'idle' };
          return (
            <section
              key={scenario.id}
              aria-labelledby={`s-${scenario.id}`}
              className="flex flex-col gap-3"
            >
              <h2 id={`s-${scenario.id}`} className="text-lg font-semibold">
                {scenario.title}
              </h2>
              <p className="max-w-prose">{scenario.summary}</p>
              <div>
                <Button
                  variant="primary"
                  loading={state.status === 'running'}
                  disabled={running && state.status !== 'running'}
                  onClick={() => {
                    void run(scenario);
                  }}
                >
                  {state.status === 'done' ? 'Run again' : 'Run this scenario'}
                </Button>
              </div>
              {state.status === 'done' ? <ScenarioResultView result={state.result} /> : null}
            </section>
          );
        })}
      </div>
    </>
  );
}
