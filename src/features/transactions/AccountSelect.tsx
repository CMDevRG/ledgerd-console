import type { ComponentProps } from 'react';

import { Select } from '../../ui/Field';
import type { AccountRef } from './builder';

interface AccountSelectProps extends Omit<ComponentProps<'select'>, 'value' | 'onChange'> {
  accounts: readonly AccountRef[];
  value: AccountRef | undefined;
  /** Still loading the list: the chosen account, if any, stays selectable. */
  loading?: boolean;
  onAccountChange: (account: AccountRef | undefined) => void;
}

/**
 * A native <select> of accounts, which works with every keyboard and screen reader. The
 * chosen account stays in the list even if a filter hides it, so a posting never loses
 * its account because the list was narrowed.
 */
export function AccountSelect({
  accounts,
  value,
  loading = false,
  onAccountChange,
  ...rest
}: AccountSelectProps) {
  const options =
    value !== undefined && !accounts.some((a) => a.id === value.id)
      ? [value, ...accounts]
      : accounts;

  return (
    <Select
      {...rest}
      value={value?.id ?? ''}
      onChange={(event) => {
        onAccountChange(options.find((a) => a.id === event.target.value));
      }}
    >
      <option value="">{loading ? 'Loading accounts…' : 'Choose an account…'}</option>
      {options.map((account) => (
        <option key={account.id} value={account.id}>
          {account.code} ({account.currency})
        </option>
      ))}
    </Select>
  );
}
