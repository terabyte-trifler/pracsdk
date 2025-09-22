import { ethers } from "hardhat";

async function main() {
  const [,, userArg, scorerAddrArg] = process.argv;
  if (!userArg || !scorerAddrArg) {
    console.log("Usage: hardhat run scripts/read-score.ts --network <net> <user> <scorerAddress>");
    process.exit(1);
  }
  const scorer = await ethers.getContractAt("OCCRScorer", scorerAddrArg);
  const [score, tier] = await scorer.calculateRiskScore(userArg);
  console.log("User:", userArg, "Score1000:", score.toString(), "Tier:", tier.toString());
}

main().catch((e)=>{ console.error(e); process.exit(1); });
