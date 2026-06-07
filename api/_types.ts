export type ApiRequest = {
  method?: string
  query: Record<string, string | string[] | undefined>
  headers?: Record<string, string | string[] | undefined>
  body?: unknown
}

export type ApiResponse = {
  status: (statusCode: number) => ApiResponse
  json: (body: unknown) => void
}
