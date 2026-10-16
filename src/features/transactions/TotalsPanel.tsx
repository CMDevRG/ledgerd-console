import { Amount } from '../../ui/Amount';
import { Table, Td, Th } from '../../ui/Table';
import { totalsByCurrency, verdict, type BuilderState, type Scales } from './builder';

/**
 * Live totals per currency and a plain statement of whether the transaction balances. The
 * meaning is in words and symbols, not in colour alone.
 */
export function TotalsPanel({ state, settings }: { state: BuilderState; settings: Scales }) {
  const totals = totalsByCurrency(state, settings);
  const status = verdict(state, settings);

  return (
    <section aria-labelledby="totals" className="flex flex-col gap-3">
      <h2 id="totals" className="text-lg font-semibold">
        Totals
      </h2>
      <p className="font-medium">
        {status === 'balanced' ? (
          <>
            <span aria-hidden="true">✓ </span>The transaction balances in every currency.
          </>
        ) : status === 'unbalanced' ? (
          <>
            <span aria-hidden="true">! </span>The transaction does not balance. ledgerd will refuse
            it.
          </>
        ) : (
          'Choose an account and an amount for every posting to see whether it balances.'
        )}
      </p>
      {totals.length === 0 ? null : (
        <Table caption="Totals by currency" hideCaption>
          <thead>
            <tr>
              <Th>Currency</Th>
              <Th numeric>Debits</Th>
              <Th numeric>Credits</Th>
              <Th numeric>Difference</Th>
              <Th>Balanced?</Th>
            </tr>
          </thead>
          <tbody>
            {totals.map((t) => (
              <tr key={t.currency}>
                <Td>{t.currency}</Td>
                <Td numeric>
                  <Amount minor={t.debits} currency={t.currency} />
                </Td>
                <Td numeric>
                  <Amount minor={t.credits} currency={t.currency} />
                </Td>
                <Td numeric>
                  <Amount minor={t.difference} currency={t.currency} />
                </Td>
                <Td>
                  {t.balanced ? (
                    <>
                      <span aria-hidden="true">✓ </span>Balanced
                    </>
                  ) : (
                    <>
                      <span aria-hidden="true">! </span>
                      {t.difference > 0n ? 'Debits exceed credits' : 'Credits exceed debits'}
                    </>
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
