export type Address = `0x${string}`;

export type Collateral = {
  symbol: string;
  amountUSD: number;           // USD value at open (or now for current positions)
  sigma?: number;              // asset volatility proxy (stdev of returns); optional
};

export type Loan = {
  id: string;
  openedAt: string;            // ISO date
  amountUSD: number;           // Li,j
  ltvAtOpen: number;           // LTV_i,j in [0,1]
  collaterals: Collateral[];   // C_i,j,k
  liquidated?: boolean;        // X_i,j (1 if liquidated)
  liquidatedProportion?: number; // p_i,j in [0,1], default 1 for full liquidation
};

export type Transaction = {
  ts: string;                  // ISO date
  amountUSD: number;           // T_i,l >= 0
  credit: boolean;             // S_i,l: credit(+1) / debit(-1)
  recencyWeight?: number;      // t_i,l in [0,1]; if absent we compute by date
};

export type CurrentPosition = {
  symbol: string;
  collateralUSD: number;       // current collateral value
  debtUSD: number;             // current debt value
  sigma?: number;              // asset volatility proxy for Monte Carlo
  ltvMax?: number;             // protocol liquidation LTV
};

export type PortfolioSnapshot = {
  wallet: Address;
  loansHistory: Loan[];            // historical closed loans (repaid/liquidated)
  currentPositions: CurrentPosition[];
  transactions: Transaction[];     // recent on-chain txs
  holdingsUSD: number;             // H_i (current wallet holdings net of debt) for s_ci
};

export type OCCRSubscores = {
  s_h: number;   // historical credit risk
  s_c: number;   // current risk (LaR vs H)
  s_cu: number;  // credit utilization
  s_ct: number;  // on-chain transaction
  s_nc: number;  // new credit
};

export type OCCRResult = OCCRSubscores & {
  occrProb: number;          // 0..1 composite probability (paper)
  score1000: number;         // 0..1000 scaled
  tier: 'A'|'B'|'C'|'D';
};
