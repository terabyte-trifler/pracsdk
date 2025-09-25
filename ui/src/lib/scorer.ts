// src/lib/scorer.ts
import { ethers } from "ethers";
// ABI exported by hardhat-abi-exporter into ui/src/abi/OCCRScorer.json
import OCCR_SCORER_ABI from "../abi/OCCRScorer.json";

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

function asNumber(x: bigint | number): number {
  return typeof x === "bigint" ? Number(x) : x;
}

function decodeAlgoId(algoHex: string): string {
  try {
    // ethers v6 has decodeBytes32String
    return ethers.decodeBytes32String(algoHex);
  } catch {
    // if it wasn't a valid bytes32 string, just return hex
    return algoHex;
  }
}

// -------- Provider / Signer helpers (optional convenience) --------
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
 * Read (score1000, tier, algorithmId, lastUpdated) from OCCRScorer.
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
  // Expecting 4-tuple as per the updated contract ABI
  const [scoreBn, tierNumBn, algoHex, lastBn] = await ctr.calculateRiskScore(
    ethers.getAddress(userAddress)
  );

  const score1000 = asNumber(scoreBn);
  const tierIdx = asNumber(tierNumBn);
  const tier: TierLetter = TIER_MAP[Math.min(Math.max(tierIdx, 0), 3)];
  const algorithmId = decodeAlgoId(algoHex);
  const lastUpdated = asNumber(lastBn);

  return {
    score1000,
    tier,
    algorithmId,
    lastUpdated,
    raw: {
      score1000: scoreBn,
      tierNum: tierIdx,
      algorithmIdHex: algoHex,
      lastUpdated: lastBn,
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
  return await ctr.validateScore(ethers.getAddress(userAddress), Math.max(0, Math.min(1000, Math.floor(minScore))));
}

// -------- Write (optional) --------
/**
 * Update score (requires an authorized updater signer).
 * This is handy for Hedera/RSK demos if you’re manually setting a score.
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
