import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectNoAccessibilityViolations } from '../test/axe';
import { Button } from './Button';

describe('Button', () => {
  it('has no accessibility violations in any variant or state', async () => {
    const { container } = render(
      <div>
        <Button>Plain</Button>
        <Button variant="primary">Save</Button>
        <Button variant="danger">Delete</Button>
        <Button disabled>Off</Button>
        <Button loading>Saving</Button>
      </div>,
    );
    await expectNoAccessibilityViolations(container);
  });

  it('is a plain button unless told otherwise, so it never submits a form by accident', () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute('type', 'button');
  });

  it('is operated with the keyboard: Enter and Space', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>Go</Button>);
    await user.tab();
    expect(screen.getByRole('button')).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('while loading, ignores clicks but keeps focus (no double submit, no lost place)', async () => {
    const onClick = vi.fn();
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => {
      event.preventDefault();
    });
    const user = userEvent.setup();
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" loading onClick={onClick}>
          Save
        </Button>
      </form>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    button.focus();
    await user.click(button);
    await user.keyboard('{Enter}');
    expect(onClick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });

  it('a disabled button is really disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Off
      </Button>,
    );
    await userEvent.setup().click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('submits a form when it is a submit button and not loading', async () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => {
      event.preventDefault();
    });
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit">Save</Button>
      </form>,
    );
    await userEvent.setup().click(screen.getByRole('button'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
