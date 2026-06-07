import { getCloudWorkspace, readWorkspaceAuth, saveCloudWorkspace } from '../server/splitchainApi.js'
import type { ApiRequest, ApiResponse } from './_types.js'

function readPayload(body: unknown): unknown {
  return typeof body === 'object' && body !== null && 'payload' in body
    ? body.payload
    : body
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    if (request.method === 'GET') {
      response.status(200).json(await getCloudWorkspace(request.query.owner, readWorkspaceAuth(request.headers)))
      return
    }

    if (request.method === 'POST' || request.method === 'PUT') {
      response.status(200).json(await saveCloudWorkspace(request.query.owner, readPayload(request.body), readWorkspaceAuth(request.headers)))
      return
    }

    response.status(405).json({ error: 'Unsupported workspace method.' })
  } catch (error) {
    response.status(502).json({
      error: error instanceof Error ? error.message : 'Unable to sync cloud workspace.',
    })
  }
}
