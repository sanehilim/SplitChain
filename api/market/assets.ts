import { getMarketAssets } from '../../server/splitchainApi'
import type { ApiRequest, ApiResponse } from '../_types'

export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    response.status(200).json(await getMarketAssets(request.query.symbols))
  } catch (error) {
    response.status(502).json({
      error: error instanceof Error ? error.message : 'Unable to load SoSoValue market data.',
    })
  }
}
