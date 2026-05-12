export type TokenContract = {
  address: `0x${string}`
  decimals: number
}

export type ChainConfig = {
  id: number
  key: string
  name: string
  shortName: string
  hexChainId: `0x${string}`
  nativeToken: string
  explorerTx: string
  rpcUrls: string[]
  tokenContracts: Partial<Record<string, TokenContract>>
}

export const chains: ChainConfig[] = [
  {
    id: 1,
    key: 'ethereum',
    name: 'Ethereum',
    shortName: 'ETH',
    hexChainId: '0x1',
    nativeToken: 'ETH',
    explorerTx: 'https://etherscan.io/tx/',
    rpcUrls: ['https://cloudflare-eth.com'],
    tokenContracts: {
      USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
      USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    },
  },
  {
    id: 8453,
    key: 'base',
    name: 'Base',
    shortName: 'BASE',
    hexChainId: '0x2105',
    nativeToken: 'ETH',
    explorerTx: 'https://basescan.org/tx/',
    rpcUrls: ['https://mainnet.base.org'],
    tokenContracts: {
      USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
    },
  },
  {
    id: 42161,
    key: 'arbitrum',
    name: 'Arbitrum',
    shortName: 'ARB',
    hexChainId: '0xa4b1',
    nativeToken: 'ETH',
    explorerTx: 'https://arbiscan.io/tx/',
    rpcUrls: ['https://arb1.arbitrum.io/rpc'],
    tokenContracts: {
      USDC: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
      USDT: { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
    },
  },
  {
    id: 137,
    key: 'polygon',
    name: 'Polygon',
    shortName: 'POL',
    hexChainId: '0x89',
    nativeToken: 'MATIC',
    explorerTx: 'https://polygonscan.com/tx/',
    rpcUrls: ['https://polygon-rpc.com'],
    tokenContracts: {
      USDC: { address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', decimals: 6 },
      USDT: { address: '0xc2132D05D31c914a87C6611C10748AaCB58e8F', decimals: 6 },
    },
  },
  {
    id: 56,
    key: 'bnb',
    name: 'BNB Chain',
    shortName: 'BNB',
    hexChainId: '0x38',
    nativeToken: 'BNB',
    explorerTx: 'https://bscscan.com/tx/',
    rpcUrls: ['https://bsc-dataseed.binance.org'],
    tokenContracts: {
      USDC: { address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', decimals: 18 },
      USDT: { address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    },
  },
]

export const trackedTokens = ['USDC', 'USDT', 'ETH', 'BTC', 'SOL', 'MATIC', 'BNB'] as const
export const settlementTokens = ['USDC', 'USDT', 'ETH', 'MATIC', 'BNB'] as const

export function getChain(chainId: number): ChainConfig {
  return chains.find((chain) => chain.id === chainId) ?? chains[0]
}

export function isNativeSettlementToken(chainId: number, token: string): boolean {
  return getChain(chainId).nativeToken === token
}

export function getSupportedSettlementTokens(chainId: number): string[] {
  const chain = getChain(chainId)
  return Array.from(new Set([chain.nativeToken, ...Object.keys(chain.tokenContracts)]))
}
