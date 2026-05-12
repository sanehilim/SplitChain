export type ApiRequest = {
  query: Record<string, string | string[] | undefined>
}

export type ApiResponse = {
  status: (statusCode: number) => ApiResponse
  json: (body: unknown) => void
}
