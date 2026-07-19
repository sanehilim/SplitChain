/// <reference types="node" />

import { createHash } from 'node:crypto'
import { recoverMessageAddress } from 'viem'
import { buildWorkspaceSyncMessage, canonicalStringify, type WorkspaceSyncOperation } from '../src/lib/workspaceAuth.js'

export type Currency = {
  currency_id: string
  symbol: string
  name: string
}

export type CurrencySnapshot = {
  price?: number | string
  change_pct_24h?: number | string
  turnover_24h?: number | string
  high_24h?: number | string
  low_24h?: number | string
  marketcap?: number | string
  marketcap_rank?: number
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

export type MarketAssetResponse = {
  assets: MarketAsset[]
  fallbackReason?: string
  source: 'sosovalue' | 'mixed' | 'fallback'
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

export type MacroEvent = {
  date: string
  events: string[]
}

export type MacroEventsResponse = {
  events: MacroEvent[]
  fallbackReason?: string
  source: 'sosovalue-macro' | 'sosovalue-macro-unavailable'
  updatedAt: string
}

export type WorkspacePayload = {
  members: unknown[]
  groups: unknown[]
  expenses: unknown[]
  settlements: unknown[]
  selectedGroupId?: string
}

export type WorkspaceAuth = {
  operation?: WorkspaceSyncOperation
  payloadHash?: string
  signedAt?: string
  signature?: string
}

export type CloudWorkspace = {
  owner: string
  payload: WorkspacePayload
  updatedAt: string
}

type CacheEntry<T> = {
  expiresAt: number
  value: T
}

type RateLimitBucket = {
  count: number
  resetAt: number
}

export class PublicRateLimitError extends Error {
  statusCode = 429
}

const currencyCache: CacheEntry<Currency[]> = { expiresAt: 0, value: [] }
const snapshotCache = new Map<string, CacheEntry<CurrencySnapshot>>()
const indexListCache: CacheEntry<string[]> = { expiresAt: 0, value: [] }
const indexSnapshotCache = new Map<string, CacheEntry<Record<string, unknown>>>()
const macroEventsCache = new Map<string, CacheEntry<MacroEvent[]>>()
const publicRateLimitBuckets = new Map<string, RateLimitBucket>()
const currencyAliases: Record<string, string> = {
  MATIC: 'POL',
  POL: 'MATIC',
}
const stableSymbols = new Set(['USDC', 'USDT'])
const defaultIndexTickers = ['ssiMAG7', 'ssiLayer1']
const defaultMarketSymbols = ['USDC', 'USDT', 'ETH', 'BTC', 'SOL', 'MATIC', 'BNB']
const maxMarketSymbols = 12
const maxIndexTickers = 4
const maxSodexSymbols = 8
const defaultMacroLookaheadDays = 14
const maxMacroLookaheadDays = 90
const maxMacroEvents = 30
const publicRateLimitWindowMs = 60 * 1000
const publicRateLimitMaxRequests = 60
const maxWorkspaceMembers = 100
const maxWorkspaceGroups = 50
const maxWorkspaceExpenses = 500
const maxWorkspaceSettlements = 500
const workspaceSignatureMaxAgeMs = 5 * 60 * 1000
const sodexSymbols: Record<string, string> = {
  BTC: 'vBTC_vUSDC',
  ETH: 'vETH_vUSDC',
  SOL: 'vSOL_vUSDC',
  BNB: 'vBNB_vUSDC',
}

export function resetApiCachesForTests(): void {
  currencyCache.expiresAt = 0
  currencyCache.value = []
  snapshotCache.clear()
  indexListCache.expiresAt = 0
  indexListCache.value = []
  indexSnapshotCache.clear()
  macroEventsCache.clear()
  publicRateLimitBuckets.clear()
}

export function getSosoBase(): string {
  return readEnvString(process.env.SOSOVALUE_API_BASE) ?? 'https://openapi.sosovalue.com/openapi/v1'
}

export function getSodexSpotBase(): string {
  return readEnvString(process.env.SODEX_SPOT_BASE) ?? 'https://testnet-gw.sodex.dev/api/v1/spot'
}

export function getHealthPayload() {
  return {
    ok: true,
    sosoConfigured: Boolean(process.env.SOSOVALUE_API_KEY),
    sosoBase: getSosoBase(),
    sodexSpotBase: getSodexSpotBase(),
    supabaseConfigured: Boolean(getSupabaseConfig()),
    updatedAt: new Date().toISOString(),
  }
}

export function readClientRateLimitKey(headers: Record<string, unknown> | undefined, fallback = 'anonymous'): string {
  const forwardedFor = readHeader(headers, 'x-forwarded-for')
  const realIp = readHeader(headers, 'x-real-ip')
  const cfIp = readHeader(headers, 'cf-connecting-ip')
  const rawKey = (forwardedFor.split(',')[0] || realIp || cfIp || fallback).trim()

  return rawKey || fallback
}

export function assertPublicApiRateLimit(scope: string, key = 'anonymous'): void {
  const now = Date.now()
  const bucketKey = `${scope}:${key}`
  const bucket = publicRateLimitBuckets.get(bucketKey)

  if (!bucket || now >= bucket.resetAt) {
    publicRateLimitBuckets.set(bucketKey, {
      count: 1,
      resetAt: now + publicRateLimitWindowMs,
    })
    return
  }

  bucket.count += 1

  if (bucket.count > publicRateLimitMaxRequests) {
    throw new PublicRateLimitError('Too many market-data requests. Please wait a minute and retry.')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readEnvString(value: string | undefined): string | undefined {
  const trimmedValue = value?.trim()
  return trimmedValue ? trimmedValue : undefined
}

function unwrapData<T>(payload: unknown): T {
  if (isRecord(payload) && typeof payload.code === 'number' && payload.code !== 0) {
    const message = typeof payload.error === 'string'
      ? payload.error
      : typeof payload.message === 'string'
        ? payload.message
        : `API request failed with code ${payload.code}`
    throw new Error(message)
  }

  if (isRecord(payload) && 'data' in payload && payload.data !== undefined) {
    return payload.data as T
  }

  return payload as T
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'unknown error'
}

async function sosoFetch<T>(route: string): Promise<T> {
  const apiKey = process.env.SOSOVALUE_API_KEY

  if (!apiKey) {
    throw new Error('SOSOVALUE_API_KEY is not configured on the server.')
  }

  const response = await fetch(`${getSosoBase()}${route}`, {
    headers: {
      Accept: 'application/json',
      'x-soso-api-key': apiKey,
    },
  })

  const payload = (await response.json().catch(() => ({}))) as unknown

  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.message === 'string'
      ? payload.message
      : `SoSoValue request failed with ${response.status}`
    throw new Error(message)
  }

  return unwrapData<T>(payload)
}

async function sodexFetch<T>(route: string): Promise<T> {
  const response = await fetch(`${getSodexSpotBase()}${route}`, {
    headers: {
      Accept: 'application/json',
    },
  })

  const payload = (await response.json().catch(() => ({}))) as unknown

  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string'
      ? payload.error
      : `SoDEX request failed with ${response.status}`
    throw new Error(message)
  }

  return unwrapData<T>(payload)
}

async function getCurrencies(): Promise<Currency[]> {
  if (Date.now() < currencyCache.expiresAt) {
    return currencyCache.value
  }

  const currencies = await sosoFetch<Currency[]>('/currencies')
  currencyCache.value = currencies
  currencyCache.expiresAt = Date.now() + 60 * 60 * 1000
  return currencies
}

async function getSnapshot(currencyId: string): Promise<CurrencySnapshot> {
  const cached = snapshotCache.get(currencyId)

  if (cached && Date.now() < cached.expiresAt) {
    return cached.value
  }

  const snapshot = await sosoFetch<CurrencySnapshot>(`/currencies/${currencyId}/market-snapshot`)
  snapshotCache.set(currencyId, {
    expiresAt: Date.now() + 30 * 1000,
    value: snapshot,
  })
  return snapshot
}

async function getIndexTickers(): Promise<string[]> {
  if (Date.now() < indexListCache.expiresAt) {
    return indexListCache.value
  }

  const tickers = await sosoFetch<string[]>('/indices')
  indexListCache.value = tickers
  indexListCache.expiresAt = Date.now() + 60 * 1000
  return indexListCache.value
}

async function getIndexSnapshot(ticker: string): Promise<Record<string, unknown>> {
  const normalizedTicker = ticker.toLowerCase()
  const cached = indexSnapshotCache.get(normalizedTicker)

  if (cached && Date.now() < cached.expiresAt) {
    return cached.value
  }

  const snapshot = await sosoFetch<Record<string, unknown>>(`/indices/${encodeURIComponent(ticker)}/market-snapshot`)
  indexSnapshotCache.set(normalizedTicker, {
    expiresAt: Date.now() + 30 * 1000,
    value: snapshot,
  })
  return snapshot
}

export function parseSymbolList(symbolsParam: unknown): string[] {
  const rawSymbols = typeof symbolsParam === 'string'
    ? symbolsParam
    : Array.isArray(symbolsParam) && typeof symbolsParam[0] === 'string'
      ? symbolsParam[0]
      : defaultMarketSymbols.join(',')

  const symbols = Array.from(
    new Set(
      rawSymbols
        .slice(0, 500)
        .split(',')
        .map((symbol) => symbol.trim().toUpperCase())
        .filter((symbol) => /^[A-Z0-9]{2,15}$/.test(symbol))
        .slice(0, maxMarketSymbols),
    ),
  )

  return symbols.length > 0 ? symbols : defaultMarketSymbols
}

export function parseIndexTickerList(tickersParam: unknown): string[] {
  const rawTickers = typeof tickersParam === 'string'
    ? tickersParam
    : Array.isArray(tickersParam) && typeof tickersParam[0] === 'string'
      ? tickersParam[0]
      : defaultIndexTickers.join(',')

  const tickers = Array.from(
    new Set(
      rawTickers
        .slice(0, 300)
        .split(',')
        .map((ticker) => ticker.trim().toLowerCase())
        .filter((ticker) => /^[a-z0-9]{2,32}$/.test(ticker))
        .slice(0, maxIndexTickers),
    ),
  )

  return tickers.length > 0 ? tickers : defaultIndexTickers.map((ticker) => ticker.toLowerCase())
}

export function parseMacroLookaheadDays(daysParam: unknown): number {
  const rawDays = typeof daysParam === 'string'
    ? Number(daysParam)
    : Array.isArray(daysParam) && typeof daysParam[0] === 'string'
      ? Number(daysParam[0])
      : defaultMacroLookaheadDays

  if (!Number.isFinite(rawDays)) {
    return defaultMacroLookaheadDays
  }

  return Math.min(Math.max(Math.trunc(rawDays), 1), maxMacroLookaheadDays)
}

function parseSodexSymbolList(symbolsParam: unknown): string[] {
  const rawSymbols = typeof symbolsParam === 'string'
    ? symbolsParam
    : Array.isArray(symbolsParam) && typeof symbolsParam[0] === 'string'
      ? symbolsParam[0]
      : Object.values(sodexSymbols).join(',')

  return Array.from(
    new Set(
      rawSymbols
        .slice(0, 500)
        .split(',')
        .map((symbol) => symbol.trim())
        .filter((symbol) => /^[A-Za-z0-9]+_[A-Za-z0-9]+$/.test(symbol))
        .slice(0, maxSodexSymbols),
    ),
  )
}

export async function getMarketAssets(symbolsParam: unknown): Promise<MarketAssetResponse> {
  const symbols = parseSymbolList(symbolsParam)
  const updatedAt = new Date().toISOString()

  try {
    const sosoAssets = await getSosoMarketAssets(symbols)
    const assetsBySymbol = new Map(sosoAssets.map((asset) => [asset.symbol, asset]))
    const symbolsNeedingFallback = sosoAssets
      .filter((asset) => asset.source === 'missing' || !asset.price)
      .map((asset) => asset.symbol)

    if (symbolsNeedingFallback.length === 0) {
      return {
        assets: sosoAssets,
        source: 'sosovalue',
        updatedAt,
      }
    }

    const fallbackAssets = await getFallbackMarketAssets(symbolsNeedingFallback, 'SoSoValue did not return a live price for this symbol.')

    fallbackAssets.forEach((asset) => {
      if (asset.source !== 'missing' || !assetsBySymbol.get(asset.symbol)?.price) {
        assetsBySymbol.set(asset.symbol, asset)
      }
    })

    return {
      assets: symbols.map((symbol) => assetsBySymbol.get(symbol) ?? { symbol, source: 'missing', updatedAt }),
      fallbackReason: `${symbolsNeedingFallback.join(', ')} used fallback pricing or remained unavailable.`,
      source: 'mixed',
      updatedAt,
    }
  } catch (error) {
    const fallbackReason = `SoSoValue unavailable: ${readErrorMessage(error)}`
    return {
      assets: await getFallbackMarketAssets(symbols, fallbackReason),
      fallbackReason,
      source: 'fallback',
      updatedAt,
    }
  }
}

async function getSosoMarketAssets(symbols: string[]): Promise<MarketAsset[]> {
  const volatileSymbols = symbols.filter((symbol) => !stableSymbols.has(symbol))
  const currencies = volatileSymbols.length > 0 ? await getCurrencies() : []
  const bySymbol = new Map(currencies.map((currency) => [currency.symbol.toUpperCase(), currency]))
  const snapshotsByCurrencyId = new Map<string, Promise<CurrencySnapshot>>()
  const updatedAt = new Date().toISOString()

  function getDedupedSnapshot(currencyId: string): Promise<CurrencySnapshot> {
    const cachedPromise = snapshotsByCurrencyId.get(currencyId)

    if (cachedPromise) {
      return cachedPromise
    }

    const snapshotPromise = getSnapshot(currencyId)
    snapshotsByCurrencyId.set(currencyId, snapshotPromise)
    return snapshotPromise
  }

  return Promise.all(
    symbols.map(async (symbol): Promise<MarketAsset> => {
      if (stableSymbols.has(symbol)) {
        return {
          symbol,
          name: symbol,
          price: 1,
          changePct24h: 0,
          source: 'stablecoin',
          updatedAt,
        }
      }

      const currency = bySymbol.get(symbol) ?? bySymbol.get(currencyAliases[symbol] ?? '')

      if (!currency) {
        return { symbol, source: 'missing', updatedAt }
      }

      let snapshot: CurrencySnapshot

      try {
        snapshot = await getDedupedSnapshot(currency.currency_id)
      } catch (error) {
        return {
          symbol,
          name: currency.name,
          currencyId: currency.currency_id,
          resolvedSymbol: currency.symbol,
          source: 'missing',
          fallbackReason: `SoSoValue snapshot unavailable: ${readErrorMessage(error)}`,
          updatedAt,
        }
      }

      return {
        symbol,
        name: currency.name,
        currencyId: currency.currency_id,
        resolvedSymbol: currency.symbol,
        price: asNumber(snapshot.price),
        changePct24h: asNumber(snapshot.change_pct_24h),
        turnover24h: asNumber(snapshot.turnover_24h),
        marketCap: asNumber(snapshot.marketcap),
        high24h: asNumber(snapshot.high_24h),
        low24h: asNumber(snapshot.low_24h),
        rank: snapshot.marketcap_rank,
        source: 'sosovalue',
        updatedAt,
      }
    }),
  )
}

export async function getIndexSnapshots(tickersParam: unknown): Promise<{
  indexes: IndexSnapshot[]
  source: string
  updatedAt: string
}> {
  const requestedTickers = parseIndexTickerList(tickersParam)
  const updatedAt = new Date().toISOString()

  try {
    const availableTickers = await getIndexTickers()
    const availableByLowercase = new Map(availableTickers.map((ticker) => [ticker.toLowerCase(), ticker]))
    const selectedTickers = requestedTickers
      .map((ticker) => availableByLowercase.get(ticker.toLowerCase()))
      .filter((ticker): ticker is string => Boolean(ticker))
    const tickers = selectedTickers.length > 0 ? selectedTickers : availableTickers.slice(0, 2)

    return {
      indexes: await Promise.all(tickers.map((ticker) => getSosoIndexSnapshot(ticker))),
      source: getSosoBase(),
      updatedAt,
    }
  } catch {
    return {
      indexes: requestedTickers.map((ticker) => ({ ticker, source: 'missing', updatedAt })),
      source: 'sosovalue-index-unavailable',
      updatedAt,
    }
  }
}

async function getSosoIndexSnapshot(ticker: string): Promise<IndexSnapshot> {
  const snapshot = await getIndexSnapshot(ticker)
  const updatedAt = new Date().toISOString()

  return {
    ticker,
    price: asNumber(snapshot.price),
    changePct24h: asNumber(snapshot['24h_change_pct']),
    roi7d: asNumber(snapshot['7day_roi']),
    roi1m: asNumber(snapshot['1month_roi']),
    roi3m: asNumber(snapshot['3month_roi']),
    roi1y: asNumber(snapshot['1year_roi']),
    ytd: asNumber(snapshot.ytd),
    source: 'sosovalue-index',
    updatedAt,
  }
}

function readDateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addUtcDays(date: Date, days: number): Date {
  const nextDate = new Date(date)
  nextDate.setUTCDate(nextDate.getUTCDate() + days)
  return nextDate
}

function readMacroDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return ''
  }

  const parsed = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed) ? value : ''
}

export function normalizeMacroEvents(payload: unknown, lookaheadDays: number, now = new Date()): MacroEvent[] {
  if (!Array.isArray(payload)) {
    return []
  }

  const today = readDateKey(now)
  const windowEnd = readDateKey(addUtcDays(now, lookaheadDays))

  return payload
    .map((entry): MacroEvent | null => {
      if (!isRecord(entry)) {
        return null
      }

      const date = readMacroDate(entry.date)
      const events = Array.isArray(entry.events)
        ? Array.from(new Set(
            entry.events
              .map((event) => (typeof event === 'string' ? event.trim() : ''))
              .filter(Boolean)
              .slice(0, 12),
          ))
        : []

      if (!date || events.length === 0 || date < today || date > windowEnd) {
        return null
      }

      return { date, events }
    })
    .filter((entry): entry is MacroEvent => Boolean(entry))
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(0, maxMacroEvents)
}

export async function getMacroEvents(daysParam: unknown, now = new Date()): Promise<MacroEventsResponse> {
  const lookaheadDays = parseMacroLookaheadDays(daysParam)
  const cacheKey = `${lookaheadDays}:${readDateKey(now)}`
  const cached = macroEventsCache.get(cacheKey)
  const updatedAt = new Date().toISOString()

  if (cached && Date.now() < cached.expiresAt) {
    return {
      events: cached.value,
      source: 'sosovalue-macro',
      updatedAt,
    }
  }

  try {
    const payload = await sosoFetch<unknown[]>('/macro/events')
    const events = normalizeMacroEvents(payload, lookaheadDays, now)
    macroEventsCache.set(cacheKey, {
      expiresAt: Date.now() + 15 * 60 * 1000,
      value: events,
    })

    return {
      events,
      source: 'sosovalue-macro',
      updatedAt,
    }
  } catch (error) {
    return {
      events: [],
      fallbackReason: `SoSoValue Macro unavailable: ${readErrorMessage(error)}`,
      source: 'sosovalue-macro-unavailable',
      updatedAt,
    }
  }
}

export async function getSodexTickers(symbolParam: unknown, symbolsParam?: unknown): Promise<{
  requestedSymbols: string[]
  tickers: unknown[]
  source: string
  updatedAt: string
}> {
  const symbol = typeof symbolParam === 'string'
    ? symbolParam
    : Array.isArray(symbolParam) && typeof symbolParam[0] === 'string'
      ? symbolParam[0]
      : ''
  const requestedSymbols = symbol && /^[A-Za-z0-9]+_[A-Za-z0-9]+$/.test(symbol)
    ? [symbol]
    : parseSodexSymbolList(symbolsParam)
  const tickerResults = await Promise.all(
    requestedSymbols.map(async (requestedSymbol) => {
      try {
        const tickers = await sodexFetch<unknown[]>(`/markets/tickers?symbol=${encodeURIComponent(requestedSymbol)}`)
        return Array.isArray(tickers) ? tickers : []
      } catch {
        return []
      }
    }),
  )

  return {
    requestedSymbols,
    tickers: tickerResults.flat().slice(0, 12),
    source: getSodexSpotBase(),
    updatedAt: new Date().toISOString(),
  }
}

async function getFallbackMarketAssets(symbols: string[], fallbackReason?: string): Promise<MarketAsset[]> {
  const updatedAt = new Date().toISOString()

  return Promise.all(
    symbols.map(async (symbol): Promise<MarketAsset> => {
      if (stableSymbols.has(symbol)) {
        return {
          symbol,
          name: symbol,
          price: 1,
          changePct24h: 0,
          fallbackReason,
          source: 'stablecoin',
          updatedAt,
        }
      }

      const sodexSymbol = sodexSymbols[symbol]

      if (!sodexSymbol) {
        return { symbol, fallbackReason: fallbackReason ?? 'No SoDEX fallback pair is configured for this symbol.', source: 'missing', updatedAt }
      }

      try {
        const tickers = await sodexFetch<unknown[]>(`/markets/tickers?symbol=${encodeURIComponent(sodexSymbol)}`)
        const ticker = Array.isArray(tickers) ? tickers[0] : undefined

        if (!isRecord(ticker)) {
          return { symbol, fallbackReason: fallbackReason ?? 'SoDEX fallback ticker was unavailable.', source: 'missing', updatedAt }
        }

        const price = readTickerNumber(ticker, ['lastPx', 'lastPrice', 'price', 'close', 'c'])

        if (!price || price <= 0) {
          return { symbol, fallbackReason: fallbackReason ?? 'SoDEX fallback did not return a usable price.', source: 'missing', updatedAt }
        }

        return {
          symbol,
          name: symbol,
          price,
          changePct24h: readTickerNumber(ticker, ['changePct', 'priceChangePercent', 'change24h', 'P']),
          turnover24h: readTickerNumber(ticker, ['quoteVolume', 'turnover_24h']),
          high24h: readTickerNumber(ticker, ['highPx', 'high_24h']),
          low24h: readTickerNumber(ticker, ['lowPx', 'low_24h']),
          fallbackReason,
          resolvedSymbol: sodexSymbol,
          source: 'sodex',
          updatedAt,
        }
      } catch (error) {
        return { symbol, fallbackReason: fallbackReason ?? `SoDEX fallback unavailable: ${readErrorMessage(error)}`, source: 'missing', updatedAt }
      }
    }),
  )
}

function readTickerNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key]
    const parsed = asNumber(value)

    if (parsed !== undefined) {
      return parsed
    }
  }

  return undefined
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY
  const table = process.env.SUPABASE_WORKSPACE_TABLE ?? 'splitchain_workspaces'

  if (!url || !key) {
    return null
  }

  return { key, table, url }
}

function normalizeWorkspaceOwner(ownerParam: unknown): string {
  const owner = typeof ownerParam === 'string'
    ? ownerParam
    : Array.isArray(ownerParam) && typeof ownerParam[0] === 'string'
      ? ownerParam[0]
      : ''
  const normalizedOwner = owner.trim().toLowerCase()

  if (!/^0x[a-f0-9]{40}$/.test(normalizedOwner)) {
    throw new Error('A valid wallet owner is required for cloud persistence.')
  }

  return normalizedOwner
}

type WorkspaceMember = {
  id: string
  name: string
  wallet: string
}

type WorkspaceGroup = {
  id: string
  name: string
  chainId: number
  settlementToken: string
  memberIds: string[]
  createdAt: string
}

type WorkspaceExpense = {
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
  priceSource?: 'sosovalue' | 'sodex' | 'stablecoin' | 'missing'
  payerId: string
  splitMode: string
  shares: Record<string, number>
  createdAt: string
}

type WorkspaceSettlement = {
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
  status: 'pending' | 'confirmed' | 'failed'
}

function readWorkspaceString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readWorkspacePositiveNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function readWorkspaceNonNegativeNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function readWorkspaceChainId(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function readWorkspaceDate(value: unknown): string {
  return readWorkspaceString(value) || new Date().toISOString()
}

function normalizeWorkspaceSettlementToken(chainId: number, token: string): string {
  const normalizedToken = token.toUpperCase()
  return chainId === 137 && normalizedToken === 'MATIC' ? 'POL' : normalizedToken
}

function normalizeWorkspaceShares(value: unknown, memberIds: string[]): Record<string, number> {
  if (!isRecord(value)) {
    return {}
  }

  return memberIds.reduce<Record<string, number>>((shares, memberId) => {
    const amount = readWorkspacePositiveNumber(value[memberId])

    if (amount !== null) {
      shares[memberId] = amount
    }

    return shares
  }, {})
}

function normalizeWorkspaceSharesUsd(value: unknown, memberIds: string[]): Record<string, number> | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const sharesUsd = memberIds.reduce<Record<string, number>>((shares, memberId) => {
    const amount = readWorkspaceNonNegativeNumber(value[memberId])

    if (amount !== null) {
      shares[memberId] = amount
    }

    return shares
  }, {})

  return Object.keys(sharesUsd).length > 0 ? sharesUsd : undefined
}

function normalizeWorkspaceSettlementStatus(value: unknown): WorkspaceSettlement['status'] {
  if (value === 'pending' || value === 'confirmed' || value === 'failed') {
    return value
  }

  return 'confirmed'
}

function normalizeWorkspacePayload(payload: unknown): WorkspacePayload {
  if (!isRecord(payload)) {
    throw new Error('Workspace payload is required.')
  }

  const members = (Array.isArray(payload.members) ? payload.members : [])
    .slice(0, maxWorkspaceMembers)
    .map((member): WorkspaceMember | null => {
      if (!isRecord(member)) {
        return null
      }

      const id = readWorkspaceString(member.id)
      const name = readWorkspaceString(member.name)
      const wallet = readWorkspaceString(member.wallet)

      if (!id || !name || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
        return null
      }

      return { id, name, wallet }
    })
    .filter((member): member is WorkspaceMember => Boolean(member))
  const memberIds = new Set(members.map((member) => member.id))
  const groups = (Array.isArray(payload.groups) ? payload.groups : [])
    .slice(0, maxWorkspaceGroups)
    .map((group): WorkspaceGroup | null => {
      if (!isRecord(group)) {
        return null
      }

      const id = readWorkspaceString(group.id)
      const name = readWorkspaceString(group.name)
      const chainId = readWorkspaceChainId(group.chainId)
      const groupMemberIds = Array.isArray(group.memberIds)
        ? Array.from(new Set(group.memberIds.map(readWorkspaceString).filter((memberId) => memberIds.has(memberId))))
        : []

      if (!id || !name || chainId === null || groupMemberIds.length < 2) {
        return null
      }

      return {
        id,
        name,
        chainId,
        settlementToken: normalizeWorkspaceSettlementToken(chainId, readWorkspaceString(group.settlementToken)) || 'USDC',
        memberIds: groupMemberIds,
        createdAt: readWorkspaceDate(group.createdAt),
      }
    })
    .filter((group): group is WorkspaceGroup => Boolean(group))
  const groupsById = new Map(groups.map((group) => [group.id, group]))
  const expenses = (Array.isArray(payload.expenses) ? payload.expenses : [])
    .slice(0, maxWorkspaceExpenses)
    .map((expense): WorkspaceExpense | null => {
      if (!isRecord(expense)) {
        return null
      }

      const group = groupsById.get(readWorkspaceString(expense.groupId))
      const amount = readWorkspacePositiveNumber(expense.amount)
      const payerId = readWorkspaceString(expense.payerId)
      const priceUsd = readWorkspacePositiveNumber(expense.priceUsd) ?? undefined
      const amountUsd = readWorkspacePositiveNumber(expense.amountUsd) ?? undefined
      const sharesUsd = normalizeWorkspaceSharesUsd(expense.sharesUsd, group?.memberIds ?? [])
      const pricedAt = readWorkspaceString(expense.pricedAt)
      const priceSource = readWorkspaceString(expense.priceSource)

      if (!group || amount === null || !group.memberIds.includes(payerId)) {
        return null
      }

      const shares = normalizeWorkspaceShares(expense.shares, group.memberIds)

      if (Object.keys(shares).length === 0) {
        return null
      }

      const splitMode = readWorkspaceString(expense.splitMode)

      return {
        id: readWorkspaceString(expense.id) || `expense-${crypto.randomUUID()}`,
        groupId: group.id,
        title: readWorkspaceString(expense.title) || 'Imported expense',
        category: readWorkspaceString(expense.category) || 'Other',
        amount,
        token: readWorkspaceString(expense.token).toUpperCase() || group.settlementToken,
        ...(priceUsd ? { priceUsd } : {}),
        ...(amountUsd ? { amountUsd } : {}),
        ...(sharesUsd ? { sharesUsd } : {}),
        ...(pricedAt ? { pricedAt } : {}),
        ...(['sosovalue', 'sodex', 'stablecoin', 'missing'].includes(priceSource) ? { priceSource: priceSource as WorkspaceExpense['priceSource'] } : {}),
        payerId,
        splitMode: ['equal', 'percentage', 'custom'].includes(splitMode) ? splitMode : 'equal',
        shares,
        createdAt: readWorkspaceDate(expense.createdAt),
      }
    })
    .filter((expense): expense is WorkspaceExpense => Boolean(expense))
  const settlements = (Array.isArray(payload.settlements) ? payload.settlements : [])
    .slice(0, maxWorkspaceSettlements)
    .map((settlement): WorkspaceSettlement | null => {
      if (!isRecord(settlement)) {
        return null
      }

      const group = groupsById.get(readWorkspaceString(settlement.groupId))
      const amountUsd = readWorkspacePositiveNumber(settlement.amountUsd)
      const tokenAmount = readWorkspacePositiveNumber(settlement.tokenAmount)
      const fromId = readWorkspaceString(settlement.fromId)
      const toId = readWorkspaceString(settlement.toId)
      const chainId = readWorkspaceChainId(settlement.chainId)
      const txHash = readWorkspaceString(settlement.txHash)
      const status = normalizeWorkspaceSettlementStatus(settlement.status)
      const confirmedAt = readWorkspaceString(settlement.confirmedAt)
      const failedAt = readWorkspaceString(settlement.failedAt)
      const failureReason = readWorkspaceString(settlement.failureReason)
      const blockNumber = readWorkspaceString(settlement.blockNumber)

      if (
        !group ||
        amountUsd === null ||
        tokenAmount === null ||
        chainId === null ||
        !group.memberIds.includes(fromId) ||
        !group.memberIds.includes(toId) ||
        !/^0x[a-fA-F0-9]+$/.test(txHash)
      ) {
        return null
      }

      return {
        id: readWorkspaceString(settlement.id) || `settlement-${crypto.randomUUID()}`,
        groupId: group.id,
        fromId,
        toId,
        amountUsd,
        token: normalizeWorkspaceSettlementToken(chainId, readWorkspaceString(settlement.token)) || group.settlementToken,
        tokenAmount,
        chainId,
        txHash,
        transferType: settlement.transferType === 'native' || settlement.transferType === 'erc20' ? settlement.transferType : undefined,
        tokenContract: readWorkspaceString(settlement.tokenContract) || undefined,
        ...(confirmedAt ? { confirmedAt } : {}),
        ...(failedAt ? { failedAt } : {}),
        ...(failureReason ? { failureReason } : {}),
        ...(blockNumber ? { blockNumber } : {}),
        createdAt: readWorkspaceDate(settlement.createdAt),
        status,
      }
    })
    .filter((settlement): settlement is WorkspaceSettlement => Boolean(settlement))
  const selectedGroupId = readWorkspaceString(payload.selectedGroupId)

  return {
    members,
    groups,
    expenses,
    settlements,
    selectedGroupId: groupsById.has(selectedGroupId) ? selectedGroupId : groups[0]?.id,
  }
}

function getSupabaseHeaders(key: string) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${key}`,
    apikey: key,
  }
}

function readSupabaseError(payload: unknown, fallback: string): string {
  if (isRecord(payload)) {
    if (typeof payload.message === 'string') {
      return payload.message
    }

    if (typeof payload.details === 'string') {
      return payload.details
    }
  }

  return fallback
}

function readHeader(headers: Record<string, unknown> | undefined, name: string): string {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()]

  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : ''
  }

  return typeof value === 'string' ? value : ''
}

export function readWorkspaceAuth(headers: Record<string, unknown> | undefined): WorkspaceAuth {
  const operation = readHeader(headers, 'x-splitchain-operation')

  return {
    operation: operation === 'load' || operation === 'save' ? operation : undefined,
    payloadHash: readHeader(headers, 'x-splitchain-payload-hash'),
    signedAt: readHeader(headers, 'x-splitchain-signed-at'),
    signature: readHeader(headers, 'x-splitchain-signature'),
  }
}

function hashWorkspacePayload(payload: WorkspacePayload): string {
  return createHash('sha256').update(canonicalStringify(payload)).digest('hex')
}

async function verifyWorkspaceAuth(
  owner: string,
  operation: WorkspaceSyncOperation,
  payload: WorkspacePayload | undefined,
  auth: WorkspaceAuth | undefined,
): Promise<void> {
  if (!auth?.signature || !auth.signedAt || auth.operation !== operation) {
    throw new Error('A fresh wallet signature is required for cloud workspace sync.')
  }

  const signedAtTime = Date.parse(auth.signedAt)

  if (!Number.isFinite(signedAtTime) || Math.abs(Date.now() - signedAtTime) > workspaceSignatureMaxAgeMs) {
    throw new Error('Workspace signature expired. Sign the request again.')
  }

  const payloadHash = operation === 'save' && payload ? hashWorkspacePayload(payload) : undefined

  if (operation === 'save' && auth.payloadHash !== payloadHash) {
    throw new Error('Workspace signature does not match the payload being saved.')
  }

  if (!/^0x[a-fA-F0-9]+$/.test(auth.signature)) {
    throw new Error('Workspace signature is malformed.')
  }

  const message = buildWorkspaceSyncMessage({
    operation,
    owner,
    payloadHash,
    signedAt: auth.signedAt,
  })
  const recoveredAddress = await recoverMessageAddress({
    message,
    signature: auth.signature as `0x${string}`,
  })

  if (recoveredAddress.toLowerCase() !== owner) {
    throw new Error('Workspace signature does not match the owner wallet.')
  }
}

export async function getCloudWorkspace(ownerParam: unknown, authParam?: WorkspaceAuth): Promise<{
  configured: boolean
  workspace?: CloudWorkspace
}> {
  const config = getSupabaseConfig()

  if (!config) {
    return { configured: false }
  }

  const owner = normalizeWorkspaceOwner(ownerParam)
  await verifyWorkspaceAuth(owner, 'load', undefined, authParam)
  const response = await fetch(
    `${config.url}/rest/v1/${config.table}?owner=eq.${encodeURIComponent(owner)}&select=owner,payload,updated_at&limit=1`,
    { headers: getSupabaseHeaders(config.key) },
  )
  const payload = (await response.json().catch(() => null)) as unknown

  if (!response.ok) {
    throw new Error(readSupabaseError(payload, `Supabase workspace load failed with ${response.status}`))
  }

  const row = Array.isArray(payload) && isRecord(payload[0]) ? payload[0] : null

  if (!row) {
    return { configured: true }
  }

  return {
    configured: true,
    workspace: {
      owner,
      payload: normalizeWorkspacePayload(row.payload),
      updatedAt: typeof row.updated_at === 'string' ? row.updated_at : new Date().toISOString(),
    },
  }
}

export async function saveCloudWorkspace(ownerParam: unknown, payloadParam: unknown, authParam?: WorkspaceAuth): Promise<{
  configured: boolean
  workspace?: CloudWorkspace
}> {
  const config = getSupabaseConfig()

  if (!config) {
    return { configured: false }
  }

  const owner = normalizeWorkspaceOwner(ownerParam)
  const payload = normalizeWorkspacePayload(payloadParam)
  await verifyWorkspaceAuth(owner, 'save', payload, authParam)
  const updatedAt = new Date().toISOString()
  const response = await fetch(`${config.url}/rest/v1/${config.table}?on_conflict=owner`, {
    method: 'POST',
    headers: {
      ...getSupabaseHeaders(config.key),
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify([{ owner, payload, updated_at: updatedAt }]),
  })
  const responsePayload = (await response.json().catch(() => null)) as unknown

  if (!response.ok) {
    throw new Error(readSupabaseError(responsePayload, `Supabase workspace save failed with ${response.status}`))
  }

  const row = Array.isArray(responsePayload) && isRecord(responsePayload[0]) ? responsePayload[0] : null

  return {
    configured: true,
    workspace: {
      owner,
      payload: row ? normalizeWorkspacePayload(row.payload) : payload,
      updatedAt: row && typeof row.updated_at === 'string' ? row.updated_at : updatedAt,
    },
  }
}
