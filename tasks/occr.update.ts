// tasks/occr.update.ts
import "dotenv/config";
import { task } from "hardhat/config";
import { Wallet, JsonRpcProvider, isAddress, getAddress } from "ethers";

import { computeOCCR } from "../src/math/occr";

// Live data sources
import { fetchWalletBalances } from "../src/wallet/alchemy";
import { toUSD } from "../src/wallet/valuations";
import { fetchAavePositions } from "../src/defi/aaveV3";
import { fetchCompoundV3 } from "../src/defi/compoundV3";
import { fetchPythLatest } from "../src/prices/pyth";
import { symbolToPythId } from "../src/prices/map";

type AaveLike = any;
type CompLike = any;

const tierToUint = (t: "A" | "B" | "C" | "D") => (t === "A" ? 0 : t === "B" ? 1 : t === "C" ? 2 : 3);

async function getSigner(hre: any) {
  const { ethers, network } = hre;
  const hh = await ethers.getSigners();
  if (hh.length) return hh[0];

  const pk = process.env.PRIVATE_KEY;
  const rpc =
    network.name === "sepolia"
      ? process.env.SEPOLIA_RPC
      : network.name === "rskTestnet"
      ? process.env.RSK_TESTNET_RPC
      : network.name === "hederaTestnet"
      ? process.env.HEDERA_EVM_RPC
      : undefined;

  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error(`No Hardhat signer and invalid/missing PRIVATE_KEY for ${network.name}`);
  }
  if (!rpc) throw new Error(`Missing RPC URL for ${network.name}`);
  return new Wallet(pk, new JsonRpcProvider(rpc));
}

async function estimateTotalBorrowUsd(aave: AaveLike, comp: CompLike) {
  const neededSymbols = new Set<string>();

  if (aave?.userReserves) {
    for (const ur of aave.userReserves) {
      const sym = (ur?.reserve?.symbol ?? "").toUpperCase();
      if (sym) neededSymbols.add(sym);
    }
  }
  if (comp?.accounts?.length) {
    for (const p of comp.accounts[0]?.positions ?? []) {
      const sym = (p?.asset?.symbol ?? "").toUpperCase();
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

  // Aave: variable debt (units -> USD via px)
  if (aave?.userReserves) {
    for (const ur of aave.userReserves) {
      const dec = Number(ur?.reserve?.decimals ?? 18);
      const sym = (ur?.reserve?.symbol ?? "").toUpperCase();
      const px = getPx(sym) ?? 0;
      const varDebtUnits = Number(ur?.scaledVariableDebt ?? 0) / 10 ** dec;
      usd += varDebtUnits * px;
    }
  }

  // Compound v3: borrowBalance (units -> USD via px)
  if (comp?.accounts?.length) {
    for (const p of comp.accounts[0]?.positions ?? []) {
      const dec = Number(p?.asset?.decimals ?? 18);
      const sym = (p?.asset?.symbol ?? "").toUpperCase();
      const px = getPx(sym) ?? 0;
      const borrowUnits = Number(p?.borrowBalance ?? 0) / 10 ** dec;
      usd += borrowUnits * px;
    }
  }

  return usd;
}

async function fetchRealUserSnapshot(user: string) {
  // Ensure an Alchemy key is configured (any of these)
  const alchemy =
    process.env.ALCHEMY_RPC_SEPOLIA ||
    process.env.ALCHEMY_RPC_MAINNET ||
    process.env.ALCHEMY_RPC;
  if (!alchemy) {
    throw new Error("Missing ALCHEMY RPC (ALCHEMY_RPC_SEPOLIA | ALCHEMY_RPC_MAINNET | ALCHEMY_RPC)");
  }

  const [balances, aave, comp] = await Promise.all([
    fetchWalletBalances(user),
    process.env.AAVE_V3_SUBGRAPH
      ? fetchAavePositions(user).catch((e) => {
          console.warn("[WARN] Aave fetch failed:", (e as Error).message);
          return null;
        })
      : null,
    process.env.COMPOUND_V3_SUBGRAPH
      ? fetchCompoundV3(user).catch((e) => {
          console.warn("[WARN] Compound fetch failed:", (e as Error).message);
          return null;
        })
      : null,
  ]);

  const usdView = await toUSD(balances);
  if (!usdView || typeof usdView.totalUsd !== "number") {
    throw new Error("Valuation failed; check Pyth Hermes + price IDs");
  }

  const liquidationEvents =
    (aave?.liquidations?.length ?? 0) + (comp?.liquidations?.length ?? 0);

  const totalBorrowsUsd = await estimateTotalBorrowUsd(aave, comp);

  return {
    balances,
    usdView,
    aave,
    comp,
    features: {
      currentCollateralUsd: usdView.totalUsd,
      liquidationEvents,
      totalBorrowsUsd,
    },
  };
}

function buildOCCRInputFromSnapshot(
  snap: Awaited<ReturnType<typeof fetchRealUserSnapshot>>
) {
  const {
    features: { currentCollateralUsd, liquidationEvents, totalBorrowsUsd },
  } = snap;

  const utilization =
    currentCollateralUsd > 0 ? Math.min(totalBorrowsUsd / currentCollateralUsd, 1) : 0;

  const txActivityScore = Array.isArray(snap.usdView?.components)
    ? Math.min(snap.usdView.components.length / 5, 1)
    : 0.2;

  const newCredit =
    (snap.aave?.borrows?.length ?? 0) + (snap.comp?.accounts?.length ? 1 : 0);

  return {
    wallet:
      getAddress((snap as any).balances?.owner ?? "0x0000000000000000000000000000000000000000"),
    history: {
      liquidations: liquidationEvents,
      totalBorrowsUsd,
      totalRepaysUsd: 0,
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
      sigmaAnnualized: Number(process.env.DEFAULT_SIGMA ?? 0.6), // replace with Hermes rolling σ when ready
    },
  };
}

task("occr:update", "Compute OCCR off-chain and push on-chain")
  .addParam("user", "User wallet address")
  .addParam("scorer", "OCCRScorer contract address")
  .setAction(async ({ user, scorer }, hre) => {
    const { ethers, network } = hre;

    if (!isAddress(user)) throw new Error("Invalid user address");
    if (!isAddress(scorer)) throw new Error("Invalid scorer address");
    user = getAddress(user);
    scorer = getAddress(scorer);

    // 1) Live snapshot
    const snap = await fetchRealUserSnapshot(user);

    // DEBUG (use snap.*, not bare identifiers!)
    console.log("DEBUG balances:", {
      tokens: snap?.balances?.erc20?.length ?? 0,
      eth: snap?.balances?.eth,
    });
    console.log("DEBUG usdView.totalUsd:", snap?.usdView?.totalUsd ?? 0);
    console.log(
      "DEBUG aave:",
      snap?.aave
        ? {
            userReserves: snap.aave.userReserves?.length ?? 0,
            liquidations: snap.aave.liquidations?.length ?? 0,
          }
        : null
    );
    console.log(
      "DEBUG comp:",
      snap?.comp ? { accounts: snap.comp.accounts?.length ?? 0 } : null
    );

    const occrInput = buildOCCRInputFromSnapshot(snap);

    // 2) Compute
    const result = computeOCCR(occrInput);

    console.log("Network      :", network.name);
    console.log("User         :", user);
    console.log("Live Data    : yes");
    console.log("Subscores    :", result);
    console.log(
      "CompositeProb:",
      result.occrProb.toFixed(4),
      "Score1000:",
      result.score1000,
      "Tier:",
      result.tier
    );

    // 3) Push on-chain
    const signer = await getSigner(hre);
    const scorerCtr = await ethers.getContractAt("OCCRScorer", scorer, signer);
    const tx = await scorerCtr.updateScore(user, result.score1000, tierToUint(result.tier));
    const rcpt = await tx.wait();
    console.log("updateScore tx:", rcpt?.hash);
  });
