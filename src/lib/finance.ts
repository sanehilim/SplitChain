import type { Balance, Expense, Group, MarketAsset, Member, OptimizedTransfer, SettlementRecord } from '../types'

const stableTokens = new Set(['USDC', 'USDT'])

export function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
  }).format(value)
}

export function formatToken(value: number, symbol: string): string {
  const maximumFractionDigits = value >= 10 ? 4 : 6
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(value)} ${symbol}`
}

export function shortAddress(address: string): string {
  if (address.length < 12) {
    return address
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export function isEvmAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address.trim())
}

export function getAsset(markets: MarketAsset[], symbol: string): MarketAsset | undefined {
  return markets.find((asset) => asset.symbol.toUpperCase() === symbol.toUpperCase())
}

export function getTokenPrice(markets: MarketAsset[], symbol: string): number | undefined {
  const marketPrice = getAsset(markets, symbol)?.price

  if (marketPrice && marketPrice > 0) {
    return marketPrice
  }

  if (stableTokens.has(symbol.toUpperCase())) {
    return 1
  }

  return undefined
}

export function toUsd(amount: number, symbol: string, markets: MarketAsset[]): number {
  const price = getTokenPrice(markets, symbol)
  return price ? amount * price : 0
}

function readStoredUsd(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

export function getExpenseAmountUsd(expense: Expense, markets: MarketAsset[]): number {
  const storedAmountUsd = readStoredUsd(expense.amountUsd)

  if (storedAmountUsd !== undefined) {
    return storedAmountUsd
  }

  const storedPriceUsd = readStoredUsd(expense.priceUsd)
  return storedPriceUsd !== undefined ? expense.amount * storedPriceUsd : toUsd(expense.amount, expense.token, markets)
}

export function getExpenseShareUsd(expense: Expense, memberId: string, shareAmount: number, markets: MarketAsset[]): number {
  const storedShareUsd = readStoredUsd(expense.sharesUsd?.[memberId])

  if (storedShareUsd !== undefined) {
    return storedShareUsd
  }

  const storedPriceUsd = readStoredUsd(expense.priceUsd)
  return storedPriceUsd !== undefined ? shareAmount * storedPriceUsd : toUsd(shareAmount, expense.token, markets)
}

export function isBalanceSettledStatus(status: SettlementRecord['status']): boolean {
  return status === 'confirmed' || status === 'sent'
}

export function getMembersForGroup(group: Group | undefined, members: Member[]): Member[] {
  if (!group) {
    return []
  }

  return group.memberIds
    .map((memberId) => members.find((member) => member.id === memberId))
    .filter((member): member is Member => Boolean(member))
}

export function calculateBalances(
  group: Group | undefined,
  expenses: Expense[],
  settlements: SettlementRecord[],
  members: Member[],
  markets: MarketAsset[],
): Balance[] {
  const groupMembers = getMembersForGroup(group, members)
  const balances = new Map(groupMembers.map((member) => [member.id, 0]))

  if (!group) {
    return []
  }

  expenses
    .filter((expense) => expense.groupId === group.id)
    .forEach((expense) => {
      const totalUsd = getExpenseAmountUsd(expense, markets)
      balances.set(expense.payerId, (balances.get(expense.payerId) ?? 0) + totalUsd)

      Object.entries(expense.shares).forEach(([memberId, shareAmount]) => {
        const shareUsd = getExpenseShareUsd(expense, memberId, shareAmount, markets)
        balances.set(memberId, (balances.get(memberId) ?? 0) - shareUsd)
      })
    })

  settlements
    .filter((settlement) => settlement.groupId === group.id && isBalanceSettledStatus(settlement.status))
    .forEach((settlement) => {
      balances.set(settlement.fromId, (balances.get(settlement.fromId) ?? 0) + settlement.amountUsd)
      balances.set(settlement.toId, (balances.get(settlement.toId) ?? 0) - settlement.amountUsd)
    })

  return groupMembers.map((member) => ({
    memberId: member.id,
    netUsd: Number((balances.get(member.id) ?? 0).toFixed(6)),
  }))
}

export function simplifyDebts(balances: Balance[]): OptimizedTransfer[] {
  const creditors = balances
    .filter((balance) => balance.netUsd > 0.01)
    .map((balance) => ({ ...balance }))
    .sort((a, b) => b.netUsd - a.netUsd)
  const debtors = balances
    .filter((balance) => balance.netUsd < -0.01)
    .map((balance) => ({ memberId: balance.memberId, netUsd: Math.abs(balance.netUsd) }))
    .sort((a, b) => b.netUsd - a.netUsd)
  const transfers: OptimizedTransfer[] = []

  let creditorIndex = 0
  let debtorIndex = 0

  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex]
    const debtor = debtors[debtorIndex]
    const amountUsd = Math.min(creditor.netUsd, debtor.netUsd)

    transfers.push({
      fromId: debtor.memberId,
      toId: creditor.memberId,
      amountUsd: Number(amountUsd.toFixed(2)),
    })

    creditor.netUsd -= amountUsd
    debtor.netUsd -= amountUsd

    if (creditor.netUsd <= 0.01) {
      creditorIndex += 1
    }

    if (debtor.netUsd <= 0.01) {
      debtorIndex += 1
    }
  }

  return transfers
}

export function getRawTransferCount(group: Group | undefined, expenses: Expense[]): number {
  if (!group) {
    return 0
  }

  return expenses
    .filter((expense) => expense.groupId === group.id)
    .reduce((count, expense) => {
      const rawExpenseTransfers = Object.entries(expense.shares).filter(
        ([memberId, share]) => memberId !== expense.payerId && share > 0,
      ).length
      return count + rawExpenseTransfers
    }, 0)
}

export function memberName(memberId: string, members: Member[]): string {
  return members.find((member) => member.id === memberId)?.name ?? 'Unknown member'
}

export function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}
