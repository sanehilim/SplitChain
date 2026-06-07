import { assertPublicApiRateLimit, getSodexTickers, PublicRateLimitError, readClientRateLimitKey } from '../../server/splitchainApi.js'
import type { ApiRequest, ApiResponse } from '../_types.js'

export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    assertPublicApiRateLimit('sodex-tickers', readClientRateLimitKey(request.headers))
    response.status(200).json(await getSodexTickers(request.query.symbol, request.query.symbols))
  } catch (error) {
    response.status(error instanceof PublicRateLimitError ? error.statusCode : 502).json({
      error: error instanceof Error ? error.message : 'Unable to load SoDEX tickers.',
    })
  }
}
