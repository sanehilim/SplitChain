import { encodeFunctionData, parseEther, parseUnits } from 'viem'
import { getChain, isNativeSettlementToken } from '../data/chains'
import type { WalletState } from '../types'

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
}): Promise<string> {
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

    return String(hash)
  }

  const tokenContract = chain.tokenContracts[options.token]

  if (!tokenContract) {
    throw new Error(`${options.token} settlement is not configured on ${chain.name}. Choose ${chain.nativeToken} or another supported token.`)
  }

  const value = parseUnits(amountToUnitString(options.amount, tokenContract.decimals), tokenContract.decimals)
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

  return String(hash)
}
