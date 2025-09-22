import { task } from "hardhat/config";

task("scorer:who", "Show owner/updater & network")
  .addParam("scorer", "OCCRScorer address")
  .setAction(async ({ scorer }, hre) => {
    const { ethers, network } = hre;
    const [signer] = await ethers.getSigners();
    const c = await ethers.getContractAt("OCCRScorer", scorer);
    console.log("Network:", network.name);
    console.log("Signer :", await signer.getAddress());
    try {
      console.log("Owner  :", await c.owner());
    } catch {}
    try {
      console.log("Updater:", await c.updater());
    } catch {}
  });
