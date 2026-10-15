import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectNoAccessibilityViolations } from '../test/axe';
import { Field, Input, Select } from './Field';

describe('Field', () => {
  it('has no accessibility violations: plain, with hint, with error, required', async () => {
    const { container } = render(
      <form>
        <Field label="Code">{(c) => <Input {...c} />}</Field>
        <Field label="Name" hint="Shown in lists">
          {(c) => <Input {...c} />}
        </Field>
        <Field label="Currency" error="Use 2 to 10 capital letters" required>
          {(c) => <Input {...c} />}
        </Field>
        <Field label="Kind">
          {(c) => (
            <Select {...c}>
              <option>asset</option>
              <option>liability</option>
            </Select>
          )}
        </Field>
      </form>,
    );
    await expectNoAccessibilityViolations(container);
  });

  it('ties the label to the control, so clicking or reading the label reaches it', async () => {
    render(<Field label="Account code">{(c) => <Input {...c} />}</Field>);
    const input = screen.getByLabelText('Account code');
    expect(input.tagName).toBe('INPUT');
    await userEvent.setup().click(screen.getByText('Account code'));
    expect(input).toHaveFocus();
  });

  it('describes the control with its hint and its error, in words', () => {
    render(
      <Field label="Amount" hint="Digits and a dot" error="Too many decimals">
        {(c) => <Input {...c} />}
      </Field>,
    );
    const input = screen.getByLabelText('Amount');
    expect(input).toHaveAccessibleDescription('Digits and a dot Error: Too many decimals');
    expect(input).toBeInvalid();
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('is valid, and has no description, when there is neither hint nor error', () => {
    render(<Field label="Amount">{(c) => <Input {...c} />}</Field>);
    const input = screen.getByLabelText('Amount');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  it('says that a field is required, in words and to the browser', () => {
    render(
      <Field label="Currency" required>
        {(c) => <Input {...c} />}
      </Field>,
    );
    expect(screen.getByLabelText(/Currency/)).toBeRequired();
    expect(screen.getByText('(required)')).toBeInTheDocument();
  });

  it('gives two fields different ids', () => {
    render(
      <>
        <Field label="A">{(c) => <Input {...c} />}</Field>
        <Field label="B">{(c) => <Input {...c} />}</Field>
      </>,
    );
    expect(screen.getByLabelText('A').id).not.toBe(screen.getByLabelText('B').id);
  });

  it('can be filled in with the keyboard alone', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Field label="Code">{(c) => <Input {...c} />}</Field>
        <Field label="Name">{(c) => <Input {...c} />}</Field>
      </>,
    );
    await user.tab();
    await user.keyboard('assets:cash');
    await user.tab();
    await user.keyboard('Cash');
    expect(screen.getByLabelText('Code')).toHaveValue('assets:cash');
    expect(screen.getByLabelText('Name')).toHaveValue('Cash');
  });
});
