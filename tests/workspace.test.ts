import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeWorkspacePayload } from '../src/lib/workspace.ts'

test('normalizeWorkspacePayload converts legacy Polygon MATIC settlement tokens to POL', () => {
  const workspace = normalizeWorkspacePayload({
    members: [
      { id: 'alice', name: 'Alice', wallet: '0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266' },
      { id: 'bob', name: 'Bob', wallet: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' },
    ],
    groups: [
      {
        id: 'polygon-group',
        name: 'Polygon Trip',
        chainId: 137,
        settlementToken: 'MATIC',
        memberIds: ['alice', 'bob'],
        createdAt: '2026-06-06T00:00:00.000Z',
      },
    ],
    expenses: [
      {
        id: 'expense-1',
        groupId: 'polygon-group',
        title: 'Dinner',
        category: 'Travel',
        amount: 120,
        token: 'MATIC',
        payerId: 'alice',
        splitMode: 'equal',
        shares: { alice: 60, bob: 60 },
        createdAt: '2026-06-06T00:00:00.000Z',
      },
    ],
    settlements: [
      {
        id: 'settlement-1',
        groupId: 'polygon-group',
        fromId: 'bob',
        toId: 'alice',
        amountUsd: 60,
        token: 'MATIC',
        tokenAmount: 60,
        chainId: 137,
        txHash: '0x1234',
        createdAt: '2026-06-06T00:00:00.000Z',
        status: 'sent',
      },
    ],
    selectedGroupId: 'polygon-group',
  })

  assert.equal(workspace.groups[0].settlementToken, 'POL')
  assert.equal(workspace.expenses[0].token, 'MATIC')
  assert.equal(workspace.settlements[0].token, 'POL')
  assert.equal(workspace.settlements[0].status, 'confirmed')
})
