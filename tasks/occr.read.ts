import { task } from "hardhat/config";
import { isAddress, getAddress } from "ethers";

task("occr:read", "Read current score/tier for a user")
  .addParam("scorer")
  .addParam("user")
  .setAction(async ({ scorer, user }, hre) => {
    const { ethers } = hre;
    if (!isAddress(scorer) || !isAddress(user)) throw new Error("bad args");
    const ctr = await ethers.getContractAt("OCCRScorer", getAddress(scorer));
    const [score, tier] = await ctr.calculateRiskScore(getAddress(user));
    console.log("score:", score.toString(), "tier:", tier);
  });
