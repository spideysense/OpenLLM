import React from 'react';
import { it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { VaultPane } from '../../src/shared-ui/VaultPane';
afterEach(cleanup);
it('requires document selection and a named purpose before granting, shows the credential once, and revokes it', async () => {
  const doc = { id: 'doc1', owner: 'owner', name: 'Home.txt', sharedWith: [], size: 123 };
  const grants = [];
  const request = vi.fn(async input => {
    if (input.action === 'list') return { documents: [doc], person: 'owner', status: { encrypted: true }, grants: [...grants], activity: [] };
    if (input.action === 'grant') { expect(input.documentIds).toEqual(['doc1']); expect(input.audience).toBe('Test integration'); expect(input.purpose).toBe('Compare quotes'); const grant = { id: 'grant1', ...input, token: 'synthetic-grant', used: 0, maxRequests: 20, expiresAt: Date.now() + 3600000 }; grants.push(grant); return grant; }
    if (input.action === 'revoke') { grants[0].revoked = true; return { ok: true }; }
  });
  render(<VaultPane request={request} />);
  await screen.findByText('Home.txt'); expect(screen.getByRole('button', { name: 'Create limited context credential' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Home.txt' }));
  fireEvent.change(screen.getByLabelText('Recipient'), { target: { value: 'Test integration' } });
  fireEvent.change(screen.getByLabelText('Purpose'), { target: { value: 'Compare quotes' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create limited context credential' }));
  expect(await screen.findByLabelText('Context credential')).toHaveValue('synthetic-grant');
  fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
  await waitFor(() => expect(screen.queryByLabelText('Context credential')).toBeNull());
  expect(request).toHaveBeenCalledWith({ action: 'revoke', id: 'grant1' });
});
it('keeps shared documents read-only and exposes failed operations instead of pretending success', async () => {
  const request = vi.fn(async input => {
    if (input.action === 'list') return { documents: [{ id: 'shared', owner: 'other', name: 'Shared.txt', size: 1, sharedWith: ['guest'] }], person: 'guest', status: { encrypted: true }, grants: [], activity: [] };
    throw new Error('Pairing revoked');
  });
  render(<VaultPane request={request} />); await screen.findByText('Shared.txt');
  expect(screen.getByRole('checkbox', { name: 'Shared.txt' })).toBeDisabled(); expect(screen.queryByRole('button', { name: 'Delete document' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Search your documents'), { target: { value: 'warranty' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Pairing revoked');
});
