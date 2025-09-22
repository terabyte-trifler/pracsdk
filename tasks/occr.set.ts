import { task } from "hardhat/config";
import { isAddress, getAddress } from "ethers";

const tierToUint = (t: string) => t.toUpperCase()==='A'?0:t.toUpperCase()==='B'?1:t.toUpperCase()==='C'?2:3;

task("occr:set", "Manually set a user's OCCR score on-chain")
  .addParam("scorer", "OCCRScorer address")
  .addParam("user", "User wallet address")
  .addParam("score", "Score on 0..1000")
  .addParam("tier", "Tier: A|B|C|D")
  .setAction(async ({ scorer, user, score, tier }, hre) => {
    const { ethers, network } = hre;
    if (!isAddress(scorer)) throw new Error("Invalid scorer");
    if (!isAddress(user))   throw new Error("Invalid user");

    const signer = (await ethers.getSigners())[0];
    const ctr = await ethers.getContractAt("OCCRScorer", getAddress(scorer), signer);

    const t = tierToUint(tier);
    const s = Math.max(0, Math.min(1000, Number(score)|0));

    console.log("Network:", network.name);
    console.log("Scorer :", scorer);
    console.log("User   :", user);
    console.log("Score  :", s, "Tier:", tier, "(->", t, ")");

    const tx = await ctr.updateScore(getAddress(user), s, t);
    const rcpt = await tx.wait();
    console.log("updateScore tx:", rcpt?.hash);
  });
