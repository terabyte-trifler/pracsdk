import { ethers, network } from "hardhat";
import { computeOCCR } from "../src/math/occr.js";
import { sample } from "../src/data/sample.js";

// If you prefer feeding live data, replace `sample` with a loader (Etherscan/DefiLlama/etc.)
// For now we demo with sample and your own wallet if provided via CLI.

function parseArgs() {
    const [,, walletArg, scorerAddrArg] = process.argv;
    return {
      user: (walletArg && walletArg.startsWith("0x")) ? walletArg : sample.wallet,
      scorer: scorerAddrArg || process.env.OCCR_SCORER_ADDRESS || ""
    };
  }

async function main() {
  const { user, scorer } = parseArgs();
  if (!scorer) throw new Error("Missing OCCR_SCORER_ADDRESS (env or argv).");

  // 1) Compute scores off-chain
  const res = computeOCCR(sample);

  console.log("Network      :", network.name);
  console.log("User         :", user);
  console.log("Subscores    :", res);
  console.log("CompositeProb:", res.occrProb.toFixed(4), "Score1000:", res.score1000, "Tier:", res.tier);

  // 2) Push on-chain as the authorized oracle/updater
  const [signer] = await ethers.getSigners();
  const scorerCtr = await ethers.getContractAt("OCCRScorer", scorer, signer);

  // Your OCCRScorer constructor stored an algorithmId and enforces an updater role/owner.
  const tx = await scorerCtr.updateScore(user, res.score1000, tierToUint(res.tier));
  const rcpt = await tx.wait();
  console.log("updateScore tx:", rcpt?.hash);
}

function tierToUint(t: 'A'|'B'|'C'|'D'): number {
  return (t === 'A') ? 0 : (t === 'B') ? 1 : (t === 'C') ? 2 : 3;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
