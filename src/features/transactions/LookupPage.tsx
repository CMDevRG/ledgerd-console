import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { PageHeading } from '../../app/PageHeading';
import { Button } from '../../ui/Button';
import { Field, Input } from '../../ui/Field';
import { UUID } from './ids';

const EXAMPLE = '3f2b8a52-2f8e-4c61-9a4e-0d6f4f0e7c11';

/** Finds a transaction by its id. A malformed id is refused here, before any request. */
export default function LookupPage() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  return (
    <>
      <PageHeading title="Transactions" />
      <p className="mb-6 max-w-prose text-slate-700 dark:text-slate-300">
        Open a transaction to see its postings or to reverse it. You get its id when you record one,
        and in the history of each account.
      </p>
      <form
        noValidate
        className="flex max-w-xl flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const id = text.trim();
          if (!UUID.test(id)) {
            setError(`This is not a transaction id. It looks like ${EXAMPLE}`);
            return;
          }
          setError(undefined);
          void navigate(`/transactions/${id.toLowerCase()}`);
        }}
      >
        <Field label="Transaction id" hint="Paste it here" error={error}>
          {(control) => (
            <Input
              {...control}
              value={text}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              onChange={(event) => {
                setText(event.target.value);
                setError(undefined);
              }}
            />
          )}
        </Field>
        <div>
          <Button type="submit" variant="primary">
            Open transaction
          </Button>
        </div>
      </form>
      <p className="mt-6">
        Or{' '}
        <Link to="/transactions/new" className="underline">
          record a new transaction
        </Link>
        .
      </p>
    </>
  );
}
