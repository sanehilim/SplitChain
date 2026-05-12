import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { getHealthPayload, getMarketAssets, getSodexTickers } from './splitchainApi.js'

dotenv.config({ path: existsSync('.env.local') ? '.env.local' : '.env' })

const app = express()
const port = Number(process.env.PORT ?? 8787)

app.use(cors())
app.use(express.json())

app.get('/api/health', (_request, response) => {
  response.json(getHealthPayload())
})

app.get('/api/market/assets', async (request, response) => {
  try {
    response.json(await getMarketAssets(request.query.symbols))
  } catch (error) {
    response.status(502).json({
      error: error instanceof Error ? error.message : 'Unable to load SoSoValue market data.',
    })
  }
})

app.get('/api/sodex/tickers', async (request, response) => {
  try {
    response.json(await getSodexTickers(request.query.symbol))
  } catch (error) {
    response.status(502).json({
      error: error instanceof Error ? error.message : 'Unable to load SoDEX tickers.',
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
