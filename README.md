# SplitChain

SplitChain is a wallet-native Web3 expense-sharing app for groups that split costs in crypto. It is the simple idea of "Splitwise for Crypto" built for friends, hackathon teams, DAO contributors, shared subscriptions, roommates, and crypto-native communities.

The app lets users create shared groups, add wallet members, record real token expenses, calculate who owes whom, simplify debts into fewer transfers, and settle those transfers through an injected EVM wallet.

## What Problem It Solves

Crypto users already share payments in real life:

- Friends pay for hotels, food, travel, and events in stablecoins.
- Hackathon teams share infra, API, domain, and hosting costs.
- DAO teams split recurring subscriptions and operational spend.
- Trading groups and communities coordinate pooled costs.

Normal expense apps are bank-first. DeFi dashboards are trader-first. SplitChain is built for the middle: social payments with crypto-native settlement.

## What The App Does

- Creates shared crypto expense groups.
- Adds members by EVM wallet address.
- Records expenses in USDC, USDT, ETH, BTC, SOL, MATIC, and BNB.
- Supports equal, percentage, and custom token splits.
- Uses live SoSoValue market data to value token expenses in USD.
- Calculates every member's net balance.
- Simplifies many messy reimbursements into the fewest settlement transfers.
- Sends real EVM wallet transactions for native-token and configured ERC-20 settlements.
- Displays SoDEX public spot ticker data for hackathon-relevant market context.
- Stores Wave 1 demo data locally in the browser for fast, reliable judging demos.
- Exports workspace data as JSON.

## Why It Is Useful

SplitChain makes shared crypto payments understandable. Instead of manually calculating token values, wallet addresses, and reimbursement routes, a group can add expenses and immediately see:

- who paid,
- who owes,
- how much each person owes in USD terms,
- which optimized transfer should happen,
- and which wallet transaction will settle it.

This creates a practical Web3 consumer workflow that is easy for judges to understand and easy for normal users to demo.

## Demo Flow

1. Connect an EVM wallet.
2. Add the connected wallet as a member.
3. Add at least one more member wallet.
4. Create a group, for example `ETHGlobal Bangkok Trip`.
5. Add an expense, for example `120 USDC` for `Hotel booking`.
6. Split it equally, by percentage, or by custom amounts.
7. View live balances and the optimized settlement graph.
8. Connect the debtor wallet.
9. Click `Pay now` to send the on-chain settlement transaction.
10. SplitChain records the transaction hash in settlement history.

## How It Works

```txt
React UI
  -> Vite frontend
  -> /api Vercel Functions or local Express API
  -> SoSoValue market snapshots
  -> SplitChain balance engine
  -> Debt simplification engine
  -> Injected EVM wallet
  -> Native token or ERC-20 transfer
```

### Expense Engine

Each expense stores:

- group ID,
- payer wallet member,
- token symbol,
- token amount,
- category,
- split mode,
- and member shares.

SplitChain converts each token amount to USD using live SoSoValue prices, credits the payer, debits each participant, and then applies completed settlements.

### Debt Simplification

The app separates members into creditors and debtors, then greedily matches the largest debtor to the largest creditor until the balance graph is resolved. This turns a messy group reimbursement graph into fewer direct payments.

Example:

```txt
Before optimization: 7 raw reimbursements
After optimization: 2 settlement transfers
```

### On-Chain Settlement

SplitChain does not custody funds and does not move money silently.

When a user clicks `Pay now`:

1. The app verifies the connected wallet matches the debtor.
2. The app switches or adds the target EVM chain when needed.
3. If the settlement token is native, it sends `eth_sendTransaction`.
4. If the settlement token is ERC-20, it encodes `transfer(address,uint256)`.
5. The wallet asks the user to approve.
6. The returned transaction hash is stored in local settlement history.

## Live Data Integrations

### SoSoValue

SoSoValue powers token pricing through the server-side API layer:

- `GET /currencies`
- `GET /currencies/{currency_id}/market-snapshot`

The browser never receives the SoSoValue API key. It only calls SplitChain's `/api/market/assets` route.

### SoDEX

SoDEX public spot ticker data powers the market signal panel through:

- `GET /api/sodex/tickers`

This gives the demo an active market-data surface while keeping the main product focused on shared expense settlement.

## Tech Stack

- React
- TypeScript
- Vite
- Node.js
- Express for local development API
- Vercel Functions for production API routes
- viem for ERC-20 calldata and unit parsing
- lucide-react for UI icons
- localStorage for Wave 1 demo persistence

## Project Structure

```txt
api/
  health.ts              Vercel health endpoint
  market/assets.ts       Vercel SoSoValue market endpoint
  sodex/tickers.ts       Vercel SoDEX ticker endpoint

server/
  index.ts               Local Express development server
  splitchainApi.ts       Shared API logic used by Express and Vercel

src/
  App.tsx                Main product UI and workflows
  App.css                Product styling and responsive layout
  data/chains.ts         Chain and token settlement configuration
  hooks/                 Local persistence helpers
  lib/finance.ts         Balance and debt simplification logic
  lib/wallet.ts          Injected wallet and settlement transaction logic
  types.ts               App data models
```

## Supported Settlement Chains

- Ethereum
- Base
- Arbitrum
- Polygon
- BNB Chain

Supported settlement tokens depend on the selected chain. Native token transfers are supported, and USDC/USDT ERC-20 contract addresses are configured on supported EVM chains where available.

## Environment Variables

Create `.env.local` from `.env.example` for local development:

```bash
SOSOVALUE_API_KEY=your_sosovalue_api_key
SOSOVALUE_API_BASE=https://openapi.sosovalue.com/openapi/v1
SODEX_SPOT_BASE=https://testnet-gw.sodex.dev/api/v1/spot
PORT=8787
```

Production uses the same variables in Vercel Project Settings. `.env.local` and `.vercel` are ignored so secrets do not enter source control.

## Run Locally

```bash
npm install
npm run dev
```

The local app starts:

- Vite frontend, usually on `http://localhost:5173`
- Express API on `http://localhost:8787`

Useful commands:

```bash
npm run lint
npm run build
npm audit --audit-level=high
npm run dev:api
npm run dev:client
```

## Vercel Deployment

This repo is configured for Vercel with:

- `vercel.json` for Vite build settings and SPA rewrites.
- Root `api/` functions for production API routes.
- `.vercelignore` to keep local env files, logs, build output, and dependencies out of deployment uploads.

Required production environment variables:

```bash
SOSOVALUE_API_KEY
SOSOVALUE_API_BASE
SODEX_SPOT_BASE
```

Deployment command:

```bash
npx vercel --prod
```

## Validation Checklist

Current audit checks:

- TypeScript production build passes.
- ESLint passes.
- npm high-severity audit passes.
- Local Express health endpoint responds.
- Local SoSoValue market endpoint returns live token prices.
- Local SoDEX ticker endpoint returns public ticker data.
- Browser smoke test confirms hero, live pricing, dashboard, creation flow, and mobile layout.
- Core product flow was manually tested: add members, create a group, add an expense, and verify optimized balances.

## Wave Roadmap

### Wave 1: MVP

- Polished landing and app experience.
- Wallet connect through injected EVM wallets.
- Wallet-native member management.
- Group creation.
- Expense creation.
- Equal, percentage, and custom split modes.
- Live SoSoValue token pricing.
- Balance tracking.
- Debt simplification.
- On-chain settlement transaction creation.
- SoDEX public market-data panel.
- Local workspace export.
- Vercel-ready deployment.

### Wave 2: Functional Platform

- Database persistence with PostgreSQL or Supabase.
- User profiles and group invite links.
- WalletConnect mobile wallet support.
- Transaction confirmation tracking.
- Settlement status updates.
- Payment reminders.
- Full expense history with filters.
- Multi-group search.
- Better token registry and chain metadata handling.
- Notification layer for unpaid balances.

### Wave 3: Full Web3 Shared Finance App

- Cross-chain settlement routing.
- Automatic token conversion.
- Shared group treasuries.
- Recurring expenses for subscriptions and DAO ops.
- DAO/team permissions.
- Exportable accounting reports.
- Reputation scores for reliable payers.
- Mobile-first PWA experience.
- Real-time collaboration.
- AI summaries for group spending and settlement recommendations.

## Safety Notes

SplitChain is non-custodial. It prepares transactions, but the connected wallet shows the transaction and the user approves or rejects it. Wave 1 data is stored in browser localStorage, so it is ideal for demos but not yet a production accounting database.
