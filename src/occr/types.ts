// src/occr/types.ts
export type Hex = `0x${string}`;

export type TxDir = "credit" | "debit";

export interface WalletTx {
  hash: string;
  timestamp: number;      // unix seconds
  valueUSD: number;       // normalized to USD
  direction: TxDir;       // + credit / - debit
}

export interface LoanEvent {
  protocol: string;       // e.g. 'aave', 'compound', 'maker'
  loanId: string;
  openedAt: number;       // unix seconds
  closedAt?: number;      // if repaid
  liquidated?: boolean;   // liquidation flag
  loanUSD: number;        // L_i,j in USD at open
  // per-loan collateral composition
  collaterals: Array<{
    symbol: string;       // e.g. 'ETH','WBTC','USDC'
    amount: number;       // units
    usdAtOpen: number;    // C_{i,j,k} (USD)
    volatility: number;   // σ_asset estimate (we'll fill via Pyth)
  }>;
  ltvAtOpen: number;      // LTV_{i,j} at open
  liquidatedPortion?: number; // p_{i,j} in paper (0..1), optional
}

export interface CurrentHolding {
  // sum of wallet’s marked-to-market holdings (USD)
  totalUSD: number;       // H_i
}

export interface WalletView {
  address: Hex;
  txs: WalletTx[];
  loans: LoanEvent[];
  holding: CurrentHolding;
}
