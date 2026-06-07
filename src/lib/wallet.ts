import { encodeFunctionData, parseEther, parseUnits } from 'viem'
import { getChain, isNativeSettlementToken } from '../data/chains'
import type { WalletState } from '../types'
import type { WorkspacePayload } from '../types'
import { buildWorkspaceSyncMessage, canonicalStringify, type WorkspaceSyncOperation } from './workspaceAuth'

export type SettlementTransactionResult = {
  hash: string
  transferType: 'native' | 'erc20'
  tokenContract?: string
}

export type TransactionConfirmationResult = {
  status: 'pending' | 'confirmed' | 'failed'
  blockNumber?: string
  failureReason?: string
}

export type WorkspaceSignatureHeaders = {
  'x-splitchain-operation': WorkspaceSyncOperation
  'x-splitchain-signed-at': string
  'x-splitchain-signature': string
  'x-splitchain-payload-hash'?: string
}

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on?: (event: string, handler: (...args: unknown[]) => void) => void
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void
}

declare global {
  interface Window {
    ethereum?: EthereumProvider
  }
}

const erc20Abi = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

function getProvider(): EthereumProvider {
  if (!window.ethereum) {
    throw new Error('No EVM wallet was found. Install MetaMask, Rabby, Coinbase Wallet, or another injected wallet.')
  }

  return window.ethereum
}

function normalizeChainId(chainId: unknown): number {
  if (typeof chainId === 'string') {
    return chainId.startsWith('0x') ? Number.parseInt(chainId, 16) : Number(chainId)
  }

  if (typeof chainId === 'number') {
    return chainId
  }

  return 0
}

function amountToUnitString(amount: number, decimals: number): string {
  return amount.toLocaleString('en-US', {
    useGrouping: false,
    maximumFractionDigits: decimals,
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function readReceiptStatus(receipt: unknown): TransactionConfirmationResult | null {
  if (typeof receipt !== 'object' || receipt === null) {
    return null
  }

  const record = receipt as Record<string, unknown>
  const status = record.status
  const blockNumber = typeof record.blockNumber === 'string' ? record.blockNumber : undefined

  if (status === '0x1' || status === 1 || status === true) {
    return { blockNumber, status: 'confirmed' }
  }

  if (status === '0x0' || status === 0 || status === false) {
    return {
      blockNumber,
      failureReason: 'Transaction receipt status is failed.',
      status: 'failed',
    }
  }

  return null
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function connectWallet(): Promise<WalletState> {
  const provider = getProvider()
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[]
  const chainId = normalizeChainId(await provider.request({ method: 'eth_chainId' }))

  if (!accounts[0]) {
    throw new Error('Wallet connection did not return an account.')
  }

  return {
    account: accounts[0],
    chainId,
  }
}

export async function getWalletState(): Promise<WalletState | null> {
  if (!window.ethereum) {
    return null
  }

  const accounts = (await window.ethereum.request({ method: 'eth_accounts' })) as string[]

  if (!accounts[0]) {
    return null
  }

  return {
    account: accounts[0],
    chainId: normalizeChainId(await window.ethereum.request({ method: 'eth_chainId' })),
  }
}

export async function signWorkspaceRequest(options: {
  owner: string
  operation: WorkspaceSyncOperation
  payload?: WorkspacePayload
}): Promise<WorkspaceSignatureHeaders> {
  const provider = getProvider()
  const signedAt = new Date().toISOString()
  const payloadHash = options.payload ? await sha256Hex(canonicalStringify(options.payload)) : undefined
  const message = buildWorkspaceSyncMessage({
    operation: options.operation,
    owner: options.owner,
    payloadHash,
    signedAt,
  })
  const signature = await provider.request({
    method: 'personal_sign',
    params: [message, options.owner],
  })

  return {
    'x-splitchain-operation': options.operation,
    'x-splitchain-signed-at': signedAt,
    'x-splitchain-signature': String(signature),
    ...(payloadHash ? { 'x-splitchain-payload-hash': payloadHash } : {}),
  }
}

export async function switchToChain(chainId: number): Promise<void> {
  const provider = getProvider()
  const chain = getChain(chainId)

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chain.hexChainId }],
    })
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? Number(error.code) : 0

    if (code !== 4902) {
      throw error
    }

    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: chain.hexChainId,
          chainName: chain.name,
          nativeCurrency: {
            name: chain.nativeToken,
            symbol: chain.nativeToken,
            decimals: 18,
          },
          rpcUrls: chain.rpcUrls,
          blockExplorerUrls: [chain.explorerTx.replace('/tx/', '')],
        },
      ],
    })
  }
}

export async function sendSettlementTransaction(options: {
  from: string
  to: string
  amount: number
  token: string
  chainId: number
}): Promise<SettlementTransactionResult> {
  const provider = getProvider()
  const chain = getChain(options.chainId)

  await switchToChain(options.chainId)

  if (isNativeSettlementToken(options.chainId, options.token)) {
    const value = parseEther(amountToUnitString(options.amount, 18))
    const hash = await provider.request({
      method: 'eth_sendTransaction',
      params: [
        {
          from: options.from,
          to: options.to,
          value: `0x${value.toString(16)}`,
        },
      ],
    })

    return {
      hash: String(hash),
      transferType: 'native',
    }
  }

  const tokenContract = chain.tokenContracts[options.token]

  if (!tokenContract) {
    throw new Error(`${options.token} settlement is not configured on ${chain.name}. Choose ${chain.nativeToken} or another supported token.`)
  }

  const value = parseUnits(amountToUnitString(options.amount, tokenContract.decimals), tokenContract.decimals)
  // Direct ERC-20 transfer: no SplitChain spender or token allowance is introduced.
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [options.to as `0x${string}`, value],
  })
  const hash = await provider.request({
    method: 'eth_sendTransaction',
    params: [
      {
        from: options.from,
        to: tokenContract.address,
        value: '0x0',
        data,
      },
    ],
  })

  return {
    hash: String(hash),
    tokenContract: tokenContract.address,
    transferType: 'erc20',
  }
}

export async function waitForTransactionConfirmation(
  hash: string,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<TransactionConfirmationResult> {
  const provider = getProvider()
  const timeoutMs = options.timeoutMs ?? 90_000
  const intervalMs = options.intervalMs ?? 3_000
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const receipt = await provider.request({
      method: 'eth_getTransactionReceipt',
      params: [hash],
    })
    const result = readReceiptStatus(receipt)

    if (result) {
      return result
    }

    await sleep(intervalMs)
  }

  return {
    failureReason: 'Confirmation was not observed before the local timeout.',
    status: 'pending',
  }
}
