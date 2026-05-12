export type SplitMode = 'equal' | 'percentage' | 'custom'

export type Member = {
  id: string
  name: string
  wallet: string
}

export type Group = {
  id: string
  name: string
  chainId: number
  settlementToken: string
  memberIds: string[]
  createdAt: string
}

export type Expense = {
  id: string
  groupId: string
  title: string
  category: string
  amount: number
  token: string
  payerId: string
  splitMode: SplitMode
  shares: Record<string, number>
  createdAt: string
}

export type SettlementRecord = {
  id: string
  groupId: string
  fromId: string
  toId: string
  amountUsd: number
  token: string
  tokenAmount: number
  chainId: number
  txHash: string
  createdAt: string
  status: 'sent'
}

export type MarketAsset = {
  symbol: string
  name?: string
  currencyId?: string
  price?: number
  changePct24h?: number
  turnover24h?: number
  marketCap?: number
  high24h?: number
  low24h?: number
  rank?: number
  source: 'sosovalue' | 'sodex' | 'stablecoin' | 'missing'
  updatedAt: string
}

export type WalletState = {
  account: string
  chainId: number
}

export type Balance = {
  memberId: string
  netUsd: number
}

export type OptimizedTransfer = {
  fromId: string
  toId: string
  amountUsd: number
}

export type MarketStatus = {
  loading: boolean
  error: string
  assets: MarketAsset[]
  updatedAt: string
}
