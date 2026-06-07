import { chains, getSupportedSettlementTokens, trackedTokens } from '../data/chains'
import type { Expense, Group, Member, SettlementRecord, SettlementStatus, SplitMode, WorkspacePayload } from '../types'
import { isEvmAddress } from './finance'

const splitModes = new Set<SplitMode>(['equal', 'percentage', 'custom'])
const trackedTokenSet = new Set<string>(trackedTokens)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readPositiveNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function readNonNegativeNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function readChainId(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return chains.some((chain) => chain.id === parsed) ? parsed : null
}

function readIsoDate(value: unknown): string {
  const parsed = readString(value)
  return parsed || new Date().toISOString()
}

function normalizeSettlementToken(chainId: number, token: string): string {
  const normalizedToken = token.toUpperCase()
  return chainId === 137 && normalizedToken === 'MATIC' ? 'POL' : normalizedToken
}

function normalizeShares(value: unknown, memberIds: string[]): Record<string, number> {
  if (!isRecord(value)) {
    return {}
  }

  return memberIds.reduce<Record<string, number>>((shares, memberId) => {
    const amount = readPositiveNumber(value[memberId])

    if (amount !== null) {
      shares[memberId] = amount
    }

    return shares
  }, {})
}

function normalizeSharesUsd(value: unknown, memberIds: string[]): Record<string, number> | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const sharesUsd = memberIds.reduce<Record<string, number>>((shares, memberId) => {
    const amount = readNonNegativeNumber(value[memberId])

    if (amount !== null) {
      shares[memberId] = amount
    }

    return shares
  }, {})

  return Object.keys(sharesUsd).length > 0 ? sharesUsd : undefined
}

function normalizeSettlementStatus(value: unknown): SettlementStatus {
  if (value === 'pending' || value === 'confirmed' || value === 'failed') {
    return value
  }

  return 'confirmed'
}

export function normalizeWorkspacePayload(value: unknown): WorkspacePayload {
  if (!isRecord(value)) {
    throw new Error('Workspace payload is invalid.')
  }

  const members = (Array.isArray(value.members) ? value.members : [])
    .map((member): Member | null => {
      if (!isRecord(member)) {
        return null
      }

      const id = readString(member.id)
      const name = readString(member.name)
      const wallet = readString(member.wallet)

      if (!id || !name || !isEvmAddress(wallet)) {
        return null
      }

      return { id, name, wallet }
    })
    .filter((member): member is Member => Boolean(member))
  const memberIds = new Set(members.map((member) => member.id))
  const groups = (Array.isArray(value.groups) ? value.groups : [])
    .map((group): Group | null => {
      if (!isRecord(group)) {
        return null
      }

      const id = readString(group.id)
      const name = readString(group.name)
      const chainId = readChainId(group.chainId)
      const memberIdsForGroup = Array.isArray(group.memberIds)
        ? group.memberIds.map(readString).filter((memberId) => memberIds.has(memberId))
        : []

      if (!id || !name || chainId === null || memberIdsForGroup.length < 2) {
        return null
      }

      const supportedTokens = getSupportedSettlementTokens(chainId)
      const settlementToken = normalizeSettlementToken(chainId, readString(group.settlementToken))

      return {
        id,
        name,
        chainId,
        settlementToken: supportedTokens.includes(settlementToken) ? settlementToken : supportedTokens[0],
        memberIds: Array.from(new Set(memberIdsForGroup)),
        createdAt: readIsoDate(group.createdAt),
      }
    })
    .filter((group): group is Group => Boolean(group))
  const groupsById = new Map(groups.map((group) => [group.id, group]))
  const expenses = (Array.isArray(value.expenses) ? value.expenses : [])
    .map((expense): Expense | null => {
      if (!isRecord(expense)) {
        return null
      }

      const group = groupsById.get(readString(expense.groupId))
      const amount = readPositiveNumber(expense.amount)
      const token = readString(expense.token).toUpperCase()
      const payerId = readString(expense.payerId)
      const splitMode = splitModes.has(expense.splitMode as SplitMode) ? expense.splitMode as SplitMode : 'equal'
      const priceUsd = readPositiveNumber(expense.priceUsd) ?? undefined
      const amountUsd = readPositiveNumber(expense.amountUsd) ?? undefined
      const sharesUsd = normalizeSharesUsd(expense.sharesUsd, group?.memberIds ?? [])
      const pricedAt = readString(expense.pricedAt)
      const priceSource = readString(expense.priceSource)

      if (!group || amount === null || !trackedTokenSet.has(token) || !group.memberIds.includes(payerId)) {
        return null
      }

      const shares = normalizeShares(expense.shares, group.memberIds)

      if (Object.keys(shares).length === 0) {
        return null
      }

      return {
        id: readString(expense.id) || `expense-${crypto.randomUUID()}`,
        groupId: group.id,
        title: readString(expense.title) || 'Imported expense',
        category: readString(expense.category) || 'Other',
        amount,
        token,
        ...(priceUsd ? { priceUsd } : {}),
        ...(amountUsd ? { amountUsd } : {}),
        ...(sharesUsd ? { sharesUsd } : {}),
        ...(pricedAt ? { pricedAt } : {}),
        ...(['sosovalue', 'sodex', 'stablecoin', 'missing'].includes(priceSource) ? { priceSource: priceSource as Expense['priceSource'] } : {}),
        payerId,
        splitMode,
        shares,
        createdAt: readIsoDate(expense.createdAt),
      }
    })
    .filter((expense): expense is Expense => Boolean(expense))
  const settlements = (Array.isArray(value.settlements) ? value.settlements : [])
    .map((settlement): SettlementRecord | null => {
      if (!isRecord(settlement)) {
        return null
      }

      const group = groupsById.get(readString(settlement.groupId))
      const amountUsd = readPositiveNumber(settlement.amountUsd)
      const tokenAmount = readPositiveNumber(settlement.tokenAmount)
      const fromId = readString(settlement.fromId)
      const toId = readString(settlement.toId)
      const chainId = readChainId(settlement.chainId)
      const token = chainId === null ? '' : normalizeSettlementToken(chainId, readString(settlement.token))
      const txHash = readString(settlement.txHash)
      const status = normalizeSettlementStatus(settlement.status)
      const confirmedAt = readString(settlement.confirmedAt)
      const failedAt = readString(settlement.failedAt)
      const failureReason = readString(settlement.failureReason)
      const blockNumber = readString(settlement.blockNumber)

      if (
        !group ||
        amountUsd === null ||
        tokenAmount === null ||
        chainId === null ||
        !group.memberIds.includes(fromId) ||
        !group.memberIds.includes(toId) ||
        !getSupportedSettlementTokens(chainId).includes(token) ||
        !/^0x[a-fA-F0-9]+$/.test(txHash)
      ) {
        return null
      }

      return {
        id: readString(settlement.id) || `settlement-${crypto.randomUUID()}`,
        groupId: group.id,
        fromId,
        toId,
        amountUsd,
        token,
        tokenAmount,
        chainId,
        txHash,
        transferType: settlement.transferType === 'native' || settlement.transferType === 'erc20' ? settlement.transferType : undefined,
        tokenContract: readString(settlement.tokenContract) || undefined,
        confirmedAt: confirmedAt || undefined,
        failedAt: failedAt || undefined,
        failureReason: failureReason || undefined,
        blockNumber: blockNumber || undefined,
        createdAt: readIsoDate(settlement.createdAt),
        status,
      }
    })
    .filter((settlement): settlement is SettlementRecord => Boolean(settlement))
  const selectedGroupId = readString(value.selectedGroupId)

  return {
    members,
    groups,
    expenses,
    settlements,
    selectedGroupId: groupsById.has(selectedGroupId) ? selectedGroupId : groups[0]?.id,
  }
}
