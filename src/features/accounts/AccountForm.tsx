import { useEffect, useRef, useState, type SyntheticEvent } from 'react';

import type { CreateAccountBody } from '../../api/endpoints';
import { ApiError } from '../../api/problem';
import type { Account } from '../../api/schemas';
import { ApiErrorView } from '../../ui/ApiErrorView';
import { Button } from '../../ui/Button';
import { ErrorSummary } from '../../ui/ErrorSummary';
import { Field, Input, Select } from '../../ui/Field';
import { useAnnounce } from '../../ui/LiveRegion';
import { useCreateAccount } from './hooks';
import {
  ACCOUNT_TYPES,
  conventionalSide,
  EMPTY_FORM,
  SIDE_LABELS,
  SIDES,
  TYPE_LABELS,
  serverErrors,
  validateAccountForm,
  validateCode,
  validateCurrency,
  type AccountFormValues,
  type FormErrors,
  type FormField,
} from './rules';

const FIELD_LABELS: Record<FormField, string> = {
  code: 'Code',
  currency: 'Currency',
  type: 'Type',
  normal_balance: 'Normal balance',
  allow_negative: 'Allow negative balance',
};

interface AccountFormProps {
  onCreated: (account: Account) => void;
  /** When this number changes, the cursor goes to the first field (the empty state's button). */
  focusRequest?: number;
}

/** A field with its errors removed. */
const without = (errors: FormErrors, ...fields: FormField[]): FormErrors =>
  Object.fromEntries(
    Object.entries(errors).filter(([field]) => !fields.includes(field as FormField)),
  );

/**
 * The form that creates an account. It checks the input with ledgerd's own rules before
 * sending, shows each error beside its field and all of them in a summary that takes focus,
 * and never throws away what the person typed.
 */
export function AccountForm({ onCreated, focusRequest = 0 }: AccountFormProps) {
  const create = useCreateAccount();
  const announce = useAnnounce();
  const [values, setValues] = useState<AccountFormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [unplaced, setUnplaced] = useState<string[]>([]);
  const [otherError, setOtherError] = useState<unknown>(undefined);
  const [failedSubmits, setFailedSubmits] = useState(0);
  // Once the person picks a side themselves, picking a type no longer changes it.
  const [sideChosen, setSideChosen] = useState(false);
  const lastBody = useRef<CreateAccountBody | undefined>(undefined);

  const codeRef = useRef<HTMLInputElement>(null);
  const currencyRef = useRef<HTMLInputElement>(null);
  const typeRef = useRef<HTMLSelectElement>(null);
  const sideRef = useRef<HTMLSelectElement>(null);
  const negativeRef = useRef<HTMLInputElement>(null);
  const focusField = (field: FormField): void => {
    const target = {
      code: codeRef,
      currency: currencyRef,
      type: typeRef,
      normal_balance: sideRef,
      allow_negative: negativeRef,
    }[field];
    target.current?.focus();
  };

  useEffect(() => {
    if (focusRequest > 0) codeRef.current?.focus();
  }, [focusRequest]);

  /** Edits a field. What was wrong with it, and any failure of the last send, is stale now. */
  const change = (patch: Partial<AccountFormValues>, field: FormField): void => {
    setValues((v) => ({ ...v, ...patch }));
    setErrors((e) => without(e, field));
    setOtherError(undefined);
  };

  const pickType = (type: AccountFormValues['type']): void => {
    setValues((v) => ({
      ...v,
      type,
      normalBalance: sideChosen || type === '' ? v.normalBalance : conventionalSide(type),
    }));
    setErrors((e) => without(e, 'type', ...(sideChosen ? [] : (['normal_balance'] as const))));
    setOtherError(undefined);
  };

  const refuse = (found: FormErrors, rest: string[] = []): void => {
    setErrors(found);
    setUnplaced(rest);
    setFailedSubmits((n) => n + 1);
  };

  const send = (body: CreateAccountBody): void => {
    lastBody.current = body;
    setOtherError(undefined);
    create.mutate(body, {
      onSuccess: ({ data }) => {
        setValues(EMPTY_FORM);
        setErrors({});
        setUnplaced([]);
        setSideChosen(false);
        announce(`Account ${data.code} created`);
        onCreated(data);
      },
      onError: (error) => {
        if (error instanceof ApiError && error.kind === 'refused') {
          const placed = serverErrors(error.fieldErrors, error.code);
          if (Object.keys(placed.errors).length > 0 || placed.unplaced.length > 0) {
            refuse(placed.errors, placed.unplaced);
            return;
          }
        }
        setOtherError(error);
      },
    });
  };

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    const result = validateAccountForm(values);
    if (!result.ok) refuse(result.errors);
    else {
      setUnplaced([]);
      send(result.body);
    }
  };

  const summary = (Object.keys(errors) as FormField[]).map((key) => ({
    key,
    label: FIELD_LABELS[key],
    message: errors[key] ?? '',
  }));
  const suggested = values.type === '' ? undefined : conventionalSide(values.type);
  const typeLabel = values.type === '' ? '' : TYPE_LABELS[values.type].toLowerCase();

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-labelledby="new-account"
      className="flex flex-col gap-4"
    >
      <h2 id="new-account" className="text-lg font-semibold">
        Create an account
      </h2>

      {summary.length > 0 ? (
        <ErrorSummary
          items={summary}
          focusKey={failedSubmits}
          onSelect={(key) => {
            focusField(key as FormField);
          }}
        />
      ) : null}
      {unplaced.length > 0 ? (
        <ul className="list-disc pl-5 text-sm text-red-800 dark:text-red-300">
          {unplaced.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {otherError === undefined ? null : (
        <ApiErrorView
          error={otherError}
          hideFieldErrors
          onRetry={() => {
            if (lastBody.current) send(lastBody.current);
          }}
        />
      )}

      <Field
        label="Code"
        hint="Your name for the account, such as user:42.wallet. Letters, digits, . _ : and -"
        error={errors.code}
        required
      >
        {(control) => (
          <Input
            {...control}
            ref={codeRef}
            value={values.code}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            onChange={(event) => {
              change({ code: event.target.value }, 'code');
            }}
            onBlur={() => {
              // Check a field when the person leaves it, but only once they typed something.
              const problem = values.code === '' ? undefined : validateCode(values.code);
              if (problem !== undefined) setErrors((e) => ({ ...e, code: problem }));
            }}
          />
        )}
      </Field>

      <Field
        label="Currency"
        hint="An asset code such as USD or USDT"
        error={errors.currency}
        required
      >
        {(control) => (
          <Input
            {...control}
            ref={currencyRef}
            value={values.currency}
            autoComplete="off"
            spellCheck={false}
            className="w-40 font-mono"
            onChange={(event) => {
              change({ currency: event.target.value.toUpperCase() }, 'currency');
            }}
            onBlur={() => {
              const problem =
                values.currency === '' ? undefined : validateCurrency(values.currency);
              if (problem !== undefined) setErrors((e) => ({ ...e, currency: problem }));
            }}
          />
        )}
      </Field>

      <Field label="Type" error={errors.type} required>
        {(control) => (
          <Select
            {...control}
            ref={typeRef}
            value={values.type}
            className="w-56"
            onChange={(event) => {
              pickType(event.target.value as AccountFormValues['type']);
            }}
          >
            <option value="">Choose a type…</option>
            {ACCOUNT_TYPES.map((type) => (
              <option key={type} value={type}>
                {TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field
        label="Normal balance"
        hint={
          suggested === undefined
            ? 'The side on which the balance grows. Choose a type first and it is suggested.'
            : `The side on which the balance grows. Conventional for ${typeLabel} accounts: ${SIDE_LABELS[suggested].toLowerCase()}.${
                values.normalBalance !== '' && values.normalBalance !== suggested
                  ? ' You chose the other side, which is allowed but unusual.'
                  : ''
              }`
        }
        error={errors.normal_balance}
        required
      >
        {(control) => (
          <Select
            {...control}
            ref={sideRef}
            value={values.normalBalance}
            className="w-56"
            onChange={(event) => {
              setSideChosen(true);
              change(
                { normalBalance: event.target.value as AccountFormValues['normalBalance'] },
                'normal_balance',
              );
            }}
          >
            <option value="">Choose a side…</option>
            {SIDES.map((side) => (
              <option key={side} value={side}>
                {SIDE_LABELS[side]}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            ref={negativeRef}
            checked={values.allowNegative}
            aria-describedby="allow-negative-hint"
            onChange={(event) => {
              change({ allowNegative: event.target.checked }, 'allow_negative');
            }}
          />
          Allow negative balance
        </label>
        <p id="allow-negative-hint" className="text-sm text-slate-700 dark:text-slate-300">
          Off for most accounts: a transfer that would take the balance below zero is refused.
        </p>
      </div>

      <div>
        <Button type="submit" variant="primary" loading={create.isPending}>
          Create account
        </Button>
      </div>
    </form>
  );
}
