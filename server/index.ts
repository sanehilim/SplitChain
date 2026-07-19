import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import { existsSync } from 'node:fs'
import path from 'node:path'
import {
  assertPublicApiRateLimit,
  getCloudWorkspace,
  getHealthPayload,
  getIndexSnapshots,
  getMacroEvents,
  getMarketAssets,
  getSodexTickers,
  PublicRateLimitError,
  readClientRateLimitKey,
  readWorkspaceAuth,
  saveCloudWorkspace,
} from './splitchainApi.js'

dotenv.config({ path: existsSync('.env.local') ? '.env.local' : '.env' })

const app = express()
const port = Number(process.env.PORT ?? 8787)

app.use(cors())
app.use(express.json({ limit: '1mb' }))

app.get('/api/health', (_request, response) => {
  response.json(getHealthPayload())
})

app.get('/api/market/assets', async (request, response) => {
  try {
    assertPublicApiRateLimit('market-assets', readClientRateLimitKey(request.headers, request.ip))
    response.json(await getMarketAssets(request.query.symbols))
  } catch (error) {
    response.status(error instanceof PublicRateLimitError ? error.statusCode : 502).json({
      error: error instanceof Error ? error.message : 'Unable to load SoSoValue market data.',
    })
  }
})

app.get('/api/market/indexes', async (request, response) => {
  try {
    assertPublicApiRateLimit('market-indexes', readClientRateLimitKey(request.headers, request.ip))
    response.json(await getIndexSnapshots(request.query.tickers))
  } catch (error) {
    response.status(error instanceof PublicRateLimitError ? error.statusCode : 502).json({
      error: error instanceof Error ? error.message : 'Unable to load SoSoValue Index data.',
    })
  }
})

app.get('/api/macro/events', async (request, response) => {
  try {
    assertPublicApiRateLimit('macro-events', readClientRateLimitKey(request.headers, request.ip))
    response.json(await getMacroEvents(request.query.days))
  } catch (error) {
    response.status(error instanceof PublicRateLimitError ? error.statusCode : 502).json({
      error: error instanceof Error ? error.message : 'Unable to load SoSoValue Macro events.',
    })
  }
})

app.get('/api/sodex/tickers', async (request, response) => {
  try {
    assertPublicApiRateLimit('sodex-tickers', readClientRateLimitKey(request.headers, request.ip))
    response.json(await getSodexTickers(request.query.symbol, request.query.symbols))
  } catch (error) {
    response.status(error instanceof PublicRateLimitError ? error.statusCode : 502).json({
      error: error instanceof Error ? error.message : 'Unable to load SoDEX tickers.',
    })
  }
})

app.get('/api/workspace', async (request, response) => {
  try {
    response.json(await getCloudWorkspace(request.query.owner, readWorkspaceAuth(request.headers)))
  } catch (error) {
    response.status(502).json({
      error: error instanceof Error ? error.message : 'Unable to load cloud workspace.',
    })
  }
})

app.post('/api/workspace', async (request, response) => {
  try {
    const payload = typeof request.body === 'object' && request.body !== null && 'payload' in request.body
      ? request.body.payload
      : request.body
    response.json(await saveCloudWorkspace(request.query.owner, payload, readWorkspaceAuth(request.headers)))
  } catch (error) {
    response.status(502).json({
      error: error instanceof Error ? error.message : 'Unable to save cloud workspace.',
    })
  }
})

const distPath = path.resolve(process.cwd(), 'dist')

if (process.env.NODE_ENV === 'production' && existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get(/.*/, (_request, response) => {
    response.sendFile(path.join(distPath, 'index.html'))
  })
}

app.listen(port, () => {
  console.log(`SplitChain API listening on http://localhost:${port}`)
})
