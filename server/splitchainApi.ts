/// <reference types="node" />

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

type CacheEntry<T> = {
  expiresAt: number
  value: T
}

const currencyCache: CacheEntry<Currency[]> = { expiresAt: 0, value: [] }
const snapshotCache = new Map<string, CacheEntry<CurrencySnapshot>>()
const currencyAliases: Record<string, string> = {
  MATIC: 'POL',
}
const stableSymbols = new Set(['USDC', 'USDT'])
const sodexSymbols: Record<string, string> = {
  BTC: 'vBTC_vUSDC',
  ETH: 'vETH_vUSDC',
  SOL: 'vSOL_vUSDC',
  BNB: 'vBNB_vUSDC',
}

export function getSosoBase(): string {
  return process.env.SOSOVALUE_API_BASE ?? 'https://openapi.sosovalue.com/openapi/v1'
}

export function getSodexSpotBase(): string {
  return process.env.SODEX_SPOT_BASE ?? 'https://testnet-gw.sodex.dev/api/v1/spot'
}

export function getHealthPayload() {
  return {
    ok: true,
    sosoConfigured: Boolean(process.env.SOSOVALUE_API_KEY),
    sosoBase: getSosoBase(),
    sodexSpotBase: getSodexSpotBase(),
    updatedAt: new Date().toISOString(),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function unwrapData<T>(payload: unknown): T {
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

export function parseSymbolList(symbolsParam: unknown): string[] {
  const rawSymbols = typeof symbolsParam === 'string'
    ? symbolsParam
    : Array.isArray(symbolsParam) && typeof symbolsParam[0] === 'string'
      ? symbolsParam[0]
      : 'USDC,USDT,ETH,BTC,SOL,MATIC,BNB'

  return Array.from(
    new Set(
      rawSymbols
        .split(',')
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean),
    ),
  )
}

export async function getMarketAssets(symbolsParam: unknown): Promise<{ assets: MarketAsset[] }> {
  const symbols = parseSymbolList(symbolsParam)

  try {
    return { assets: await getSosoMarketAssets(symbols) }
  } catch {
    return { assets: await getFallbackMarketAssets(symbols) }
  }
}

async function getSosoMarketAssets(symbols: string[]): Promise<MarketAsset[]> {
  const currencies = await getCurrencies()
  const bySymbol = new Map(currencies.map((currency) => [currency.symbol.toUpperCase(), currency]))
  const updatedAt = new Date().toISOString()

  return Promise.all(
    symbols.map(async (symbol): Promise<MarketAsset> => {
      const currency = bySymbol.get(symbol) ?? bySymbol.get(currencyAliases[symbol] ?? '')

      if (!currency) {
        return { symbol, source: 'missing', updatedAt }
      }

      const snapshot = await getSnapshot(currency.currency_id)

      return {
        symbol,
        name: currency.name,
        currencyId: currency.currency_id,
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

export async function getSodexTickers(symbolParam: unknown): Promise<{
  tickers: unknown[]
  source: string
  updatedAt: string
}> {
  const symbol = typeof symbolParam === 'string'
    ? symbolParam
    : Array.isArray(symbolParam) && typeof symbolParam[0] === 'string'
      ? symbolParam[0]
      : ''
  const route = symbol ? `/markets/tickers?symbol=${encodeURIComponent(symbol)}` : '/markets/tickers'
  const tickers = await sodexFetch<unknown[]>(route)

  return {
    tickers: Array.isArray(tickers) ? tickers.slice(0, 8) : [],
    source: getSodexSpotBase(),
    updatedAt: new Date().toISOString(),
  }
}

async function getFallbackMarketAssets(symbols: string[]): Promise<MarketAsset[]> {
  const updatedAt = new Date().toISOString()

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

      const sodexSymbol = sodexSymbols[symbol]

      if (!sodexSymbol) {
        return { symbol, source: 'missing', updatedAt }
      }

      try {
        const tickers = await sodexFetch<unknown[]>(`/markets/tickers?symbol=${encodeURIComponent(sodexSymbol)}`)
        const ticker = Array.isArray(tickers) ? tickers[0] : undefined

        if (!isRecord(ticker)) {
          return { symbol, source: 'missing', updatedAt }
        }

        return {
          symbol,
          name: symbol,
          price: readTickerNumber(ticker, ['lastPx', 'lastPrice', 'price', 'close', 'c']),
          changePct24h: readTickerNumber(ticker, ['changePct', 'priceChangePercent', 'change24h', 'P']),
          turnover24h: readTickerNumber(ticker, ['quoteVolume', 'turnover_24h']),
          high24h: readTickerNumber(ticker, ['highPx', 'high_24h']),
          low24h: readTickerNumber(ticker, ['lowPx', 'low_24h']),
          source: 'sodex',
          updatedAt,
        }
      } catch {
        return { symbol, source: 'missing', updatedAt }
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
