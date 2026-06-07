import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  CircleDollarSign,
  Coins,
  Database,
  Gauge,
  Layers3,
  Link2,
  Loader2,
  Plus,
  RefreshCcw,
  Send,
  Settings,
  ShieldCheck,
  Split,
  Upload,
  UserPlus,
  Wallet,
} from 'lucide-react'
import heroImg from './assets/hero.png'
import './App.css'
import { chains, getChain, getSupportedSettlementTokens, isNativeSettlementToken, trackedTokens } from './data/chains'
import { usePersistentState } from './hooks/usePersistentState'
import {
  calculateBalances,
  formatToken,
  formatUsd,
  getAsset,
  getExpenseAmountUsd,
  getMembersForGroup,
  getRawTransferCount,
  getTokenPrice,
  isEvmAddress,
  makeId,
  memberName,
  shortAddress,
  simplifyDebts,
} from './lib/finance'
import { connectWallet, getWalletState, sendSettlementTransaction, signWorkspaceRequest, waitForTransactionConfirmation } from './lib/wallet'
import { normalizeWorkspacePayload } from './lib/workspace'
import type {
  Expense,
  Group,
  IndexSnapshot,
  MarketAsset,
  MarketStatus,
  Member,
  OptimizedTransfer,
  SettlementRecord,
  SplitMode,
  WalletState,
  WorkspacePayload,
} from './types'

type Notice = {
  type: 'info' | 'success' | 'error'
  message: string
}

type SodexTicker = Record<string, unknown>

type SodexState = {
  loading: boolean
  error: string
  tickers: SodexTicker[]
  updatedAt: string
}

type IndexState = {
  loading: boolean
  error: string
  indexes: IndexSnapshot[]
  updatedAt: string
}

type CloudState = {
  loading: boolean
  message: string
}

const categories = ['Travel', 'DAO Ops', 'Subscription', 'Infra', 'Trading Group', 'Other']
const initialMarketStatus: MarketStatus = { loading: true, error: '', assets: [], updatedAt: '' }
const initialSodexState: SodexState = { loading: true, error: '', tickers: [], updatedAt: '' }
const initialIndexState: IndexState = { loading: true, error: '', indexes: [], updatedAt: '' }
const initialCloudState: CloudState = { loading: false, message: 'Local workspace' }
const stableTokens = new Set(['USDC', 'USDT'])
const sodexSymbolsByToken: Partial<Record<string, string>> = {
  BNB: 'vBNB_vUSDC',
  BTC: 'vBTC_vUSDC',
  ETH: 'vETH_vUSDC',
  SOL: 'vSOL_vUSDC',
}
const defaultSodexSymbols = Object.values(sodexSymbolsByToken).join(',')

function readString(record: SodexTicker, keys: string[]): string {
  for (const key of keys) {
    const value = record[key]

    if (typeof value === 'string' || typeof value === 'number') {
      return String(value)
    }
  }

  return ''
}

function readNumber(record: SodexTicker, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key]

    if (typeof value === 'number') {
      return value
    }

    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value)

      if (Number.isFinite(parsed)) {
        return parsed
      }
    }
  }

  return undefined
}

function formatPercent(value: number | undefined, options: { ratio?: boolean } = {}): string {
  if (value === undefined) {
    return 'Awaiting signal'
  }

  const normalizedValue = options.ratio ? value * 100 : value
  return `${normalizedValue >= 0 ? '+' : ''}${normalizedValue.toFixed(2)}%`
}

function isStableToken(symbol: string): boolean {
  return stableTokens.has(symbol.toUpperCase())
}

function getMarketSourceLabel(asset: MarketAsset): string {
  if (asset.source === 'sosovalue') {
    return asset.resolvedSymbol && asset.resolvedSymbol.toUpperCase() !== asset.symbol.toUpperCase()
      ? `SoSoValue ${asset.resolvedSymbol.toUpperCase()}`
      : 'SoSoValue'
  }

  if (asset.source === 'sodex') {
    return 'SoDEX fallback'
  }

  if (asset.source === 'stablecoin') {
    return 'Stable reference'
  }

  return 'Missing'
}

function getMarketStatusCopy(market: MarketStatus): string {
  if (market.error) {
    return 'Needs attention'
  }

  if (market.source === 'sosovalue') {
    return 'SoSoValue live'
  }

  if (market.source === 'mixed') {
    return 'Mixed sources'
  }

  if (market.source === 'fallback') {
    return 'Fallback pricing'
  }

  return market.loading ? 'Syncing' : 'Ready'
}

function parsePositiveInput(value: string, label: string): number {
  const amount = Number(value)

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Enter a positive ${label}.`)
  }

  return amount
}

function normalizeWalletChainId(chainIdValue: unknown): number {
  if (typeof chainIdValue === 'string') {
    return chainIdValue.startsWith('0x') ? Number.parseInt(chainIdValue, 16) : Number(chainIdValue)
  }

  return typeof chainIdValue === 'number' ? chainIdValue : 0
}

function normalizeSodexToken(token: string): string {
  return token.toUpperCase().replace(/^V/, '')
}

function findSodexTickerForToken(tickers: SodexTicker[], token: string): SodexTicker | undefined {
  const normalizedToken = token.toUpperCase()

  return tickers.find((ticker) => {
    const symbol = readString(ticker, ['symbol', 's']).toUpperCase()
    const [baseToken] = symbol.split('_')
    return normalizeSodexToken(baseToken ?? '') === normalizedToken
  })
}

function getIndexSignal(index: IndexSnapshot | undefined): { label: string; value?: number } {
  if (!index) {
    return { label: 'SSI' }
  }

  if (index.changePct24h !== undefined) {
    return { label: '24h', value: index.changePct24h }
  }

  if (index.roi7d !== undefined) {
    return { label: '7d', value: index.roi7d }
  }

  if (index.roi1m !== undefined) {
    return { label: '1m', value: index.roi1m }
  }

  if (index.ytd !== undefined) {
    return { label: 'YTD', value: index.ytd }
  }

  return { label: 'SSI' }
}

function formatIndexSignal(index: IndexSnapshot | undefined): string {
  const signal = getIndexSignal(index)
  return `${formatPercent(signal.value, { ratio: true })} ${signal.label}`
}

function App() {
  const [members, setMembers] = usePersistentState<Member[]>('splitchain:members', [])
  const [groups, setGroups] = usePersistentState<Group[]>('splitchain:groups', [])
  const [expenses, setExpenses] = usePersistentState<Expense[]>('splitchain:expenses', [])
  const [settlements, setSettlements] = usePersistentState<SettlementRecord[]>('splitchain:settlements', [])
  const [selectedGroupId, setSelectedGroupId] = usePersistentState<string>('splitchain:selected-group', '')
  const [wallet, setWallet] = useState<WalletState | null>(null)
  const [market, setMarket] = useState<MarketStatus>(initialMarketStatus)
  const [sodex, setSodex] = useState<SodexState>(initialSodexState)
  const [indexes, setIndexes] = useState<IndexState>(initialIndexState)
  const [cloud, setCloud] = useState<CloudState>(initialCloudState)
  const [notice, setNotice] = useState<Notice>({ type: 'info', message: 'Ready to create your first crypto split.' })
  const [memberForm, setMemberForm] = useState({ name: '', wallet: '' })
  const [groupForm, setGroupForm] = useState({ name: '', chainId: 8453, settlementToken: 'USDC' })
  const [groupMemberIds, setGroupMemberIds] = useState<string[]>([])
  const [expenseForm, setExpenseForm] = useState({
    title: '',
    category: 'Travel',
    amount: '',
    token: 'USDC',
    payerId: '',
    splitMode: 'equal' as SplitMode,
  })
  const [percentageShares, setPercentageShares] = useState<Record<string, string>>({})
  const [customShares, setCustomShares] = useState<Record<string, string>>({})
  const [settlementChainId, setSettlementChainId] = useState(8453)
  const [settlementToken, setSettlementToken] = useState('USDC')
  const [payingTransfer, setPayingTransfer] = useState('')
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const groupSelectionHydratedRef = useRef(false)

  const activeGroup = groups.find((group) => group.id === selectedGroupId) ?? groups[0]
  const activeMembers = useMemo(() => getMembersForGroup(activeGroup, members), [activeGroup, members])
  const activeExpenses = useMemo(
    () => expenses.filter((expense) => expense.groupId === activeGroup?.id),
    [activeGroup?.id, expenses],
  )
  const activeSettlements = useMemo(
    () => settlements.filter((settlement) => settlement.groupId === activeGroup?.id),
    [activeGroup?.id, settlements],
  )
  const marketSymbols = useMemo(() => {
    const expenseTokens = expenses.map((expense) => expense.token)
    const groupTokens = groups.map((group) => group.settlementToken)
    return Array.from(new Set([...trackedTokens, ...expenseTokens, ...groupTokens])).join(',')
  }, [expenses, groups])
  const balances = useMemo(
    () => calculateBalances(activeGroup, expenses, settlements, members, market.assets),
    [activeGroup, expenses, settlements, members, market.assets],
  )
  const optimizedTransfers = useMemo(() => simplifyDebts(balances), [balances])
  const rawTransferCount = useMemo(() => getRawTransferCount(activeGroup, activeExpenses), [activeGroup, activeExpenses])
  const totalUsd = useMemo(
    () => activeExpenses.reduce((sum, expense) => sum + getExpenseAmountUsd(expense, market.assets), 0),
    [activeExpenses, market.assets],
  )
  const walletMember = useMemo(
    () => members.find((member) => wallet && member.wallet.toLowerCase() === wallet.account.toLowerCase()),
    [members, wallet],
  )
  const activeMemberKey = activeGroup?.memberIds.join('|') ?? ''
  const supportedSettlementTokens = useMemo(() => getSupportedSettlementTokens(settlementChainId), [settlementChainId])
  const tokenExposure = useMemo(() => {
    return activeExpenses.reduce<Record<string, number>>((totals, expense) => {
      totals[expense.token] = (totals[expense.token] ?? 0) + expense.amount
      return totals
    }, {})
  }, [activeExpenses])
  const categoryTotals = useMemo(() => {
    return activeExpenses.reduce<Record<string, number>>((totals, expense) => {
      totals[expense.category] = (totals[expense.category] ?? 0) + getExpenseAmountUsd(expense, market.assets)
      return totals
    }, {})
  }, [activeExpenses, market.assets])
  const largestPayer = useMemo(() => {
    const paidByMember = activeExpenses.reduce<Record<string, number>>((totals, expense) => {
      totals[expense.payerId] = (totals[expense.payerId] ?? 0) + getExpenseAmountUsd(expense, market.assets)
      return totals
    }, {})
    const [memberId, amount] = Object.entries(paidByMember).sort((a, b) => b[1] - a[1])[0] ?? []
    return memberId ? { name: memberName(memberId, members), amount } : null
  }, [activeExpenses, market.assets, members])
  const workspacePayload = useMemo<WorkspacePayload>(() => ({
    members,
    groups,
    expenses,
    settlements,
    selectedGroupId,
  }), [expenses, groups, members, selectedGroupId, settlements])
  const primaryIndex = useMemo(
    () => indexes.indexes.find((index) => index.source === 'sosovalue-index') ?? indexes.indexes[0],
    [indexes.indexes],
  )
  const sodexSettlementTicker = useMemo(
    () => findSodexTickerForToken(sodex.tickers, settlementToken),
    [settlementToken, sodex.tickers],
  )
  const settlementRecommendation = useMemo(() => {
    const chain = getChain(settlementChainId)
    const selectedTokenPrice = getTokenPrice(market.assets, settlementToken)
    const selectedTokenAsset = getAsset(market.assets, settlementToken)
    const indexSignal = getIndexSignal(primaryIndex)
    const tokenMove = selectedTokenAsset?.changePct24h
    const priceSource = selectedTokenAsset ? getMarketSourceLabel(selectedTokenAsset) : 'Live market'
    const stableToken = supportedSettlementTokens.find((token) => token === 'USDC') ?? supportedSettlementTokens.find(isStableToken) ?? settlementToken
    const hasVolatileExposure = Object.keys(tokenExposure).some((token) => !isStableToken(token))
    const sodexSymbol = sodexSettlementTicker ? readString(sodexSettlementTicker, ['symbol', 's']) : ''

    if (!selectedTokenPrice) {
      return {
        token: stableToken,
        title: `Use ${stableToken} once pricing is live`,
        detail: 'Live pricing is required before SplitChain converts USD balances into token settlement amounts.',
        shortReason: 'Waiting for live price',
      }
    }

    if (isStableToken(settlementToken)) {
      return {
        token: settlementToken,
        title: `${settlementToken} on ${chain.shortName} is the clean route`,
        detail: hasVolatileExposure
          ? `Stable settlement keeps the debt graph fixed while SSI ${indexSignal.label} reads ${formatPercent(indexSignal.value, { ratio: true })}.`
          : `Stable balances are already aligned with ${chain.name} settlement using ${priceSource}.`,
        shortReason: sodexSymbol ? `SoDEX ${sodexSymbol}` : 'Stable settlement',
      }
    }

    if ((indexSignal.value !== undefined && indexSignal.value < -0.01) || (tokenMove !== undefined && Math.abs(tokenMove) > 2)) {
      return {
        token: stableToken,
        title: `Prefer ${stableToken} for this settlement`,
        detail: `${settlementToken} is moving ${formatPercent(tokenMove)} while SSI ${indexSignal.label} reads ${formatPercent(indexSignal.value, { ratio: true })}; stable settlement reduces drift between friends.`,
        shortReason: 'Market drift guard',
      }
    }

    return {
      token: settlementToken,
      title: `${settlementToken} is acceptable now`,
      detail: sodexSymbol
        ? `SoDEX has a live ${sodexSymbol} ticker and ${priceSource} pricing is available for conversion.`
        : `${priceSource} pricing is available; switch to a stable token if the group wants less volatility.`,
      shortReason: 'Live route',
    }
  }, [
    market.assets,
    primaryIndex,
    settlementChainId,
    settlementToken,
    sodexSettlementTicker,
    supportedSettlementTokens,
    tokenExposure,
  ])

  const refreshMarket = useCallback(async () => {
    setMarket((current) => ({ ...current, loading: true, error: '' }))

    try {
      const response = await fetch(`/api/market/assets?symbols=${encodeURIComponent(marketSymbols)}`)
      const payload = (await response.json()) as {
        assets?: MarketAsset[]
        fallbackReason?: string
        source?: MarketStatus['source']
        updatedAt?: string
        error?: string
      }

      if (!response.ok || !payload.assets) {
        throw new Error(payload.error ?? 'Unable to load market data.')
      }

      setMarket({
        loading: false,
        error: '',
        assets: payload.assets,
        fallbackReason: payload.fallbackReason,
        source: payload.source,
        updatedAt: payload.updatedAt ?? new Date().toISOString(),
      })
    } catch (error) {
      setMarket((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : 'Unable to load market data.',
      }))
    }
  }, [marketSymbols])

  const refreshSodex = useCallback(async () => {
    setSodex((current) => ({ ...current, loading: true, error: '' }))

    try {
      const response = await fetch(`/api/sodex/tickers?symbols=${encodeURIComponent(defaultSodexSymbols)}`)
      const payload = (await response.json()) as { tickers?: SodexTicker[]; updatedAt?: string; error?: string }

      if (!response.ok || !payload.tickers) {
        throw new Error(payload.error ?? 'Unable to load SoDEX tickers.')
      }

      setSodex({
        loading: false,
        error: '',
        tickers: payload.tickers,
        updatedAt: payload.updatedAt ?? new Date().toISOString(),
      })
    } catch (error) {
      setSodex((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : 'Unable to load SoDEX tickers.',
      }))
    }
  }, [])

  const refreshIndexes = useCallback(async () => {
    setIndexes((current) => ({ ...current, loading: true, error: '' }))

    try {
      const response = await fetch('/api/market/indexes?tickers=ssimag7,ssilayer1')
      const payload = (await response.json()) as { indexes?: IndexSnapshot[]; updatedAt?: string; error?: string }

      if (!response.ok || !payload.indexes) {
        throw new Error(payload.error ?? 'Unable to load SoSoValue Index context.')
      }

      setIndexes({
        loading: false,
        error: '',
        indexes: payload.indexes,
        updatedAt: payload.updatedAt ?? new Date().toISOString(),
      })
    } catch (error) {
      setIndexes((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : 'Unable to load SoSoValue Index context.',
      }))
    }
  }, [])

  useEffect(() => {
    refreshMarket()
    const refreshTimer = window.setInterval(refreshMarket, 30_000)
    return () => window.clearInterval(refreshTimer)
  }, [refreshMarket])

  useEffect(() => {
    refreshSodex()
  }, [refreshSodex])

  useEffect(() => {
    refreshIndexes()
    const refreshTimer = window.setInterval(refreshIndexes, 60_000)
    return () => window.clearInterval(refreshTimer)
  }, [refreshIndexes])

  useEffect(() => {
    getWalletState()
      .then((state) => {
        if (state) {
          setWallet(state)
        }
      })
      .catch(() => undefined)

    const provider = window.ethereum

    if (!provider?.on) {
      return undefined
    }

    const handleAccountsChanged = async (accountsValue: unknown) => {
      const accounts = Array.isArray(accountsValue) ? accountsValue : []
      const account = typeof accounts[0] === 'string' ? accounts[0] : ''

      if (!account) {
        setWallet(null)
        return
      }

      try {
        const chainId = normalizeWalletChainId(await provider.request({ method: 'eth_chainId' }))
        setWallet({ account, chainId })
      } catch {
        setWallet((current) => ({ account, chainId: current?.chainId ?? 0 }))
      }
    }
    const handleChainChanged = (chainIdValue: unknown) => {
      const chainId = normalizeWalletChainId(chainIdValue)
      setWallet((current) => (current ? { ...current, chainId } : current))
    }

    provider.on('accountsChanged', handleAccountsChanged)
    provider.on('chainChanged', handleChainChanged)

    return () => {
      provider.removeListener?.('accountsChanged', handleAccountsChanged)
      provider.removeListener?.('chainChanged', handleChainChanged)
    }
  }, [])

  useEffect(() => {
    if (groups.length === 0) {
      if (selectedGroupId) {
        setSelectedGroupId('')
      }
      return
    }

    if (!groups.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId(groups[0].id)
    }
  }, [groups, selectedGroupId, setSelectedGroupId])

  useEffect(() => {
    if (groupSelectionHydratedRef.current) {
      setGroupMemberIds((current) => current.filter((memberId) => members.some((member) => member.id === memberId)))
      return
    }

    groupSelectionHydratedRef.current = true

    if (members.length > 0) {
      setGroupMemberIds((current) => (
        current.length > 0
          ? current.filter((memberId) => members.some((member) => member.id === memberId))
          : members.map((member) => member.id)
      ))
    }
  }, [members])

  useEffect(() => {
    const supportedTokens = getSupportedSettlementTokens(groupForm.chainId)

    if (!supportedTokens.includes(groupForm.settlementToken)) {
      setGroupForm((current) => ({ ...current, settlementToken: supportedTokens[0] ?? 'USDC' }))
    }
  }, [groupForm.chainId, groupForm.settlementToken])

  useEffect(() => {
    if (!activeGroup) {
      return
    }

    setSettlementChainId(activeGroup.chainId)
    setSettlementToken(activeGroup.settlementToken)
    setExpenseForm((current) => ({
      ...current,
      payerId: activeGroup.memberIds.includes(current.payerId) ? current.payerId : activeGroup.memberIds[0] ?? '',
      token: current.token || activeGroup.settlementToken,
    }))
  }, [activeGroup])

  useEffect(() => {
    if (!supportedSettlementTokens.includes(settlementToken)) {
      setSettlementToken(supportedSettlementTokens[0] ?? 'USDC')
    }
  }, [settlementToken, supportedSettlementTokens])

  useEffect(() => {
    const memberIds = activeMemberKey ? activeMemberKey.split('|') : []
    const amount = Number(expenseForm.amount) || 0
    const equalPercent = memberIds.length > 0 ? (100 / memberIds.length).toFixed(2) : '0'
    const equalAmount = memberIds.length > 0 && amount > 0 ? (amount / memberIds.length).toFixed(6) : ''

    setPercentageShares((current) => (
      memberIds.reduce<Record<string, string>>((shares, memberId) => {
        shares[memberId] = current[memberId] ?? equalPercent
        return shares
      }, {})
    ))
    setCustomShares((current) => (
      memberIds.reduce<Record<string, string>>((shares, memberId) => {
        shares[memberId] = current[memberId] ?? equalAmount
        return shares
      }, {})
    ))
  }, [activeMemberKey, expenseForm.amount])

  function showNotice(type: Notice['type'], message: string) {
    setNotice({ type, message })
  }

  function applyWorkspacePayload(payload: WorkspacePayload) {
    const nextGroup = payload.groups.find((group) => group.id === payload.selectedGroupId) ?? payload.groups[0]

    setMembers(payload.members)
    setGroups(payload.groups)
    setExpenses(payload.expenses)
    setSettlements(payload.settlements)
    setSelectedGroupId(nextGroup?.id ?? '')
    setGroupMemberIds(nextGroup?.memberIds ?? payload.members.map((member) => member.id))
  }

  function loadDemoWorkspace() {
    if ((members.length > 0 || groups.length > 0 || expenses.length > 0 || settlements.length > 0) && !window.confirm('Load the three-wallet demo and replace the current local workspace?')) {
      return
    }

    const createdAt = new Date().toISOString()
    const demoMembers: Member[] = [
      { id: 'demo-member-aman', name: 'Aman', wallet: '0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266' },
      { id: 'demo-member-maya', name: 'Maya', wallet: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' },
      { id: 'demo-member-lee', name: 'Lee', wallet: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' },
    ]
    const demoGroup: Group = {
      id: 'demo-group-base-trip',
      name: 'Base builders weekend',
      chainId: 8453,
      settlementToken: 'USDC',
      memberIds: demoMembers.map((member) => member.id),
      createdAt,
    }
    const demoExpenses: Expense[] = [
      {
        id: 'demo-expense-hotel',
        groupId: demoGroup.id,
        title: 'Hotel booking',
        category: 'Travel',
        amount: 600,
        token: 'USDC',
        priceUsd: 1,
        amountUsd: 600,
        payerId: demoMembers[0].id,
        splitMode: 'equal',
        shares: {
          [demoMembers[0].id]: 200,
          [demoMembers[1].id]: 200,
          [demoMembers[2].id]: 200,
        },
        sharesUsd: {
          [demoMembers[0].id]: 200,
          [demoMembers[1].id]: 200,
          [demoMembers[2].id]: 200,
        },
        pricedAt: createdAt,
        priceSource: 'stablecoin',
        createdAt,
      },
      {
        id: 'demo-expense-infra',
        groupId: demoGroup.id,
        title: 'RPC and AI credits',
        category: 'Infra',
        amount: 240,
        token: 'USDC',
        priceUsd: 1,
        amountUsd: 240,
        payerId: demoMembers[1].id,
        splitMode: 'percentage',
        shares: {
          [demoMembers[0].id]: 72,
          [demoMembers[1].id]: 96,
          [demoMembers[2].id]: 72,
        },
        sharesUsd: {
          [demoMembers[0].id]: 72,
          [demoMembers[1].id]: 96,
          [demoMembers[2].id]: 72,
        },
        pricedAt: createdAt,
        priceSource: 'stablecoin',
        createdAt,
      },
      {
        id: 'demo-expense-dinner',
        groupId: demoGroup.id,
        title: 'Team dinner',
        category: 'DAO Ops',
        amount: 180,
        token: 'USDC',
        priceUsd: 1,
        amountUsd: 180,
        payerId: demoMembers[2].id,
        splitMode: 'custom',
        shares: {
          [demoMembers[0].id]: 70,
          [demoMembers[1].id]: 60,
          [demoMembers[2].id]: 50,
        },
        sharesUsd: {
          [demoMembers[0].id]: 70,
          [demoMembers[1].id]: 60,
          [demoMembers[2].id]: 50,
        },
        pricedAt: createdAt,
        priceSource: 'stablecoin',
        createdAt,
      },
    ]

    applyWorkspacePayload({
      members: demoMembers,
      groups: [demoGroup],
      expenses: demoExpenses,
      settlements: [],
      selectedGroupId: demoGroup.id,
    })
    setSettlementChainId(demoGroup.chainId)
    setSettlementToken(demoGroup.settlementToken)
    setExpenseForm((current) => ({
      ...current,
      amount: '',
      payerId: demoMembers[0].id,
      title: '',
      token: demoGroup.settlementToken,
    }))
    showNotice('success', 'Three-wallet demo loaded with a shared expense graph ready to settle.')
  }

  async function handleSaveCloudWorkspace() {
    try {
      if (!wallet) {
        throw new Error('Connect a wallet before saving a cloud workspace.')
      }

      setCloud({ loading: true, message: 'Signing save...' })
      const payloadToSave = normalizeWorkspacePayload(workspacePayload)
      const authHeaders = await signWorkspaceRequest({
        owner: wallet.account,
        operation: 'save',
        payload: payloadToSave,
      })
      setCloud({ loading: true, message: 'Saving...' })
      const response = await fetch(`/api/workspace?owner=${encodeURIComponent(wallet.account)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ payload: payloadToSave }),
      })
      const payload = (await response.json()) as {
        configured?: boolean
        workspace?: { updatedAt?: string }
        error?: string
      }

      if (!response.ok) {
        throw new Error(payload.error ?? 'Cloud workspace save failed.')
      }

      if (payload.configured === false) {
        throw new Error('Supabase persistence is not configured on this deployment.')
      }

      const updatedAt = payload.workspace?.updatedAt ? new Date(payload.workspace.updatedAt).toLocaleTimeString() : 'now'
      setCloud({ loading: false, message: `Saved ${updatedAt}` })
      showNotice('success', 'Workspace saved to Supabase.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cloud workspace save failed.'
      setCloud({ loading: false, message })
      showNotice('error', message)
    }
  }

  async function handleLoadCloudWorkspace() {
    try {
      if (!wallet) {
        throw new Error('Connect a wallet before loading a cloud workspace.')
      }

      setCloud({ loading: true, message: 'Signing load...' })
      const authHeaders = await signWorkspaceRequest({
        owner: wallet.account,
        operation: 'load',
      })
      setCloud({ loading: true, message: 'Loading...' })
      const response = await fetch(`/api/workspace?owner=${encodeURIComponent(wallet.account)}`, {
        headers: authHeaders,
      })
      const payload = (await response.json()) as {
        configured?: boolean
        workspace?: { payload?: unknown; updatedAt?: string }
        error?: string
      }

      if (!response.ok) {
        throw new Error(payload.error ?? 'Cloud workspace load failed.')
      }

      if (payload.configured === false) {
        throw new Error('Supabase persistence is not configured on this deployment.')
      }

      if (!payload.workspace?.payload) {
        setCloud({ loading: false, message: 'No cloud workspace' })
        showNotice('info', 'No Supabase workspace exists for this wallet yet.')
        return
      }

      const nextWorkspace = normalizeWorkspacePayload(payload.workspace.payload)
      applyWorkspacePayload(nextWorkspace)
      const updatedAt = payload.workspace.updatedAt ? new Date(payload.workspace.updatedAt).toLocaleTimeString() : 'now'
      setCloud({ loading: false, message: `Loaded ${updatedAt}` })
      showNotice('success', 'Workspace loaded from Supabase.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cloud workspace load failed.'
      setCloud({ loading: false, message })
      showNotice('error', message)
    }
  }

  async function handleConnectWallet() {
    try {
      const nextWallet = await connectWallet()
      setWallet(nextWallet)
      setMemberForm((current) => ({
        ...current,
        wallet: nextWallet.account,
        name: current.name || `Wallet ${shortAddress(nextWallet.account)}`,
      }))
      showNotice('success', `Wallet connected: ${shortAddress(nextWallet.account)}`)
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : 'Wallet connection failed.')
    }
  }

  function handleAddWalletAsMember() {
    if (!wallet) {
      showNotice('error', 'Connect a wallet before adding it as a member.')
      return
    }

    if (walletMember) {
      showNotice('info', `${walletMember.name} is already in the member list.`)
      return
    }

    const member: Member = {
      id: makeId('member'),
      name: `Wallet ${shortAddress(wallet.account)}`,
      wallet: wallet.account,
    }

    setMembers((current) => [...current, member])
    setGroupMemberIds((current) => [...current, member.id])
    showNotice('success', 'Connected wallet added as a SplitChain member.')
  }

  function handleAddMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = memberForm.name.trim()
    const walletAddress = memberForm.wallet.trim()

    if (!name || !walletAddress) {
      showNotice('error', 'Add a name and EVM wallet address for the member.')
      return
    }

    if (!isEvmAddress(walletAddress)) {
      showNotice('error', 'Use a valid EVM address so the member can settle on-chain.')
      return
    }

    if (members.some((member) => member.wallet.toLowerCase() === walletAddress.toLowerCase())) {
      showNotice('error', 'That wallet is already in the member list.')
      return
    }

    const member: Member = {
      id: makeId('member'),
      name,
      wallet: walletAddress,
    }

    setMembers((current) => [...current, member])
    setGroupMemberIds((current) => [...current, member.id])
    setMemberForm({ name: '', wallet: '' })
    showNotice('success', `${name} was added.`)
  }

  function toggleGroupMember(memberId: string) {
    setGroupMemberIds((current) => (
      current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId]
    ))
  }

  function handleCreateGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = groupForm.name.trim()
    const pickedMembers = groupMemberIds.filter((memberId) => members.some((member) => member.id === memberId))

    if (!name) {
      showNotice('error', 'Name the group before creating it.')
      return
    }

    if (pickedMembers.length < 2) {
      showNotice('error', 'Create a group with at least two wallet members.')
      return
    }

    const group: Group = {
      id: makeId('group'),
      name,
      chainId: groupForm.chainId,
      settlementToken: groupForm.settlementToken,
      memberIds: pickedMembers,
      createdAt: new Date().toISOString(),
    }

    setGroups((current) => [...current, group])
    setSelectedGroupId(group.id)
    setGroupForm((current) => ({ ...current, name: '' }))
    showNotice('success', `${name} is ready for shared expenses.`)
  }

  function buildExpenseShares(amount: number): Record<string, number> {
    const memberIds = activeGroup?.memberIds ?? []

    if (memberIds.length === 0) {
      throw new Error('Add members to this group before adding an expense.')
    }

    if (expenseForm.splitMode === 'equal') {
      const share = amount / memberIds.length
      return memberIds.reduce<Record<string, number>>((shares, memberId) => {
        shares[memberId] = Number(share.toFixed(8))
        return shares
      }, {})
    }

    if (expenseForm.splitMode === 'percentage') {
      const percentages = memberIds.map((memberId) => Number(percentageShares[memberId] || 0))

      if (percentages.some((percent) => !Number.isFinite(percent) || percent < 0)) {
        throw new Error('Percentage splits must be valid non-negative numbers.')
      }

      const totalPercent = percentages.reduce((sum, percent) => sum + percent, 0)

      if (Math.abs(totalPercent - 100) > 0.1) {
        throw new Error('Percentage splits must add up to 100%.')
      }

      return memberIds.reduce<Record<string, number>>((shares, memberId) => {
        shares[memberId] = Number(((amount * Number(percentageShares[memberId] || 0)) / 100).toFixed(8))
        return shares
      }, {})
    }

    const customValues = memberIds.map((memberId) => Number(customShares[memberId] || 0))

    if (customValues.some((value) => !Number.isFinite(value) || value < 0)) {
      throw new Error('Custom splits must be valid non-negative amounts.')
    }

    const totalCustom = customValues.reduce((sum, value) => sum + value, 0)

    if (Math.abs(totalCustom - amount) > 0.01) {
      throw new Error(`Custom splits must add up to ${formatToken(amount, expenseForm.token)}.`)
    }

    return memberIds.reduce<Record<string, number>>((shares, memberId) => {
      shares[memberId] = Number(Number(customShares[memberId] || 0).toFixed(8))
      return shares
    }, {})
  }

  function handleAddExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    try {
      if (!activeGroup) {
        throw new Error('Create or select a group before adding an expense.')
      }

      const amount = parsePositiveInput(expenseForm.amount, 'expense amount')

      if (!expenseForm.title.trim()) {
        throw new Error('Add an expense title.')
      }

      if (!expenseForm.payerId) {
        throw new Error('Choose who paid.')
      }

      if (!activeGroup.memberIds.includes(expenseForm.payerId)) {
        throw new Error('Choose a payer from the active group.')
      }

      const priceUsd = getTokenPrice(market.assets, expenseForm.token)

      if (!priceUsd || !Number.isFinite(priceUsd)) {
        throw new Error(`No live USD price is available for ${expenseForm.token}. Refresh market data before adding this expense.`)
      }

      const shares = buildExpenseShares(amount)
      const amountUsd = Number((amount * priceUsd).toFixed(8))
      const sharesUsd = Object.fromEntries(
        Object.entries(shares).map(([memberId, shareAmount]) => [memberId, Number((shareAmount * priceUsd).toFixed(8))]),
      )
      const priceAsset = getAsset(market.assets, expenseForm.token)
      const expense: Expense = {
        id: makeId('expense'),
        groupId: activeGroup.id,
        title: expenseForm.title.trim(),
        category: expenseForm.category,
        amount,
        token: expenseForm.token,
        priceUsd,
        amountUsd,
        sharesUsd,
        pricedAt: priceAsset?.updatedAt ?? new Date().toISOString(),
        priceSource: priceAsset?.source ?? (isStableToken(expenseForm.token) ? 'stablecoin' : undefined),
        payerId: expenseForm.payerId,
        splitMode: expenseForm.splitMode,
        shares,
        createdAt: new Date().toISOString(),
      }

      setExpenses((current) => [expense, ...current])
      setExpenseForm((current) => ({ ...current, title: '', amount: '' }))
      showNotice('success', 'Expense added and balances recalculated.')
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : 'Unable to add expense.')
    }
  }

  async function handlePayTransfer(transfer: OptimizedTransfer) {
    const fromMember = members.find((member) => member.id === transfer.fromId)
    const toMember = members.find((member) => member.id === transfer.toId)
    const price = getTokenPrice(market.assets, settlementToken)
    const transferKey = `${transfer.fromId}:${transfer.toId}:${transfer.amountUsd}`

    try {
      if (!activeGroup || !fromMember || !toMember) {
        throw new Error('This settlement is missing group member data.')
      }

      if (!Number.isFinite(transfer.amountUsd) || transfer.amountUsd <= 0) {
        throw new Error('This settlement amount is invalid.')
      }

      if (!wallet) {
        throw new Error('Connect the debtor wallet before sending settlement.')
      }

      if (wallet.account.toLowerCase() !== fromMember.wallet.toLowerCase()) {
        throw new Error(`Connect ${fromMember.name}'s wallet to settle this transfer.`)
      }

      if (!isEvmAddress(toMember.wallet)) {
        throw new Error(`${toMember.name} does not have a valid EVM settlement wallet.`)
      }

      if (!getSupportedSettlementTokens(settlementChainId).includes(settlementToken)) {
        throw new Error(`${settlementToken} is not supported on ${getChain(settlementChainId).name}.`)
      }

      if (!price || !Number.isFinite(price)) {
        throw new Error(`No live USD price is available for ${settlementToken}. Refresh market data or choose another token.`)
      }

      const tokenAmount = Number((transfer.amountUsd / price).toFixed(8))

      if (!Number.isFinite(tokenAmount) || tokenAmount <= 0) {
        throw new Error('Settlement amount is too small to send.')
      }

      setPayingTransfer(transferKey)
      const transaction = await sendSettlementTransaction({
        from: wallet.account,
        to: toMember.wallet,
        amount: tokenAmount,
        token: settlementToken,
        chainId: settlementChainId,
      })

      const createdAt = new Date().toISOString()
      const settlement: SettlementRecord = {
        id: makeId('settlement'),
        groupId: activeGroup.id,
        fromId: transfer.fromId,
        toId: transfer.toId,
        amountUsd: transfer.amountUsd,
        token: settlementToken,
        tokenAmount,
        chainId: settlementChainId,
        txHash: transaction.hash,
        transferType: transaction.transferType,
        tokenContract: transaction.tokenContract,
        createdAt,
        status: 'pending',
      }

      setSettlements((current) => [settlement, ...current])
      showNotice('info', `Transaction submitted: ${shortAddress(transaction.hash)}. Waiting for confirmation.`)

      try {
        const confirmation = await waitForTransactionConfirmation(transaction.hash)

        if (confirmation.status === 'confirmed') {
          setSettlements((current) => current.map((record) => (
            record.id === settlement.id
              ? {
                  ...record,
                  blockNumber: confirmation.blockNumber,
                  confirmedAt: new Date().toISOString(),
                  status: 'confirmed',
                }
              : record
          )))
          showNotice('success', `Settlement confirmed: ${shortAddress(transaction.hash)}`)
          return
        }

        if (confirmation.status === 'failed') {
          setSettlements((current) => current.map((record) => (
            record.id === settlement.id
              ? {
                  ...record,
                  blockNumber: confirmation.blockNumber,
                  failedAt: new Date().toISOString(),
                  failureReason: confirmation.failureReason,
                  status: 'failed',
                }
              : record
          )))
          showNotice('error', `Settlement transaction failed: ${shortAddress(transaction.hash)}`)
          return
        }

        setSettlements((current) => current.map((record) => (
          record.id === settlement.id
            ? {
                ...record,
                failureReason: confirmation.failureReason,
              }
            : record
        )))
        showNotice('info', `Transaction submitted but still pending: ${shortAddress(transaction.hash)}`)
      } catch (confirmationError) {
        const confirmationMessage = confirmationError instanceof Error
          ? confirmationError.message
          : 'Unable to verify settlement confirmation.'
        setSettlements((current) => current.map((record) => (
          record.id === settlement.id
            ? {
                ...record,
                failureReason: confirmationMessage,
              }
            : record
        )))
        showNotice('info', `Transaction submitted; confirmation check needs retry: ${shortAddress(transaction.hash)}`)
      }
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : 'Settlement failed.')
    } finally {
      setPayingTransfer('')
    }
  }

  function exportWorkspace() {
    try {
      const payload = JSON.stringify(normalizeWorkspacePayload(workspacePayload), null, 2)
      const blob = new Blob([payload], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `splitchain-export-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : 'Workspace export failed.')
    }
  }

  async function handleImportWorkspace(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    try {
      const payload = normalizeWorkspacePayload(JSON.parse(await file.text()))
      applyWorkspacePayload(payload)
      showNotice('success', 'Workspace import completed.')
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : 'Workspace import failed.')
    }
  }

  function clearWorkspace() {
    setMembers([])
    setGroups([])
    setExpenses([])
    setSettlements([])
    setSelectedGroupId('')
    setGroupMemberIds([])
    setExpenseForm((current) => ({ ...current, title: '', amount: '', payerId: '' }))
    showNotice('info', 'Local workspace cleared.')
  }

  const marketLeader = getAsset(market.assets, 'ETH') ?? market.assets.find((asset) => asset.price)
  const compressionText = rawTransferCount > 0
    ? `${Math.max(rawTransferCount - optimizedTransfers.length, 0)} fewer payments`
    : 'No payment graph yet'
  const settlementChain = getChain(settlementChainId)
  const usesNativeSettlement = isNativeSettlementToken(settlementChainId, settlementToken)
  const settlementTokenContract = settlementChain.tokenContracts[settlementToken]?.address

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand-mark" href="#hero" aria-label="SplitChain home">
          <Split size={20} />
          <span>SplitChain</span>
        </a>
        <nav className="topnav" aria-label="Primary">
          <a href="#workspace">Dashboard</a>
          <a href="#builder">Create</a>
          <a href="#settlement">Settle</a>
          <a href="#analytics">Analytics</a>
        </nav>
        <button className="wallet-button" type="button" onClick={handleConnectWallet}>
          <Wallet size={18} />
          {wallet ? shortAddress(wallet.account) : 'Connect wallet'}
        </button>
      </header>

      <div className={`notice ${notice.type}`}>
        <CheckCircle2 size={17} />
        <span>{notice.message}</span>
      </div>

      <section className="hero-section" id="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <ShieldCheck size={16} />
            Wallet-native expense sharing
          </div>
          <h1>Split crypto expenses across wallets, tokens, and chains.</h1>
          <p>
            Create a shared group, add real crypto expenses, let SplitChain simplify who owes whom, then settle through
            the connected wallet with live SoSoValue pricing.
          </p>
          <div className="hero-actions">
            <a className="primary-action" href="#builder">
              Start a group
              <ArrowRight size={18} />
            </a>
            <button className="secondary-action" type="button" onClick={handleAddWalletAsMember}>
              <UserPlus size={18} />
              Add connected wallet
            </button>
            <button className="secondary-action" type="button" onClick={loadDemoWorkspace}>
              <Layers3 size={18} />
              Load 3-wallet demo
            </button>
          </div>
          <div className="market-rail" aria-label="Live market data">
            {market.loading ? (
              <span className="muted-inline">
                <Loader2 size={15} className="spin" />
                Syncing SoSoValue
              </span>
            ) : market.error ? (
              <span className="market-error">{market.error}</span>
            ) : (
              market.assets.slice(0, 5).map((asset) => (
                <span className="market-chip" key={asset.symbol}>
                  {asset.symbol}
                  <strong>{asset.price ? formatUsd(asset.price) : 'Live soon'}</strong>
                  <small>{getMarketSourceLabel(asset)}</small>
                </span>
              ))
            )}
          </div>
        </div>

        <div className="hero-stage" aria-hidden="true">
          <div className="hero">
            <img src={heroImg} className="base" width="170" height="179" alt="" />
            <div className="framework token-float red-token">
              <Coins size={24} />
              <span>USDC</span>
            </div>
            <div className="vite token-float blue-token">
              <Wallet size={22} />
              <span>Base</span>
            </div>
          </div>
          <div className="hero-ledger">
            <span>Optimized balance</span>
            <strong>{formatUsd(totalUsd)}</strong>
            <small>{compressionText}</small>
          </div>
        </div>
      </section>

      <div className="ticks"></div>

      <section className="workspace-band" id="workspace">
        <div className="section-heading">
          <span>
            <Gauge size={16} />
            Live dashboard
          </span>
          <h2>{activeGroup ? activeGroup.name : 'No active group yet'}</h2>
        </div>

        <div className="dashboard-grid">
          <div className="dashboard-main">
            <div className="toolbar-row">
              <label>
                Active group
                <select value={activeGroup?.id ?? ''} onChange={(event) => setSelectedGroupId(event.target.value)}>
                  {groups.length === 0 ? <option value="">Create a group first</option> : null}
                  {groups.map((group) => (
                    <option value={group.id} key={group.id}>{group.name}</option>
                  ))}
                </select>
              </label>
              <button className="icon-button" type="button" onClick={refreshMarket} aria-label="Refresh market data">
                <RefreshCcw size={17} />
              </button>
            </div>

            <div className="metric-strip">
              <div>
                <span>Total tracked</span>
                <strong>{formatUsd(totalUsd)}</strong>
              </div>
              <div>
                <span>Members</span>
                <strong>{activeMembers.length}</strong>
              </div>
              <div>
                <span>Expense entries</span>
                <strong>{activeExpenses.length}</strong>
              </div>
              <div>
                <span>Debt optimization</span>
                <strong>{rawTransferCount > 0 ? `${rawTransferCount} to ${optimizedTransfers.length}` : 'Ready'}</strong>
              </div>
            </div>

            <div className="balance-list">
              <div className="subhead">
                <h3>Balances</h3>
                <span>{marketLeader?.updatedAt ? `Priced ${new Date(marketLeader.updatedAt).toLocaleTimeString()}` : 'Awaiting prices'}</span>
              </div>
              {balances.length === 0 ? (
                <p className="empty-copy">Add wallet members and a group to start tracking balances.</p>
              ) : (
                balances.map((balance) => (
                  <div className="balance-row" key={balance.memberId}>
                    <span>{memberName(balance.memberId, members)}</span>
                    <strong className={balance.netUsd >= 0 ? 'positive' : 'negative'}>
                      {balance.netUsd >= 0 ? 'owed ' : 'owes '}
                      {formatUsd(Math.abs(balance.netUsd))}
                    </strong>
                  </div>
                ))
              )}
            </div>
          </div>

          <aside className="transfer-panel">
            <div className="subhead">
              <h3>Optimized transfers</h3>
              <span>{optimizedTransfers.length} settlement{optimizedTransfers.length === 1 ? '' : 's'}</span>
            </div>
            {optimizedTransfers.length === 0 ? (
              <p className="empty-copy">Once expenses are added, this engine reduces the payment graph into the fewest transfers.</p>
            ) : (
              optimizedTransfers.map((transfer) => (
                <div className="transfer-row" key={`${transfer.fromId}-${transfer.toId}-${transfer.amountUsd}`}>
                  <div>
                    <span>{memberName(transfer.fromId, members)}</span>
                    <small>pays {memberName(transfer.toId, members)}</small>
                  </div>
                  <strong>{formatUsd(transfer.amountUsd)}</strong>
                </div>
              ))
            )}
          </aside>
        </div>
      </section>

      <section className="builder-band" id="builder">
        <div className="section-heading">
          <span>
            <Plus size={16} />
            Create flow
          </span>
          <h2>Members, groups, and expenses</h2>
        </div>

        <div className="builder-grid">
          <form className="surface-form" onSubmit={handleAddMember}>
            <div className="form-title">
              <UserPlus size={18} />
              <h3>Add member</h3>
            </div>
            <label>
              Name
              <input value={memberForm.name} onChange={(event) => setMemberForm((current) => ({ ...current, name: event.target.value }))} placeholder="Aman" />
            </label>
            <label>
              Wallet address
              <input value={memberForm.wallet} onChange={(event) => setMemberForm((current) => ({ ...current, wallet: event.target.value }))} placeholder="0x..." />
            </label>
            <button type="submit">
              <Plus size={17} />
              Add member
            </button>
            <div className="member-pills">
              {members.map((member) => (
                <span key={member.id}>{member.name} · {shortAddress(member.wallet)}</span>
              ))}
            </div>
          </form>

          <form className="surface-form" onSubmit={handleCreateGroup}>
            <div className="form-title">
              <Layers3 size={18} />
              <h3>Create group</h3>
            </div>
            <label>
              Group name
              <input value={groupForm.name} onChange={(event) => setGroupForm((current) => ({ ...current, name: event.target.value }))} placeholder="ETHGlobal Bangkok Trip" />
            </label>
            <div className="field-pair">
              <label>
                Chain
                <select value={groupForm.chainId} onChange={(event) => setGroupForm((current) => ({ ...current, chainId: Number(event.target.value) }))}>
                  {chains.map((chain) => (
                    <option value={chain.id} key={chain.id}>{chain.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Token
                <select value={groupForm.settlementToken} onChange={(event) => setGroupForm((current) => ({ ...current, settlementToken: event.target.value }))}>
                  {getSupportedSettlementTokens(groupForm.chainId).map((token) => (
                    <option value={token} key={token}>{token}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="member-selector">
              {members.map((member) => (
                <label className="check-pill" key={member.id}>
                  <input checked={groupMemberIds.includes(member.id)} onChange={() => toggleGroupMember(member.id)} type="checkbox" />
                  {member.name}
                </label>
              ))}
            </div>
            <button type="submit">
              <Plus size={17} />
              Create group
            </button>
          </form>

          <form className="surface-form expense-form" onSubmit={handleAddExpense}>
            <div className="form-title">
              <CircleDollarSign size={18} />
              <h3>Add expense</h3>
            </div>
            <label>
              Expense
              <input value={expenseForm.title} onChange={(event) => setExpenseForm((current) => ({ ...current, title: event.target.value }))} placeholder="Hotel booking" />
            </label>
            <div className="field-pair">
              <label>
                Amount
                <input value={expenseForm.amount} onChange={(event) => setExpenseForm((current) => ({ ...current, amount: event.target.value }))} inputMode="decimal" placeholder="120" />
              </label>
              <label>
                Token
                <select value={expenseForm.token} onChange={(event) => setExpenseForm((current) => ({ ...current, token: event.target.value }))}>
                  {trackedTokens.map((token) => (
                    <option value={token} key={token}>{token}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="field-pair">
              <label>
                Paid by
                <select value={expenseForm.payerId} onChange={(event) => setExpenseForm((current) => ({ ...current, payerId: event.target.value }))}>
                  {activeMembers.length === 0 ? <option value="">No group members</option> : null}
                  {activeMembers.map((member) => (
                    <option value={member.id} key={member.id}>{member.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Category
                <select value={expenseForm.category} onChange={(event) => setExpenseForm((current) => ({ ...current, category: event.target.value }))}>
                  {categories.map((category) => (
                    <option value={category} key={category}>{category}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="segmented-control" role="radiogroup" aria-label="Split mode">
              {(['equal', 'percentage', 'custom'] as SplitMode[]).map((mode) => (
                <button
                  className={expenseForm.splitMode === mode ? 'active' : ''}
                  key={mode}
                  type="button"
                  onClick={() => setExpenseForm((current) => ({ ...current, splitMode: mode }))}
                >
                  {mode}
                </button>
              ))}
            </div>
            {expenseForm.splitMode !== 'equal' ? (
              <div className="split-editor">
                {activeMembers.map((member) => (
                  <label key={member.id}>
                    {member.name}
                    <input
                      value={expenseForm.splitMode === 'percentage' ? percentageShares[member.id] ?? '' : customShares[member.id] ?? ''}
                      onChange={(event) => {
                        const setter = expenseForm.splitMode === 'percentage' ? setPercentageShares : setCustomShares
                        setter((current) => ({ ...current, [member.id]: event.target.value }))
                      }}
                      inputMode="decimal"
                      placeholder={expenseForm.splitMode === 'percentage' ? '%' : expenseForm.token}
                    />
                  </label>
                ))}
              </div>
            ) : null}
            <button type="submit">
              <Plus size={17} />
              Add expense
            </button>
          </form>
        </div>
      </section>

      <section className="settlement-band" id="settlement">
        <div className="section-heading">
          <span>
            <Send size={16} />
            On-chain settlement
          </span>
          <h2>Pay the optimized graph</h2>
        </div>

        <div className="settlement-layout">
          <div className="settlement-list">
            <div className="toolbar-row">
              <label>
                Settle on
                <select value={settlementChainId} onChange={(event) => setSettlementChainId(Number(event.target.value))}>
                  {chains.map((chain) => (
                    <option value={chain.id} key={chain.id}>{chain.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Pay with
                <select value={settlementToken} onChange={(event) => setSettlementToken(event.target.value)}>
                  {supportedSettlementTokens.map((token) => (
                    <option value={token} key={token}>{token}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="recommendation-card">
              <span>Smart settlement route</span>
              <strong>{settlementRecommendation.title}</strong>
              <small>{settlementRecommendation.detail}</small>
              <div className="recommendation-meta">
                <span>{primaryIndex ? `${primaryIndex.ticker.toUpperCase()} ${formatIndexSignal(primaryIndex)}` : 'SSI index loading'}</span>
                <span>
                  {sodexSettlementTicker
                    ? `SoDEX ${readString(sodexSettlementTicker, ['symbol', 's'])}`
                    : isStableToken(settlementToken)
                      ? 'Stable token route'
                      : 'No exact SoDEX pair'}
                </span>
              </div>
            </div>

            <div className="settlement-proof">
              <span>{usesNativeSettlement ? 'Native transfer' : 'Direct ERC-20 transfer'}</span>
              <strong>
                {usesNativeSettlement
                  ? `${settlementToken} wallet transaction`
                  : `${settlementToken} transfer() call`}
              </strong>
              <small>
                {usesNativeSettlement
                  ? `${settlementChain.name} sends value directly from debtor to creditor.`
                  : `Wallet signs a direct ERC-20 transfer(); no approve() call or SplitChain allowance spender is created${settlementTokenContract ? ` (${shortAddress(settlementTokenContract)})` : ''}.`}
              </small>
            </div>

            {optimizedTransfers.length === 0 ? (
              <p className="empty-copy">There is nothing to settle for the selected group.</p>
            ) : (
              optimizedTransfers.map((transfer) => {
                const fromMember = members.find((member) => member.id === transfer.fromId)
                const toMember = members.find((member) => member.id === transfer.toId)
                const price = getTokenPrice(market.assets, settlementToken)
                const tokenAmount = price ? transfer.amountUsd / price : 0
                const transferKey = `${transfer.fromId}:${transfer.toId}:${transfer.amountUsd}`
                const walletMatches = Boolean(wallet && fromMember && wallet.account.toLowerCase() === fromMember.wallet.toLowerCase())
                const hasPendingSettlement = activeSettlements.some((settlement) => (
                  settlement.status === 'pending' &&
                  settlement.fromId === transfer.fromId &&
                  settlement.toId === transfer.toId &&
                  Math.abs(settlement.amountUsd - transfer.amountUsd) < 0.01
                ))

                return (
                  <div className="pay-row" key={transferKey}>
                    <div>
                      <span>{fromMember?.name ?? 'Member'} pays {toMember?.name ?? 'member'}</span>
                      <small>{price ? formatToken(tokenAmount, settlementToken) : 'Waiting for live token price'} on {getChain(settlementChainId).name}</small>
                    </div>
                    <button disabled={!walletMatches || !price || payingTransfer === transferKey || hasPendingSettlement} type="button" onClick={() => handlePayTransfer(transfer)}>
                      {payingTransfer === transferKey ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
                      {hasPendingSettlement ? 'Pending' : 'Pay now'}
                    </button>
                  </div>
                )
              })
            )}

            {activeSettlements.length > 0 ? (
              <div className="history-list">
                <div className="subhead">
                  <h3>Settlement history</h3>
                  <span>{activeSettlements.length} transaction{activeSettlements.length === 1 ? '' : 's'}</span>
                </div>
                {activeSettlements.slice(0, 4).map((settlement) => (
                  <a
                    className="history-row"
                    href={`${getChain(settlement.chainId).explorerTx}${settlement.txHash}`}
                    key={settlement.id}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span>{formatToken(settlement.tokenAmount, settlement.token)}</span>
                    <small>
                      {getChain(settlement.chainId).shortName} · {settlement.status === 'sent' ? 'confirmed' : settlement.status} · {settlement.transferType ?? 'tx'} · {shortAddress(settlement.txHash)}
                    </small>
                  </a>
                ))}
              </div>
            ) : null}
          </div>

          <aside className="sodex-panel">
            <div className="subhead">
              <h3>SoDEX spot signal</h3>
              <button className="icon-button" type="button" onClick={refreshSodex} aria-label="Refresh SoDEX market data">
                <RefreshCcw size={16} />
              </button>
            </div>
            {sodex.loading ? (
              <p className="empty-copy">Loading public SoDEX tickers.</p>
            ) : sodex.error ? (
              <p className="market-error">{sodex.error}</p>
            ) : (
              sodex.tickers.slice(0, 5).map((ticker, index) => {
                const symbol = readString(ticker, ['symbol', 's'])
                const price = readNumber(ticker, ['lastPx', 'lastPrice', 'price', 'close', 'c'])
                const change = readNumber(ticker, ['changePct', 'priceChangePercent', 'change24h', 'P'])

                return (
                  <div className="ticker-row" key={`${symbol || 'ticker'}-${index}`}>
                    <span>{symbol || 'Market'}</span>
                    <strong>{price ? formatUsd(price) : 'Live'}</strong>
                    {change !== undefined ? <small className={change >= 0 ? 'positive' : 'negative'}>{change.toFixed(2)}%</small> : null}
                  </div>
                )
              })
            )}
          </aside>
        </div>
      </section>

      <section className="analytics-band" id="analytics">
        <div className="section-heading">
          <span>
            <BarChart3 size={16} />
            Group analytics
          </span>
          <h2>Spending intelligence</h2>
        </div>

        <div className="analytics-grid">
          <div className="analytics-block">
            <span>Total volume</span>
            <strong>{formatUsd(totalUsd)}</strong>
            <small>{activeExpenses.length} expense record{activeExpenses.length === 1 ? '' : 's'}</small>
          </div>
          <div className="analytics-block">
            <span>Top payer</span>
            <strong>{largestPayer ? largestPayer.name : 'None yet'}</strong>
            <small>{largestPayer ? formatUsd(largestPayer.amount) : 'Add expenses to calculate'}</small>
          </div>
          <div className="analytics-block">
            <span>Optimized transfers</span>
            <strong>{optimizedTransfers.length}</strong>
            <small>{compressionText}</small>
          </div>
          <div className="analytics-block">
            <span>Connected chain</span>
            <strong>{wallet ? getChain(wallet.chainId).name : 'No wallet'}</strong>
            <small>{wallet ? shortAddress(wallet.account) : 'Connect to settle'}</small>
          </div>
          <div className="analytics-block">
            <span>SSI index</span>
            <strong>{primaryIndex ? primaryIndex.ticker.toUpperCase() : 'Loading'}</strong>
            <small>{primaryIndex ? `${formatIndexSignal(primaryIndex)} context` : 'SoSoValue Indexes'}</small>
          </div>
          <div className="analytics-block">
            <span>Settlement guard</span>
            <strong>{settlementRecommendation.token}</strong>
            <small>{settlementRecommendation.shortReason}</small>
          </div>
        </div>

        <div className="insight-columns">
          <div>
            <div className="subhead">
              <h3>Token exposure</h3>
            </div>
            {Object.keys(tokenExposure).length === 0 ? (
              <p className="empty-copy">No token exposure yet.</p>
            ) : (
              Object.entries(tokenExposure).map(([token, amount]) => (
                <div className="insight-row" key={token}>
                  <span>{token}</span>
                  <strong>{formatToken(amount, token)}</strong>
                </div>
              ))
            )}
          </div>
          <div>
            <div className="subhead">
              <h3>Categories</h3>
            </div>
            {Object.keys(categoryTotals).length === 0 ? (
              <p className="empty-copy">Categories populate as expenses are added.</p>
            ) : (
              Object.entries(categoryTotals).map(([category, amount]) => (
                <div className="insight-row" key={category}>
                  <span>{category}</span>
                  <strong>{formatUsd(amount)}</strong>
                </div>
              ))
            )}
          </div>
          <div>
            <div className="subhead">
              <h3>Market context</h3>
              <span>{indexes.loading ? 'Syncing' : indexes.updatedAt ? new Date(indexes.updatedAt).toLocaleTimeString() : 'Ready'}</span>
            </div>
            {indexes.error ? (
              <p className="market-error">{indexes.error}</p>
            ) : indexes.indexes.length === 0 ? (
              <p className="empty-copy">SoSoValue Index context is loading.</p>
            ) : (
              indexes.indexes.map((index) => (
                <div className="insight-row" key={index.ticker}>
                  <span>{index.ticker.toUpperCase()}</span>
                  <strong>{formatIndexSignal(index)}</strong>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="settings-band">
        <div className="section-heading">
          <span>
            <Settings size={16} />
            Settings
          </span>
          <h2>Data and integrations</h2>
        </div>
        <div className="settings-row">
          <div>
            <Database size={19} />
            <span>SoSoValue</span>
            <strong>{getMarketStatusCopy(market)}</strong>
          </div>
          <div>
            <Link2 size={19} />
            <span>SoDEX</span>
            <strong>{sodex.error ? 'Unavailable' : 'Public tickers'}</strong>
          </div>
          <div>
            <Gauge size={19} />
            <span>SSI Indexes</span>
            <strong>{indexes.error ? 'Unavailable' : 'Market context'}</strong>
          </div>
          <div>
            <Database size={19} />
            <span>Supabase</span>
            <strong>{cloud.message}</strong>
          </div>
          <button type="button" onClick={handleLoadCloudWorkspace} disabled={cloud.loading}>
            <Database size={17} />
            Load cloud
          </button>
          <button type="button" onClick={handleSaveCloudWorkspace} disabled={cloud.loading}>
            <Database size={17} />
            Save cloud
          </button>
          <input
            ref={importInputRef}
            className="file-input"
            type="file"
            accept="application/json"
            onChange={handleImportWorkspace}
          />
          <button type="button" onClick={() => importInputRef.current?.click()}>
            <Upload size={17} />
            Import workspace
          </button>
          <button type="button" onClick={exportWorkspace}>
            <Database size={17} />
            Export workspace
          </button>
          <button type="button" onClick={clearWorkspace}>
            <RefreshCcw size={17} />
            Clear workspace
          </button>
        </div>
      </section>
    </main>
  )
}

export default App
