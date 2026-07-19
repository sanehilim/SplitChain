import { assertPublicApiRateLimit, getMacroEvents, PublicRateLimitError, readClientRateLimitKey } from '../../server/splitchainApi.js'
import type { ApiRequest, ApiResponse } from '../_types.js'

export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    assertPublicApiRateLimit('macro-events', readClientRateLimitKey(request.headers))
    response.status(200).json(await getMacroEvents(request.query.days))
  } catch (error) {
    response.status(error instanceof PublicRateLimitError ? error.statusCode : 502).json({
      error: error instanceof Error ? error.message : 'Unable to load SoSoValue Macro events.',
    })
  }
}
