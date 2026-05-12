import { getHealthPayload } from '../server/splitchainApi.js'
import type { ApiRequest, ApiResponse } from './_types.js'

export default function handler(_request: ApiRequest, response: ApiResponse) {
  response.status(200).json(getHealthPayload())
}
