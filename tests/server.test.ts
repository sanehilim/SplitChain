import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { privateKeyToAccount } from 'viem/accounts'
import { getMarketAssets, getSodexTickers, parseSymbolList, resetApiCachesForTests, saveCloudWorkspace } from '../server/splitchainApi.ts'
import { buildWorkspaceSyncMessage, canonicalStringify } from '../src/lib/workspaceAuth.ts'
import type { WorkspacePayload } from '../src/types.ts'

const createdAt = '2026-06-06T00:00:00.000Z'
const workspacePayload: WorkspacePayload = {
  members: [
    { id: 'alice', name: 'Alice', wallet: '0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266' },
    { id: 'bob', name: 'Bob', wallet: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' },
  ],
  groups: [
    {
      id: 'group-1',
      name: 'Builders',
      chainId: 8453,
      settlementToken: 'USDC',
      memberIds: ['alice', 'bob'],
      createdAt,
    },
  ],
  expenses: [
    {
      id: 'expense-1',
      groupId: 'group-1',
      title: 'Hotel',
      category: 'Travel',
      amount: 200,
      token: 'USDC',
      payerId: 'alice',
      splitMode: 'equal',
      shares: { alice: 100, bob: 100 },
      createdAt,
    },
  ],
  settlements: [],
  selectedGroupId: 'group-1',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  })
}

test('getMarketAssets reports mixed SoSoValue and fallback sources explicitly', async (t) => {
  resetApiCachesForTests()
  const originalFetch = globalThis.fetch
  const originalSosoKey = process.env.SOSOVALUE_API_KEY

  t.after(() => {
    globalThis.fetch = originalFetch
    process.env.SOSOVALUE_API_KEY = originalSosoKey
    resetApiCachesForTests()
  })

  process.env.SOSOVALUE_API_KEY = 'test-key'
  globalThis.fetch = async (input) => {
    const url = String(input)

    if (url.endsWith('/currencies')) {
      return jsonResponse([
        { currency_id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
        { currency_id: 'polygon', symbol: 'MATIC', name: 'Polygon(ex-MATIC)' },
      ])
    }

    if (url.endsWith('/currencies/ethereum/market-snapshot')) {
      return jsonResponse({ price: '2000', change_pct_24h: '1.2' })
    }

    if (url.endsWith('/currencies/polygon/market-snapshot')) {
      return jsonResponse({ price: '0.08', change_pct_24h: '-0.2' })
    }

    if (url.includes('/markets/tickers?symbol=vBTC_vUSDC')) {
      return jsonResponse({ code: 0, data: [{ symbol: 'vBTC_vUSDC', lastPx: '60000', changePct: 2.5 }] })
    }

    throw new Error(`Unexpected fetch: ${url}`)
  }

  const result = await getMarketAssets('USDC,ETH,BTC,POL')

  assert.equal(result.source, 'mixed')
  assert.equal(result.assets.find((asset) => asset.symbol === 'ETH')?.source, 'sosovalue')
  assert.equal(result.assets.find((asset) => asset.symbol === 'POL')?.source, 'sosovalue')
  assert.equal(result.assets.find((asset) => asset.symbol === 'BTC')?.source, 'sodex')
  assert.equal(result.assets.find((asset) => asset.symbol === 'USDC')?.source, 'stablecoin')
  assert.match(result.fallbackReason ?? '', /BTC/)
})

test('parseSymbolList filters invalid symbols and caps public market requests', () => {
  assert.deepEqual(
    parseSymbolList('eth,btc,not-valid,sol,bnb,matic,usdc,usdt,pol,avax,link,uni,aave,near,op'),
    ['ETH', 'BTC', 'SOL', 'BNB', 'MATIC', 'USDC', 'USDT', 'POL', 'AVAX', 'LINK', 'UNI', 'AAVE'],
  )
})

test('getMarketAssets serves stablecoins without spending SoSoValue requests', async (t) => {
  resetApiCachesForTests()
  const originalFetch = globalThis.fetch
  const originalSosoKey = process.env.SOSOVALUE_API_KEY

  t.after(() => {
    globalThis.fetch = originalFetch
    process.env.SOSOVALUE_API_KEY = originalSosoKey
    resetApiCachesForTests()
  })

  process.env.SOSOVALUE_API_KEY = 'test-key'
  globalThis.fetch = async () => {
    throw new Error('stablecoin request should not fetch upstream APIs')
  }

  const result = await getMarketAssets('USDC,USDT')

  assert.equal(result.assets.length, 2)
  assert.equal(result.assets[0].source, 'stablecoin')
  assert.equal(result.assets[0].price, 1)
  assert.equal(result.assets[1].source, 'stablecoin')
  assert.equal(result.assets[1].price, 1)
})

test('getSodexTickers fetches exact requested SoDEX symbols only', async (t) => {
  const originalFetch = globalThis.fetch
  const requestedUrls: string[] = []

  t.after(() => {
    globalThis.fetch = originalFetch
  })

  globalThis.fetch = async (input) => {
    const url = String(input)
    requestedUrls.push(url)

    if (url.includes('vETH_vUSDC')) {
      return jsonResponse({ code: 0, data: [{ symbol: 'vETH_vUSDC', lastPx: '2400.2' }] })
    }

    if (url.includes('vSOL_vUSDC')) {
      return jsonResponse({ code: 0, data: [{ symbol: 'vSOL_vUSDC', lastPx: '145.1' }] })
    }

    throw new Error(`Unexpected fetch: ${url}`)
  }

  const result = await getSodexTickers(undefined, 'vETH_vUSDC,not-valid,vSOL_vUSDC')

  assert.deepEqual(result.requestedSymbols, ['vETH_vUSDC', 'vSOL_vUSDC'])
  assert.deepEqual(result.tickers.map((ticker) => (ticker as { symbol: string }).symbol), ['vETH_vUSDC', 'vSOL_vUSDC'])
  assert.equal(requestedUrls.length, 2)
})

test('saveCloudWorkspace rejects unsigned writes when Supabase is configured', async (t) => {
  const originalUrl = process.env.SUPABASE_URL
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  t.after(() => {
    process.env.SUPABASE_URL = originalUrl
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey
  })

  process.env.SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role'

  await assert.rejects(
    saveCloudWorkspace(workspacePayload.members[0].wallet, workspacePayload),
    /wallet signature/i,
  )
})

test('saveCloudWorkspace accepts a fresh owner signature for the exact payload', async (t) => {
  const originalFetch = globalThis.fetch
  const originalUrl = process.env.SUPABASE_URL
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const account = privateKeyToAccount('0x59c6995e998f97a5a0044966f094538502d26f9322d90906f19a3f953ecf803f')
  const owner = account.address.toLowerCase()
  const signedAt = new Date().toISOString()
  const payloadHash = createHash('sha256').update(canonicalStringify(workspacePayload)).digest('hex')
  const signature = await account.signMessage({
    message: buildWorkspaceSyncMessage({
      operation: 'save',
      owner,
      payloadHash,
      signedAt,
    }),
  })

  t.after(() => {
    globalThis.fetch = originalFetch
    process.env.SUPABASE_URL = originalUrl
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey
  })

  process.env.SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role'
  globalThis.fetch = async () => jsonResponse([{ owner, payload: workspacePayload, updated_at: createdAt }], 201)

  const result = await saveCloudWorkspace(owner, workspacePayload, {
    operation: 'save',
    payloadHash,
    signedAt,
    signature,
  })

  assert.equal(result.configured, true)
  assert.equal(result.workspace?.owner, owner)
  assert.equal(result.workspace?.payload.selectedGroupId, 'group-1')
})
