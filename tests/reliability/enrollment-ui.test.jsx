import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { test, expect, vi } from 'vitest';
import { Enrollment } from '../../src/household/Enrollment';
test('owner setup requires saving recovery before activating credentials', async () => {
  const request = vi.fn().mockResolvedValueOnce({ id: 'pending', recovery: 'keep-me-private', credential: 'owner-key' }).mockResolvedValueOnce({ success: true });
  const connected = vi.fn();
  render(<Enrollment credential="setup-key" request={request} onConnected={connected} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alex' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByDisplayValue('keep-me-private');
  expect(screen.getByRole('button', { name: 'Finish setup' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }));
  await waitFor(() => expect(connected).toHaveBeenCalledWith('owner-key'));
  expect(request).toHaveBeenLastCalledWith('setup-key', { action: 'confirm', id: 'pending' });
});
