/*
import { PortfolioSnapshot } from "../../src/types.js";

export const sample: PortfolioSnapshot = {
  wallet: "0x1111111111111111111111111111111111111111",
  holdingsUSD: 25000,
  loansHistory: [
    {
      id: "L1",
      openedAt: new Date(Date.now() - 120*24*3600*1000).toISOString(),
      amountUSD: 5000,
      ltvAtOpen: 0.7,
      collaterals: [{symbol:"ETH", amountUSD:8000, sigma:0.8}],
      liquidated: false,
      liquidatedProportion: 0
    },
    {
      id: "L2",
      openedAt: new Date(Date.now() - 60*24*3600*1000).toISOString(),
      amountUSD: 7000,
      ltvAtOpen: 0.75,
      collaterals: [{symbol:"ETH", amountUSD:10000, sigma:0.8},{symbol:"USDC", amountUSD:2000, sigma:0.05}],
      liquidated: true,
      liquidatedProportion: 0.5
    },
    {
      id: "L3",
      openedAt: new Date(Date.now() - 15*24*3600*1000).toISOString(),
      amountUSD: 4000,
      ltvAtOpen: 0.8,
      collaterals: [{symbol:"WBTC", amountUSD:7000, sigma:0.6}],
      liquidated: false,
      liquidatedProportion: 0
    }
  ],
  currentPositions: [
    { symbol: "ETH", collateralUSD: 12000, debtUSD: 6000, sigma: 0.8, ltvMax: 0.78 },
    { symbol: "WBTC", collateralUSD: 9000,  debtUSD: 4500, sigma: 0.6, ltvMax: 0.75 }
  ],
  transactions: [
    { ts: new Date(Date.now()-5*24*3600*1000).toISOString(),  amountUSD: 1500, credit: true  },
    { ts: new Date(Date.now()-3*24*3600*1000).toISOString(),  amountUSD:  800, credit: false },
    { ts: new Date(Date.now()-1*24*3600*1000).toISOString(),  amountUSD: 2000, credit: true  }
  ]
};
*/