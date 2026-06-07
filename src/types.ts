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
  priceUsd?: number
  amountUsd?: number
  sharesUsd?: Record<string, number>
  pricedAt?: string
  priceSource?: MarketAsset['source']
  payerId: string
  splitMode: SplitMode
  shares: Record<string, number>
  createdAt: string
}

export type SettlementStatus = 'pending' | 'confirmed' | 'failed' | 'sent'

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
  transferType?: 'native' | 'erc20'
  tokenContract?: string
  confirmedAt?: string
  failedAt?: string
  failureReason?: string
  blockNumber?: string
  createdAt: string
  status: SettlementStatus
}

export type MarketAsset = {
  symbol: string
  name?: string
  currencyId?: string
  resolvedSymbol?: string
  price?: number
  changePct24h?: number
  turnover24h?: number
  marketCap?: number
  high24h?: number
  low24h?: number
  rank?: number
  source: 'sosovalue' | 'sodex' | 'stablecoin' | 'missing'
  fallbackReason?: string
  updatedAt: string
}

export type IndexSnapshot = {
  ticker: string
  price?: number
  changePct24h?: number
  roi7d?: number
  roi1m?: number
  roi3m?: number
  roi1y?: number
  ytd?: number
  source: 'sosovalue-index' | 'missing'
  updatedAt: string
}

export type WorkspacePayload = {
  members: Member[]
  groups: Group[]
  expenses: Expense[]
  settlements: SettlementRecord[]
  selectedGroupId?: string
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
  fallbackReason?: string
  source?: 'sosovalue' | 'mixed' | 'fallback'
  updatedAt: string
}
