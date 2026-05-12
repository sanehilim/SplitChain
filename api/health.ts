import { getHealthPayload } from '../server/splitchainApi'
import type { ApiRequest, ApiResponse } from './_types'

export default function handler(_request: ApiRequest, response: ApiResponse) {
  response.status(200).json(getHealthPayload())
}
