import { assertPublicApiRateLimit, getIndexSnapshots, PublicRateLimitError, readClientRateLimitKey } from '../../server/splitchainApi.js'
import type { ApiRequest, ApiResponse } from '../_types.js'

export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    assertPublicApiRateLimit('market-indexes', readClientRateLimitKey(request.headers))
    response.status(200).json(await getIndexSnapshots(request.query.tickers))
  } catch (error) {
    response.status(error instanceof PublicRateLimitError ? error.statusCode : 502).json({
      error: error instanceof Error ? error.message : 'Unable to load SoSoValue Index data.',
    })
  }
}
