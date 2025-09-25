// ui/src/lib/scorer.ts
import { ethers } from "ethers";
import OCCR_SCORER_JSON from "../abi/OCCRScorer.json";

// -------- Types --------
export type TierLetter = "A" | "B" | "C" | "D";

export type RiskScore = {
  score1000: number;     // 0..1000
  tier: TierLetter;      // A..D (A best)
  algorithmId: string;   // bytes32 decoded (or 0x… if undecodable)
  lastUpdated: number;   // unix seconds
  raw: {
    score1000: bigint;
    tierNum: number;
    algorithmIdHex: string;
    lastUpdated: bigint;
  };
};

// -------- Small utilities --------
const TIER_MAP: TierLetter[] = ["A", "B", "C", "D"];

function decodeAlgoId(hex32: string): string {
  try {
    return ethers.decodeBytes32String(hex32);
  } catch {
    return hex32; // fallback if not valid UTF-8 bytes32
  }
}

// -------- Provider / Signer helpers --------
export function getJsonRpcProvider(rpcUrl: string): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(rpcUrl);
}

export async function getBrowserProvider(): Promise<ethers.BrowserProvider> {
  if (typeof window === "undefined" || !(window as any).ethereum) {
    throw new Error("No injected EVM provider found (MetaMask, etc.)");
  }
  return new ethers.BrowserProvider((window as any).ethereum);
}

export async function getBrowserSigner(): Promise<ethers.Signer> {
  const provider = await getBrowserProvider();
  await provider.send("eth_requestAccounts", []);
  return await provider.getSigner();
}

// -------- Contract factory --------
export const OCCR_SCORER_ABI = (OCCR_SCORER_JSON as any).abi;

export function getScorerContract(
  address: string,
  providerOrSigner: ethers.Provider | ethers.Signer
): ethers.Contract {
  if (!ethers.isAddress(address)) {
    throw new Error(`Invalid contract address: ${address}`);
  }
  return new ethers.Contract(address, OCCR_SCORER_ABI, providerOrSigner);
}

// -------- Reads --------
/**
 * Read (score1000, tier, algorithmId, lastUpdated) from OCCRScorer and
 * return a fully-typed RiskScore object (plus raw values).
 */
export async function readRiskScore(
  scorerAddress: string,
  provider: ethers.Provider,
  userAddress: string
): Promise<RiskScore> {
  if (!ethers.isAddress(userAddress)) {
    throw new Error(`Invalid user address: ${userAddress}`);
  }
  const ctr = getScorerContract(scorerAddress, provider);

  const [score1000, tierNumBN, algorithmIdHex, lastUpdatedBN] =
    await ctr.calculateRiskScore(ethers.getAddress(userAddress));

  const tierNum = Number(tierNumBN);
  const tier = TIER_MAP[Math.max(0, Math.min(3, tierNum))];

  return {
    score1000: Number(score1000),
    tier,
    algorithmId: decodeAlgoId(algorithmIdHex),
    lastUpdated: Number(lastUpdatedBN),
    raw: {
      score1000,
      tierNum,
      algorithmIdHex,
      lastUpdated: lastUpdatedBN,
    },
  };
}

/**
 * Call validateScore(user, minScore) → boolean
 */
export async function validateScore(
  scorerAddress: string,
  provider: ethers.Provider,
  userAddress: string,
  minScore: number
): Promise<boolean> {
  if (!ethers.isAddress(userAddress)) {
    throw new Error(`Invalid user address: ${userAddress}`);
  }
  const ctr = getScorerContract(scorerAddress, provider);
  return await ctr.validateScore(
    ethers.getAddress(userAddress),
    Math.max(0, Math.min(1000, Math.floor(minScore)))
  );
}

// -------- Write (optional) --------
/**
 * Update score (requires an authorized updater signer).
 * Handy for Hedera/RSK demos when manually setting a score.
 */
export async function updateScoreOnChain(
  scorerAddress: string,
  signer: ethers.Signer,
  userAddress: string,
  score1000: number,
  tier: TierLetter
): Promise<string> {
  const ctr = getScorerContract(scorerAddress, signer);
  const tierNum = tier === "A" ? 0 : tier === "B" ? 1 : tier === "C" ? 2 : 3;
  const tx = await ctr.updateScore(
    ethers.getAddress(userAddress),
    Math.max(0, Math.min(1000, Math.floor(score1000))),
    tierNum
  );
  const rcpt = await tx.wait();
  return rcpt?.hash ?? tx.hash;
}
