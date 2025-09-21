// scripts/deploy.ts
/// <reference types="hardhat" />
import hre from "hardhat";

async function main() {
  const { ethers, network } = hre;

  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error(
      `No accounts configured for network "${network.name}". ` +
        `Set PRIVATE_KEY in .env or deploy to --network hardhat.`
    );
  }

  const deployer = signers[0];
  const oracle   = signers[1] ?? deployer;

  const deployerAddr = await deployer.getAddress();
  const oracleAddr   = await oracle.getAddress();

  const algorithmId = ethers.encodeBytes32String("probabilistic-bayes-v1");

  const Scorer = await ethers.getContractFactory("OCCRScorer", deployer);
  const scorer = await Scorer.deploy(deployerAddr, oracleAddr, algorithmId);
  await scorer.waitForDeployment();

  // In ethers v6, the deployed address is available as `.target` (string)
  const scorerAddr = (scorer as any).target as string;

  console.log("Network :", network.name);
  console.log("Deployer:", deployerAddr);
  console.log("Oracle  :", oracleAddr);
  console.log("OCCRScorer deployed at:", scorerAddr);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
