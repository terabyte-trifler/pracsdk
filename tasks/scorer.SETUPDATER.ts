import { task } from "hardhat/config";

task("scorer:set-updater", "Set the updater/oracle address (owner only)")
  .addParam("scorer", "OCCRScorer address")
  .addParam("updater", "Updater address")
  .setAction(async ({ scorer, updater }, hre) => {
    const { ethers } = hre;
    const [signer] = await ethers.getSigners();
    const c = await ethers.getContractAt("OCCRScorer", scorer, signer);
    const tx = await c.setUpdater(updater); // make sure your contract has this; if not, redeploy with correct oracle
    console.log("setUpdater tx:", (await tx.wait())?.hash);
  });
