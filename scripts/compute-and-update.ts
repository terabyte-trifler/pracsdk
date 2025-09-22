// scripts/compute-and-update.ts
import 'dotenv/config';
import hre, { ethers, network } from 'hardhat';
import { Wallet, JsonRpcProvider, isAddress, getAddress } from 'ethers';

// ---- OCCR math (your implementation) ----
import { computeOCCR } from '../src/math/occr';

// ---- Data loaders (live) ----
import { fetchWalletBalances } from '../src/wallet/alchemy';
import { toUSD } from '../src/wallet/valuations';
import { fetchAavePositions } from '../src/defi/aaveV3';
import { fetchCompoundV3 } from '../src/defi/compoundV3';

// ---- Pyth helpers (for USD-izing borrows) ----
import { fetchPythLatest } from '../src/prices/pyth';
import { symbolToPythId } from '../src/prices/map';

// ---------------- CLI ARGS ----------------
function parseArgs() {
  // Preferred usage: hardhat task with flags; but for direct script runs we accept positionals.
  // node hardhat run scripts/compute-and-update.ts --network <net> <user> <scorer>
  const [, , walletArg, scorerAddrArg] = process.argv;

  const envUser = process.env.USER_ADDRESS;
  const envScorer =
    process.env.OCCR_SCORER_ADDRESS ||
    process.env.SCORER_ADDRESS_SEPOLIA ||
    process.env.SCORER_ADDRESS_HARDHAT;

  const user = walletArg && walletArg.startsWith('0x') ? walletArg : envUser;
  const scorer = scorerAddrArg || envScorer || '';

  if (!user || !isAddress(user)) {
    throw new Error(
      `Missing or invalid user address. Pass as positional arg or set USER_ADDRESS in .env`
    );
  }
  if (!scorer || !isAddress(scorer)) {
    throw new Error(
      `Missing or invalid scorer address. Pass as positional arg or set OCCR_SCORER_ADDRESS in .env`
    );
  }

  return {
    user: getAddress(user),
    scorer: getAddress(scorer),
  };
}

// ---------------- FALLBACK SIGNER ----------------
async function getSigner() {
  const hhSigners = await ethers.getSigners();
  if (hhSigners.length > 0) return hhSigners[0];

  const pk = process.env.PRIVATE_KEY;
  const rpc =
    network.name === 'sepolia'
      ? process.env.SEPOLIA_RPC
      : network.name === 'rskTestnet'
      ? process.env.RSK_TESTNET_RPC
      : network.name === 'hederaTestnet'
      ? process.env.HEDERA_EVM_RPC
      : undefined;

  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error(
      `No Hardhat signer and invalid/missing PRIVATE_KEY for ${network.name}`
    );
  }
  if (!rpc) {
    throw new Error(
      `No Hardhat signer and missing RPC URL for ${network.name}`
    );
  }
  return new Wallet(pk, new JsonRpcProvider(rpc));
}

// ---------------- SNAPSHOT (LIVE) ----------------
type AaveLike = any;
type CompLike = any;

async function fetchRealUserSnapshot(user: string) {
  // Require an Alchemy RPC to read balances
  const alchemy =
    process.env.ALCHEMY_RPC_SEPOLIA ||
    process.env.ALCHEMY_RPC_MAINNET ||
    process.env.ALCHEMY_RPC;
  if (!alchemy) {
    throw new Error(
      'Missing ALCHEMY RPC (ALCHEMY_RPC_SEPOLIA | ALCHEMY_RPC_MAINNET | ALCHEMY_RPC) in .env'
    );
  }

  const [balances, aave, comp] = await Promise.all([
    fetchWalletBalances(user),
    process.env.AAVE_V3_SUBGRAPH
      ? fetchAavePositions(user).catch((e) => {
          console.warn('[WARN] Aave fetch failed:', (e as Error).message);
          return null;
        })
      : null,
    process.env.COMPOUND_V3_SUBGRAPH
      ? fetchCompoundV3(user).catch((e) => {
          console.warn('[WARN] Compound fetch failed:', (e as Error).message);
          return null;
        })
      : null,
  ]);

  const usdView = await toUSD(balances);
  if (!usdView || typeof usdView.totalUsd !== 'number') {
    throw new Error('Valuation failed; check Pyth Hermes configuration');
  }

  const liquidationEvents =
    (aave?.liquidations?.length ?? 0) + (comp?.liquidations?.length ?? 0);

  const totalBorrowsUsd = await estimateTotalBorrowUsd(aave, comp);

  return {
    balances,
    usdView, // totalUsd + per-token valuation details
    aave,
    comp,
    features: {
      currentCollateralUsd: usdView.totalUsd,
      liquidationEvents,
      totalBorrowsUsd,
    },
  };
}

async function estimateTotalBorrowUsd(
  aave: AaveLike,
  comp: CompLike
): Promise<number> {
  const neededSymbols = new Set<string>();

  if (aave?.userReserves) {
    for (const ur of aave.userReserves) {
      const sym = (ur?.reserve?.symbol ?? '').toUpperCase();
      if (sym) neededSymbols.add(sym);
    }
  }
  if (comp?.accounts?.length) {
    for (const p of comp.accounts[0]?.positions ?? []) {
      const sym = (p?.asset?.symbol ?? '').toUpperCase();
      if (sym) neededSymbols.add(sym);
    }
  }

  const ids: string[] = [];
  const symToId: Record<string, string> = {};
  for (const s of neededSymbols) {
    const id = symbolToPythId[s];
    if (id) {
      ids.push(id);
      symToId[s] = id;
    }
  }

  const prices = ids.length ? await fetchPythLatest(ids) : {};
  const getPx = (sym: string): number | undefined => {
    const id = symToId[sym];
    return id ? prices[id]?.price : undefined;
  };

  let usd = 0;

  if (aave?.userReserves) {
    for (const ur of aave.userReserves) {
      const dec = Number(ur?.reserve?.decimals ?? 18);
      const sym = (ur?.reserve?.symbol ?? '').toUpperCase();
      const px = getPx(sym) ?? 0;
      const varDebtUnits = Number(ur?.scaledVariableDebt ?? 0) / 10 ** dec;
      usd += varDebtUnits * px;
    }
  }

  if (comp?.accounts?.length) {
    for (const p of comp.accounts[0]?.positions ?? []) {
      const dec = Number(p?.asset?.decimals ?? 18);
      const sym = (p?.asset?.symbol ?? '').toUpperCase();
      const px = getPx(sym) ?? 0;
      const borrowUnits = Number(p?.borrowBalance ?? 0) / 10 ** dec;
      usd += borrowUnits * px;
    }
  }

  return usd;
}

// ---------------- ADAPTER INTO YOUR MATH ----------------
function buildOCCRInputFromSnapshot(
  snap: Awaited<ReturnType<typeof fetchRealUserSnapshot>>
) {
  const {
    features: { currentCollateralUsd, liquidationEvents, totalBorrowsUsd },
  } = snap;

  // Utilization proxy in [0,1]
  const utilization =
    currentCollateralUsd > 0
      ? Math.min(totalBorrowsUsd / currentCollateralUsd, 1)
      : 0;

  // Basic activity proxies (upgrade later with true tx/graph features)
  const txActivityScore = Array.isArray(snap.usdView?.components)
    ? Math.min(snap.usdView.components.length / 5, 1) // more distinct assets ⇒ more activity
    : 0.2;

  const newCredit =
    (snap.aave?.borrows?.length ?? 0) + (snap.comp?.accounts?.length ? 1 : 0);

  const occrInput = {
    wallet: snap as any, // keep raw snapshot if your math wants to dig into components
    history: {
      liquidations: liquidationEvents,
      totalBorrowsUsd,
      totalRepaysUsd: 0, // TODO: wire from Aave/Comp repay events if needed
    },
    current: {
      collateralUsd: currentCollateralUsd,
      utilization,
      healthRatio:
        currentCollateralUsd > 0
          ? currentCollateralUsd / Math.max(totalBorrowsUsd, 1e-9)
          : 10,
    },
    behavior: {
      txActivityScore,
      newCreditCount: newCredit,
    },
    market: {
      // TODO: compute σ via Pyth Hermes time-series; placeholder keeps model running
      sigmaAnnualized: 0.6,
    },
  };

  return occrInput;
}

// ---------------- MAIN ----------------
async function main() {
  const { user, scorer } = parseArgs();

  // 1) pull live snapshot
  const snap = await fetchRealUserSnapshot(user);
  if (!snap?.usdView || typeof snap.usdView.totalUsd !== 'number') {
    throw new Error('Live snapshot incomplete (no USD valuation)');
  }

  // 2) compute OCCR
  const occrInput = buildOCCRInputFromSnapshot(snap);
  const result = computeOCCR(occrInput);

  // 3) logs
  console.log('Network      :', network.name);
  console.log('User         :', user);
  console.log('Live Data    : yes');
  console.log('Subscores    :', result);
  console.log(
    'CompositeProb:',
    result.occrProb.toFixed(4),
    'Score1000:',
    result.score1000,
    'Tier:',
    result.tier
  );

  // 4) push on-chain
  const signer = await getSigner();
  const scorerCtr = await ethers.getContractAt('OCCRScorer', scorer, signer);

  const tx = await scorerCtr.updateScore(
    user,
    result.score1000,
    tierToUint(result.tier)
  );
  const rcpt = await tx.wait();
  console.log('updateScore tx:', rcpt?.hash);
}

function tierToUint(t: 'A' | 'B' | 'C' | 'D'): number {
  return t === 'A' ? 0 : t === 'B' ? 1 : t === 'C' ? 2 : 3;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
