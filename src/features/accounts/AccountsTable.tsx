import { Link } from 'react-router';

import type { Account } from '../../api/schemas';
import { Amount } from '../../ui/Amount';
import { Table, Td, Th } from '../../ui/Table';
import { SIDE_LABELS, TYPE_LABELS } from './rules';

/** The accounts as a table: what each one is, and its balance now. */
export function AccountsTable({ accounts }: { accounts: Account[] }) {
  return (
    <Table caption="Accounts, newest first">
      <thead>
        <tr>
          <Th>Code</Th>
          <Th>Currency</Th>
          <Th>Type</Th>
          <Th>Normal balance</Th>
          <Th>May go negative</Th>
          <Th numeric>Balance</Th>
        </tr>
      </thead>
      <tbody>
        {accounts.map((account) => (
          <tr key={account.id}>
            <Td>
              <Link to={`/accounts/${account.id}`} className="font-mono underline">
                {account.code}
              </Link>
            </Td>
            <Td>{account.currency}</Td>
            <Td>{TYPE_LABELS[account.type]}</Td>
            <Td>{SIDE_LABELS[account.normal_balance]}</Td>
            <Td>{account.allow_negative ? 'Yes' : 'No'}</Td>
            <Td numeric>
              <Amount minor={account.balance} currency={account.currency} />
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
