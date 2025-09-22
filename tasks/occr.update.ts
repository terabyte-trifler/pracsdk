import { task } from "hardhat/config";
import { computeOCCR } from "../src/math/occr";
import { sample as sampleData } from "../src/data/sample";

task("occr:update", "Compute OCCR off-chain and push on-chain")
  .addParam("user", "User wallet address")
  .addParam("scorer", "OCCRScorer contract address")
  .setAction(async ({ user, scorer }, hre) => {
    const { ethers, network } = hre;

    // 1) choose data source: for now we use sampleData; later swap a real fetcher for `user`
    const result = computeOCCR(sampleData);
    const tierToUint = (t: 'A'|'B'|'C'|'D') => (t==='A'?0:t==='B'?1:t==='C'?2:3);

    console.log("Network      :", network.name);
    console.log("User         :", user);
    console.log("Subscores    :", result);
    console.log("CompositeProb:", result.occrProb.toFixed(4), "Score1000:", result.score1000, "Tier:", result.tier);

    // 2) call scorer.updateScore as the authorized signer
    const [signer] = await ethers.getSigners();
    const scorerCtr = await ethers.getContractAt("OCCRScorer", scorer, signer);
    const tx = await scorerCtr.updateScore(user, result.score1000, tierToUint(result.tier));
    const rcpt = await tx.wait();
    console.log("updateScore tx:", rcpt?.hash);
  });
