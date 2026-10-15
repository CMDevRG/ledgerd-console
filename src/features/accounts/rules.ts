import type { CreateAccountBody } from '../../api/endpoints';

/** ledgerd's rules for an account code and an asset code (internal/ledger/types.go). */
export const ACCOUNT_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
export const CURRENCY_PATTERN = /^[A-Z0-9]{2,10}$/;

export type AccountType = CreateAccountBody['type'];
export type Side = CreateAccountBody['normal_balance'];

export const ACCOUNT_TYPES: readonly AccountType[] = [
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'INCOME',
  'EXPENSE',
];
export const SIDES: readonly Side[] = ['DEBIT', 'CREDIT'];

export const TYPE_LABELS: Record<AccountType, string> = {
  ASSET: 'Asset',
  LIABILITY: 'Liability',
  EQUITY: 'Equity',
  INCOME: 'Income',
  EXPENSE: 'Expense',
};
export const SIDE_LABELS: Record<Side, string> = { DEBIT: 'Debit', CREDIT: 'Credit' };

/** The side on which the balance of this kind of account conventionally grows. */
export function conventionalSide(type: AccountType): Side {
  return type === 'ASSET' || type === 'EXPENSE' ? 'DEBIT' : 'CREDIT';
}

/** The form fields, named as the API names them, so server errors line up with them. */
export type FormField = 'code' | 'currency' | 'type' | 'normal_balance' | 'allow_negative';
export const FORM_FIELDS: readonly FormField[] = [
  'code',
  'currency',
  'type',
  'normal_balance',
  'allow_negative',
];
export type FormErrors = Partial<Record<FormField, string>>;

export interface AccountFormValues {
  code: string;
  currency: string;
  type: AccountType | '';
  normalBalance: Side | '';
  allowNegative: boolean;
}

export const EMPTY_FORM: AccountFormValues = {
  code: '',
  currency: '',
  type: '',
  normalBalance: '',
  allowNegative: false,
};

export const CODE_RULE = 'Use 1 to 64 letters, digits, . _ : or -, starting with a letter or digit';
export const CURRENCY_RULE = 'Use 2 to 10 capital letters or digits, such as USD';

export function validateCode(code: string): string | undefined {
  if (code === '') return 'Enter a code';
  return ACCOUNT_CODE_PATTERN.test(code) ? undefined : CODE_RULE;
}

export function validateCurrency(currency: string): string | undefined {
  if (currency === '') return 'Enter a currency';
  return CURRENCY_PATTERN.test(currency) ? undefined : CURRENCY_RULE;
}

export type FormResult = { ok: true; body: CreateAccountBody } | { ok: false; errors: FormErrors };

/** Checks the form with the same rules as ledgerd, so most mistakes never leave the browser. */
export function validateAccountForm(values: AccountFormValues): FormResult {
  const errors: FormErrors = {};
  const code = validateCode(values.code);
  if (code !== undefined) errors.code = code;
  const currency = validateCurrency(values.currency);
  if (currency !== undefined) errors.currency = currency;
  if (values.type === '') errors.type = 'Choose a type';
  if (values.normalBalance === '') errors.normal_balance = 'Choose a side';

  if (Object.keys(errors).length > 0 || values.type === '' || values.normalBalance === '') {
    return { ok: false, errors };
  }
  return {
    ok: true,
    body: {
      code: values.code,
      currency: values.currency,
      type: values.type,
      normal_balance: values.normalBalance,
      allow_negative: values.allowNegative,
    },
  };
}

/** The server's field errors (and the duplicate-code refusal) as form errors. */
export function serverErrors(
  fieldErrors: Readonly<Record<string, string>>,
  code: string | undefined,
): { errors: FormErrors; unplaced: string[] } {
  const errors: FormErrors = {};
  const unplaced: string[] = [];
  for (const [field, message] of Object.entries(fieldErrors)) {
    if ((FORM_FIELDS as readonly string[]).includes(field)) errors[field as FormField] = message;
    else unplaced.push(`${field}: ${message}`);
  }
  if (code === 'account_code_exists') errors.code = 'An account with this code already exists';
  return { errors, unplaced };
}

/** The filters of the list, as they are in the address (`?code=&currency=`). */
export interface AccountFilters {
  code: string;
  currency: string;
}

export type FilterErrors = Partial<Record<keyof AccountFilters, string>>;

export function validateFilters(filters: AccountFilters): FilterErrors {
  const errors: FilterErrors = {};
  // A prefix: any start of a valid code, so the same alphabet, up to 64 characters.
  if (filters.code !== '' && !/^[A-Za-z0-9._:-]{1,64}$/.test(filters.code)) {
    errors.code = 'Use letters, digits, . _ : or - (up to 64)';
  }
  if (filters.currency !== '' && !CURRENCY_PATTERN.test(filters.currency)) {
    errors.currency = CURRENCY_RULE;
  }
  return errors;
}

export function filtersFromParams(params: URLSearchParams): AccountFilters {
  return { code: params.get('code')?.trim() ?? '', currency: params.get('currency')?.trim() ?? '' };
}

export function paramsFromFilters(filters: AccountFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.code !== '') params.set('code', filters.code);
  if (filters.currency !== '') params.set('currency', filters.currency);
  return params;
}

/** Would an account appear in the list under these filters? */
export function matchesFilters(
  account: { code: string; currency: string },
  filters: AccountFilters,
): boolean {
  return (
    account.code.startsWith(filters.code) &&
    (filters.currency === '' || account.currency === filters.currency)
  );
}
