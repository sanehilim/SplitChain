import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
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
  UserPlus,
  Wallet,
} from 'lucide-react'
import heroImg from './assets/hero.png'
import './App.css'
import { chains, getChain, getSupportedSettlementTokens, trackedTokens } from './data/chains'
import { usePersistentState } from './hooks/usePersistentState'
import {
  calculateBalances,
  formatToken,
  formatUsd,
  getAsset,
  getMembersForGroup,
  getRawTransferCount,
  getTokenPrice,
  isEvmAddress,
  makeId,
  memberName,
  shortAddress,
  simplifyDebts,
  toUsd,
} from './lib/finance'
import { connectWallet, getWalletState, sendSettlementTransaction } from './lib/wallet'
import type { Expense, Group, MarketAsset, MarketStatus, Member, OptimizedTransfer, SettlementRecord, SplitMode, WalletState } from './types'

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

const categories = ['Travel', 'DAO Ops', 'Subscription', 'Infra', 'Trading Group', 'Other']
const initialMarketStatus: MarketStatus = { loading: true, error: '', assets: [], updatedAt: '' }
const initialSodexState: SodexState = { loading: true, error: '', tickers: [], updatedAt: '' }

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

function App() {
  const [members, setMembers] = usePersistentState<Member[]>('splitchain:members', [])
  const [groups, setGroups] = usePersistentState<Group[]>('splitchain:groups', [])
  const [expenses, setExpenses] = usePersistentState<Expense[]>('splitchain:expenses', [])
  const [settlements, setSettlements] = usePersistentState<SettlementRecord[]>('splitchain:settlements', [])
  const [selectedGroupId, setSelectedGroupId] = usePersistentState<string>('splitchain:selected-group', '')
  const [wallet, setWallet] = useState<WalletState | null>(null)
  const [market, setMarket] = useState<MarketStatus>(initialMarketStatus)
  const [sodex, setSodex] = useState<SodexState>(initialSodexState)
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
    () => activeExpenses.reduce((sum, expense) => sum + toUsd(expense.amount, expense.token, market.assets), 0),
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
      totals[expense.category] = (totals[expense.category] ?? 0) + toUsd(expense.amount, expense.token, market.assets)
      return totals
    }, {})
  }, [activeExpenses, market.assets])
  const largestPayer = useMemo(() => {
    const paidByMember = activeExpenses.reduce<Record<string, number>>((totals, expense) => {
      totals[expense.payerId] = (totals[expense.payerId] ?? 0) + toUsd(expense.amount, expense.token, market.assets)
      return totals
    }, {})
    const [memberId, amount] = Object.entries(paidByMember).sort((a, b) => b[1] - a[1])[0] ?? []
    return memberId ? { name: memberName(memberId, members), amount } : null
  }, [activeExpenses, market.assets, members])

  const refreshMarket = useCallback(async () => {
    setMarket((current) => ({ ...current, loading: true, error: '' }))

    try {
      const response = await fetch(`/api/market/assets?symbols=${encodeURIComponent(marketSymbols)}`)
      const payload = (await response.json()) as { assets?: MarketAsset[]; error?: string }

      if (!response.ok || !payload.assets) {
        throw new Error(payload.error ?? 'Unable to load market data.')
      }

      setMarket({
        loading: false,
        error: '',
        assets: payload.assets,
        updatedAt: new Date().toISOString(),
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
      const response = await fetch('/api/sodex/tickers')
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

  useEffect(() => {
    refreshMarket()
    const refreshTimer = window.setInterval(refreshMarket, 30_000)
    return () => window.clearInterval(refreshTimer)
  }, [refreshMarket])

  useEffect(() => {
    refreshSodex()
  }, [refreshSodex])

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

    const handleAccountsChanged = (accountsValue: unknown) => {
      const accounts = Array.isArray(accountsValue) ? accountsValue : []
      const account = typeof accounts[0] === 'string' ? accounts[0] : ''

      if (!account) {
        setWallet(null)
        return
      }

      setWallet((current) => ({ account, chainId: current?.chainId ?? 0 }))
    }
    const handleChainChanged = (chainIdValue: unknown) => {
      const chainId = typeof chainIdValue === 'string' ? Number.parseInt(chainIdValue, 16) : Number(chainIdValue)
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
    if (!selectedGroupId && groups[0]) {
      setSelectedGroupId(groups[0].id)
    }
  }, [groups, selectedGroupId, setSelectedGroupId])

  useEffect(() => {
    if (members.length > 0 && groupMemberIds.length === 0) {
      setGroupMemberIds(members.map((member) => member.id))
    }
  }, [groupMemberIds.length, members])

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

      const amount = Number(expenseForm.amount)

      if (!expenseForm.title.trim()) {
        throw new Error('Add an expense title.')
      }

      if (!amount || amount <= 0) {
        throw new Error('Enter a positive expense amount.')
      }

      if (!expenseForm.payerId) {
        throw new Error('Choose who paid.')
      }

      const shares = buildExpenseShares(amount)
      const expense: Expense = {
        id: makeId('expense'),
        groupId: activeGroup.id,
        title: expenseForm.title.trim(),
        category: expenseForm.category,
        amount,
        token: expenseForm.token,
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

      if (!wallet) {
        throw new Error('Connect the debtor wallet before sending settlement.')
      }

      if (wallet.account.toLowerCase() !== fromMember.wallet.toLowerCase()) {
        throw new Error(`Connect ${fromMember.name}'s wallet to settle this transfer.`)
      }

      if (!isEvmAddress(toMember.wallet)) {
        throw new Error(`${toMember.name} does not have a valid EVM settlement wallet.`)
      }

      if (!price) {
        throw new Error(`No live USD price is available for ${settlementToken}. Refresh market data or choose another token.`)
      }

      const tokenAmount = Number((transfer.amountUsd / price).toFixed(8))

      if (tokenAmount <= 0) {
        throw new Error('Settlement amount is too small to send.')
      }

      setPayingTransfer(transferKey)
      const txHash = await sendSettlementTransaction({
        from: wallet.account,
        to: toMember.wallet,
        amount: tokenAmount,
        token: settlementToken,
        chainId: settlementChainId,
      })

      const settlement: SettlementRecord = {
        id: makeId('settlement'),
        groupId: activeGroup.id,
        fromId: transfer.fromId,
        toId: transfer.toId,
        amountUsd: transfer.amountUsd,
        token: settlementToken,
        tokenAmount,
        chainId: settlementChainId,
        txHash,
        createdAt: new Date().toISOString(),
        status: 'sent',
      }

      setSettlements((current) => [settlement, ...current])
      showNotice('success', `Settlement sent: ${shortAddress(txHash)}`)
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : 'Settlement failed.')
    } finally {
      setPayingTransfer('')
    }
  }

  function exportWorkspace() {
    const payload = JSON.stringify({ members, groups, expenses, settlements }, null, 2)
    const blob = new Blob([payload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `splitchain-export-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
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

                return (
                  <div className="pay-row" key={transferKey}>
                    <div>
                      <span>{fromMember?.name ?? 'Member'} pays {toMember?.name ?? 'member'}</span>
                      <small>{price ? formatToken(tokenAmount, settlementToken) : 'Waiting for live token price'} on {getChain(settlementChainId).name}</small>
                    </div>
                    <button disabled={!walletMatches || !price || payingTransfer === transferKey} type="button" onClick={() => handlePayTransfer(transfer)}>
                      {payingTransfer === transferKey ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
                      Pay now
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
                    <small>{shortAddress(settlement.txHash)}</small>
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
            <strong>{market.error ? 'Needs attention' : 'Live pricing'}</strong>
          </div>
          <div>
            <Link2 size={19} />
            <span>SoDEX</span>
            <strong>{sodex.error ? 'Unavailable' : 'Public tickers'}</strong>
          </div>
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
