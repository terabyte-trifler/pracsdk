// src/data/fetcher.ts
import { WalletView, WalletTx, LoanEvent, CurrentHolding, Hex } from "../occr/types.js";
import { getPythLatestMap } from "./pyth.js";
import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";

const ALCHEMY_RPC = process.env.ALCHEMY_RPC_MAINNET || process.env.ALCHEMY_RPC_SEPOLIA;
if (!ALCHEMY_RPC) console.warn("[fetcher] No ALCHEMY RPC set; only CSV/JSON loan ingest will work.");

const SYMBOLS_TO_PRICEID: Record<string, string> = {}; // filled by pyth.ts at runtime

export async function fetchWallet(address: Hex): Promise<WalletView> {
  // 1) prices first (mid) to value things in USD
  const priceMap = await getPythLatestMap();

  // helper for USD valuation
  const priceOf = (sym: string): number | undefined => {
    const e = priceMap.get(sym.toUpperCase());
    return e?.price;
  };

  // 2) current holdings (rough + fast)
  let holdingUSD = 0;
  try {
    if (ALCHEMY_RPC) {
      const provider = new ethers.JsonRpcProvider(ALCHEMY_RPC);
      const ethBal = await provider.getBalance(address);
      const ethPrice = priceOf("ETH");
      if (ethPrice) holdingUSD += Number(ethers.formatEther(ethBal)) * ethPrice;
      // NOTE: If time permits, query common ERC20s with balanceOf and sum (USDC, WETH, WBTC…)
      // For speed, just do ETH for now; you can expand with a small list of popular tokens.
    }
  } catch (e) {
    console.warn("[fetcher] holdings fetch problem:", e);
  }
  const holding: CurrentHolding = { totalUSD: holdingUSD };

  // 3) transactions (quick route: Alchemy Transfers API or csv ingest)
  // For simplicity in a hack: we expect an optional file data/txs.json prepared with normalized txs.
  const txFile = path.join(process.cwd(), "data", "txs.json");
  let txs: WalletTx[] = [];
  if (fs.existsSync(txFile)) {
    txs = JSON.parse(fs.readFileSync(txFile, "utf8"));
  } else {
    console.warn("[fetcher] data/txs.json not found. s_ct will use a small synthetic echo of current holding.");
    // minimal fallback: one “credit” seed so s_ct math won’t break
    txs = [{
      hash: "0xseed",
      timestamp: Math.floor(Date.now() / 1000),
      valueUSD: holdingUSD,
      direction: "credit"
    }];
  }

  // 4) loans (hybrid: CSV/JSON ingest or empty)
  const loansFile = path.join(process.cwd(), "data", "loans.json");
  let loans: LoanEvent[] = [];
  if (fs.existsSync(loansFile)) {
    loans = JSON.parse(fs.readFileSync(loansFile, "utf8"));
    // plug volatilities from Pyth for each collateral line
    loans.forEach(l => {
      l.collaterals.forEach(c => {
        // naive σ estimate: we’ll set in pyth.ts; here leave as 0, compute in logic layer if needed
        c.volatility ||= 0;
      });
    });
  } else {
    console.warn("[fetcher] data/loans.json not found. Historical/current subscores will be limited.");
  }

  return { address, txs, loans, holding };
}
