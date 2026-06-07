import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateBalances, getRawTransferCount, simplifyDebts } from '../src/lib/finance.ts'
import type { Expense, Group, MarketAsset, Member, SettlementRecord } from '../src/types.ts'

test('simplifyDebts reduces a three-person balance graph into minimal transfers', () => {
  const transfers = simplifyDebts([
    { memberId: 'alice', netUsd: 70 },
    { memberId: 'bob', netUsd: -40 },
    { memberId: 'chris', netUsd: -30 },
  ])

  assert.deepEqual(transfers, [
    { fromId: 'bob', toId: 'alice', amountUsd: 40 },
    { fromId: 'chris', toId: 'alice', amountUsd: 30 },
  ])
})

test('getRawTransferCount counts the unsimplified payer-to-member edges', () => {
  const group: Group = {
    id: 'group-1',
    name: 'Builders',
    chainId: 8453,
    settlementToken: 'USDC',
    memberIds: ['alice', 'bob', 'chris'],
    createdAt: '2026-06-06T00:00:00.000Z',
  }
  const expenses: Expense[] = [
    {
      id: 'expense-1',
      groupId: group.id,
      title: 'Hotel',
      category: 'Travel',
      amount: 300,
      token: 'USDC',
      payerId: 'alice',
      splitMode: 'equal',
      shares: { alice: 100, bob: 100, chris: 100 },
      createdAt: group.createdAt,
    },
    {
      id: 'expense-2',
      groupId: group.id,
      title: 'Dinner',
      category: 'DAO Ops',
      amount: 150,
      token: 'USDC',
      payerId: 'bob',
      splitMode: 'custom',
      shares: { alice: 50, bob: 50, chris: 50 },
      createdAt: group.createdAt,
    },
  ]

  assert.equal(getRawTransferCount(group, expenses), 4)
})

test('calculateBalances uses locked expense USD values instead of refreshed prices', () => {
  const members: Member[] = [
    { id: 'alice', name: 'Alice', wallet: '0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266' },
    { id: 'bob', name: 'Bob', wallet: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' },
  ]
  const group: Group = {
    id: 'group-1',
    name: 'Builders',
    chainId: 8453,
    settlementToken: 'USDC',
    memberIds: members.map((member) => member.id),
    createdAt: '2026-06-06T00:00:00.000Z',
  }
  const expenses: Expense[] = [
    {
      id: 'expense-1',
      groupId: group.id,
      title: 'ETH hotel',
      category: 'Travel',
      amount: 1,
      token: 'ETH',
      priceUsd: 100,
      amountUsd: 100,
      sharesUsd: { alice: 50, bob: 50 },
      pricedAt: group.createdAt,
      priceSource: 'sosovalue',
      payerId: 'alice',
      splitMode: 'equal',
      shares: { alice: 0.5, bob: 0.5 },
      createdAt: group.createdAt,
    },
  ]
  const refreshedMarkets: MarketAsset[] = [
    { symbol: 'ETH', price: 200, source: 'sosovalue', updatedAt: '2026-06-06T00:01:00.000Z' },
  ]

  assert.deepEqual(calculateBalances(group, expenses, [], members, refreshedMarkets), [
    { memberId: 'alice', netUsd: 50 },
    { memberId: 'bob', netUsd: -50 },
  ])
})

test('calculateBalances ignores pending and failed settlements', () => {
  const members: Member[] = [
    { id: 'alice', name: 'Alice', wallet: '0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266' },
    { id: 'bob', name: 'Bob', wallet: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' },
  ]
  const group: Group = {
    id: 'group-1',
    name: 'Builders',
    chainId: 8453,
    settlementToken: 'USDC',
    memberIds: members.map((member) => member.id),
    createdAt: '2026-06-06T00:00:00.000Z',
  }
  const expenses: Expense[] = [
    {
      id: 'expense-1',
      groupId: group.id,
      title: 'Hotel',
      category: 'Travel',
      amount: 100,
      token: 'USDC',
      priceUsd: 1,
      amountUsd: 100,
      sharesUsd: { alice: 50, bob: 50 },
      pricedAt: group.createdAt,
      priceSource: 'stablecoin',
      payerId: 'alice',
      splitMode: 'equal',
      shares: { alice: 50, bob: 50 },
      createdAt: group.createdAt,
    },
  ]
  const settlements: SettlementRecord[] = [
    {
      id: 'settlement-1',
      groupId: group.id,
      fromId: 'bob',
      toId: 'alice',
      amountUsd: 50,
      token: 'USDC',
      tokenAmount: 50,
      chainId: 8453,
      txHash: '0x1234',
      createdAt: group.createdAt,
      status: 'pending',
    },
    {
      id: 'settlement-2',
      groupId: group.id,
      fromId: 'bob',
      toId: 'alice',
      amountUsd: 50,
      token: 'USDC',
      tokenAmount: 50,
      chainId: 8453,
      txHash: '0x5678',
      createdAt: group.createdAt,
      status: 'failed',
    },
  ]

  assert.deepEqual(calculateBalances(group, expenses, settlements, members, []), [
    { memberId: 'alice', netUsd: 50 },
    { memberId: 'bob', netUsd: -50 },
  ])

  assert.deepEqual(calculateBalances(group, expenses, [{ ...settlements[0], status: 'confirmed' }], members, []), [
    { memberId: 'alice', netUsd: 0 },
    { memberId: 'bob', netUsd: 0 },
  ])
})
