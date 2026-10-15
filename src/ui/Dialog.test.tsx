import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectNoAccessibilityViolations } from '../test/axe';
import { Button } from './Button';
import { Dialog } from './Dialog';

function Harness({ onClose = () => undefined }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        Reverse
      </Button>
      <Dialog
        open={open}
        title="Reverse this transaction?"
        onClose={() => {
          setOpen(false);
          onClose();
        }}
      >
        <p>This posts the opposite entries.</p>
        <Button
          onClick={() => {
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('has no accessibility violations, open or closed', async () => {
    const { container } = render(<Harness />);
    await expectNoAccessibilityViolations(container);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reverse' }));
    await expectNoAccessibilityViolations(container);
  });

  it('is hidden, and renders nothing inside, until it is opened', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('This posts the opposite entries.')).not.toBeInTheDocument();
  });

  it('opens with its title as its name, and shows its content', async () => {
    render(<Harness />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reverse' }));
    const dialog = screen.getByRole('dialog', { name: 'Reverse this transaction?' });
    expect(dialog).toHaveAttribute('open');
    expect(screen.getByText('This posts the opposite entries.')).toBeInTheDocument();
  });

  it('returns focus to the button that opened it when a button inside closes it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Reverse' });
    await user.click(opener);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('when the browser closes it (Escape), tells the parent once and returns focus', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Reverse' });
    await user.click(opener);
    // Escape makes a real browser call close() on the dialog; jsdom does not, so do the same.
    document.querySelector('dialog')?.close();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(opener).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not call onClose when the parent closes it itself', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Reverse' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('can be opened again after it was closed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    for (let i = 0; i < 2; i += 1) {
      await user.click(screen.getByRole('button', { name: 'Reverse' }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    }
  });
});
