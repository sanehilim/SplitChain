# SplitChain

SplitChain is a wallet-native crypto expense-sharing app for groups that split costs across wallets, tokens, and chains. It is a practical "Splitwise for Crypto" for hackathon teams, DAO contributors, travel groups, roommates, and crypto-native communities.

Wave 3 is the final production-readiness pass: live SoSoValue pricing, SoSoValue Index context, SoSoValue Macro events, SoDEX market signals, signed cloud persistence, locked expense pricing, transaction confirmation tracking, hardened dependencies, and tested settlement logic.

## Live App

```txt
https://splitchain-blond.vercel.app
```

## What It Does

- Creates shared crypto expense groups.
- Adds members by EVM wallet address.
- Records expenses in USDC, USDT, ETH, BTC, SOL, POL, legacy MATIC, and BNB.
- Supports equal, percentage, and custom split modes.
- Locks USD pricing at expense creation time so balances do not drift when markets move.
- Uses SoSoValue token market snapshots for live pricing.
- Uses SoSoValue Indexes, including SSI indexes, for settlement context.
- Uses SoSoValue Macro events to warn about high-impact calendar risk before volatile-token settlement.
- Uses exact SoDEX public spot tickers for market/liquidity signals.
- Simplifies many reimbursement edges into fewer optimized transfers.
- Sends native-token and direct ERC-20 `transfer()` settlement transactions.
- Tracks submitted, confirmed, and failed settlement states from wallet receipts.
- Supports signed Supabase workspace load/save when cloud persistence is configured.
- Exports/imports workspaces as JSON.
- Includes a protected three-wallet demo flow for judges.

## Wave 3 Finalization

The final production-hardening pass covers the full end-to-end workflow:

- **SoSoValue Macro guard added:** `/macro/events` powers an upcoming-event calendar and settlement risk guard.
- **Docs alignment checked:** SoSoValue auth, response wrapper, rate limit, currency snapshots, index snapshots, and macro event endpoints were verified against the current docs.
- **Rate-limit posture tightened:** Macro events are cached for 15 minutes, index snapshots and market assets are cached, and public endpoints keep per-client request caps.
- **Dependency audit cleaned:** Vite, esbuild, viem/ws, concurrently/shell-quote, and Babel dependencies were updated; `npm audit --audit-level=high` reports zero vulnerabilities.
- **UI final polish:** dashboard cards now expose Macro risk, settings show integration health, focus states are visible, reduced-motion preferences are respected, and long dashboard rows wrap safely on mobile.
- **Deployment-aware cloud controls:** cloud load/save buttons are disabled until `/api/health` confirms Supabase persistence is configured.

- **ERC-20 approval gap fixed:** settlement uses direct ERC-20 `transfer()` calldata. No `approve()` call and no SplitChain allowance spender are created.
- **Fuller on-chain proof:** settlements are recorded as `pending`, then updated to `confirmed` or `failed` after receipt polling.
- **Cloud persistence hardened:** Supabase workspace load/save requires a fresh wallet signature from the workspace owner.
- **Payload tamper protection:** signed cloud saves include a SHA-256 hash of the normalized workspace payload.
- **Market source honesty:** every market asset exposes its real source: `sosovalue`, `sodex`, `stablecoin`, or `missing`.
- **No silent fallback:** SoSoValue fallback reasons are returned by the API and shown in the app where relevant.
- **SoDEX signal improved:** the app requests exact configured SoDEX pairs such as `vETH_vUSDC`, not random public tickers.
- **SSI integration expanded:** SoSoValue Index snapshots are used in the smart settlement route card and analytics.
- **POL/MATIC compatibility:** Polygon settlement now uses `POL`, while legacy `MATIC` expenses/imports still resolve through the SoSoValue POL asset.
- **Expense valuation locked:** expense USD amounts and share USD amounts are stored at creation time.
- **Public API protection:** market-data endpoints include request caps and lightweight in-memory rate limiting.
- **Automated tests added:** finance, workspace, market fallback, Macro events, blank env fallback, SoDEX exact ticker, and signed Supabase save behavior are covered.

## Demo Flow

1. Connect an EVM wallet.
2. Add the connected wallet as a member.
3. Add at least one more member wallet, or load the three-wallet demo.
4. Create a group and choose a settlement chain/token.
5. Add an expense and choose equal, percentage, or custom split mode.
6. Review optimized balances and the smart settlement route.
7. Connect the debtor wallet.
8. Click `Pay now`.
9. Confirm the wallet transaction.
10. SplitChain records the hash and updates status after receipt polling.

## Architecture

```txt
React + Vite UI
  -> Vercel Functions or local Express API
  -> SoSoValue token market snapshots
  -> SoSoValue Index snapshots
  -> SoSoValue Macro event calendar
  -> SoDEX exact spot tickers
  -> SplitChain balance engine
  -> Debt simplification engine
  -> Injected EVM wallet
  -> Native transfer or ERC-20 transfer()
  -> Optional signed Supabase workspace persistence
```




## Core Logic

### Expense Engine

Each expense stores the original token amount and a locked USD valuation:

- `priceUsd`
- `amountUsd`
- `sharesUsd`
- `pricedAt`
- `priceSource`

This prevents old expenses from changing value when live market prices refresh.

### Debt Simplification

SplitChain calculates each member's net USD balance, separates creditors and debtors, and greedily matches the largest debtor to the largest creditor until the graph is settled.

```txt
Before optimization: many raw reimbursement edges
After optimization: fewer direct settlement transfers
```

### On-Chain Settlement

SplitChain is non-custodial. It prepares transactions, but the connected wallet always asks the user to sign/send.

Native token settlement:

```txt
eth_sendTransaction({ to, value })
```

ERC-20 settlement:

```txt
transfer(address to, uint256 amount)
```

No SplitChain spender, token custody, escrow, or allowance is introduced.

## Integrations

### SoSoValue

Server-side API usage:

- `GET /currencies`
- `GET /currencies/{currency_id}/market-snapshot`
- `GET /indices`
- `GET /indices/{index_ticker}/market-snapshot`
- `GET /macro/events`

The browser never receives the SoSoValue API key. It calls SplitChain's API route:

```txt
GET /api/market/assets?symbols=USDC,ETH,BTC,SOL,POL,BNB
```

### SoSoValue Indexes

SSI index context powers the analytics and settlement recommendation views:

```txt
GET /api/market/indexes?tickers=ssimag7,ssilayer1
```

### SoSoValue Macro

Upcoming macroeconomic events power the Macro guard in analytics and settlement recommendations:

```txt
GET /api/macro/events?days=21
```

The endpoint reads real SoSoValue `/macro/events` data server-side, filters it to the requested upcoming window, caches it for 15 minutes, and returns an explicit unavailable state if the upstream API or key is unavailable.

### SoDEX

SoDEX public spot tickers power the spot signal panel:

```txt
GET /api/sodex/tickers?symbols=vETH_vUSDC,vBTC_vUSDC,vSOL_vUSDC,vBNB_vUSDC
```

The app now matches the base token exactly, avoiding misleading USDC quote-pair matches.

### Supabase

Supabase persistence is optional. When configured, users can save/load workspace data through:

```txt
GET /api/workspace?owner=<wallet>
POST /api/workspace?owner=<wallet>
```

Both operations require a fresh wallet signature. Saves also verify a payload hash before writing to Supabase.

Recommended table:

```sql
create table if not exists splitchain_workspaces (
  owner text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
```

## Environment Variables

Create `.env.local` from `.env.example` for local development. Real secrets should only live in `.env.local` and deployment environment settings.

```bash
SOSOVALUE_API_KEY=your_sosovalue_api_key
SOSOVALUE_API_BASE=https://openapi.sosovalue.com/openapi/v1
SODEX_SPOT_BASE=https://testnet-gw.sodex.dev/api/v1/spot
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ANON_KEY=
SUPABASE_WORKSPACE_TABLE=splitchain_workspaces
PORT=8787
```

## Run Locally

```bash
npm install
npm run dev
```

Local services:

- Frontend: `http://localhost:5173`
- API: `http://localhost:8787`

## Verification

```bash
npm test
npm run lint
node_modules/.bin/tsc -b --pretty false
npm run build
npm audit --audit-level=high
```

Useful smoke checks:

```bash
curl http://localhost:8787/api/health
curl "http://localhost:8787/api/market/assets?symbols=USDC,ETH,BTC,SOL,POL,MATIC,BNB"
curl "http://localhost:8787/api/market/indexes?tickers=ssimag7,ssilayer1"
curl "http://localhost:8787/api/macro/events?days=21"
curl "http://localhost:8787/api/sodex/tickers?symbols=vETH_vUSDC,vBTC_vUSDC,vSOL_vUSDC,vBNB_vUSDC"
```

## Vercel Deployment

The project is configured with `vercel.json`:

- Vite build command: `npm run build`
- Output directory: `dist`
- SPA rewrites for non-API routes
- Root `api/` functions for production API routes

Required production env vars:

```txt
SOSOVALUE_API_KEY
```

Optional production env vars:

```txt
SOSOVALUE_API_BASE
SODEX_SPOT_BASE
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_ANON_KEY
SUPABASE_WORKSPACE_TABLE
```

Deploy:

```bash
npx vercel --prod
```

## Project Structure

```txt
api/
  health.ts
  macro/events.ts
  market/assets.ts
  market/indexes.ts
  sodex/tickers.ts
  workspace.ts

server/
  index.ts
  splitchainApi.ts

src/
  App.tsx
  App.css
  data/chains.ts
  hooks/usePersistentState.ts
  lib/finance.ts
  lib/wallet.ts
  lib/workspace.ts
  lib/workspaceAuth.ts
  types.ts

tests/
  finance.test.ts
  server.test.ts
  workspace.test.ts
```

## Safety Notes

- SplitChain is non-custodial.
- API keys are server-side only.
- Market, index, macro, and spot data are fetched from real APIs; unavailable upstream data is shown explicitly instead of silently faked.
- Real secrets are not committed.
- Cloud workspace writes require wallet ownership proof.
- ERC-20 settlement uses direct `transfer()` calls.
- Pending or failed transactions do not reduce balances.
- Public demo wallet addresses are demo-only and not private credentials.
