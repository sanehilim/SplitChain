export type WorkspaceSyncOperation = 'load' | 'save'

export type WorkspaceSyncMessageInput = {
  operation: WorkspaceSyncOperation
  owner: string
  signedAt: string
  payloadHash?: string
}

function normalizeCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeCanonicalValue)
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, entryValue]) => [key, normalizeCanonicalValue(entryValue)]),
    )
  }

  return value
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(normalizeCanonicalValue(value))
}

export function buildWorkspaceSyncMessage(input: WorkspaceSyncMessageInput): string {
  const lines = [
    `SplitChain cloud workspace ${input.operation}`,
    `Owner: ${input.owner.toLowerCase()}`,
    `Signed at: ${input.signedAt}`,
  ]

  if (input.operation === 'save') {
    lines.push(`Payload hash: ${input.payloadHash ?? ''}`)
  }

  return lines.join('\n')
}
