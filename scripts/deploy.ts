// scripts/deploy.ts
/// <reference types="hardhat" />
import 'dotenv/config';
import hre from 'hardhat';
import { Wallet, JsonRpcProvider } from 'ethers';

async function getSigner() {
  const { ethers, network } = hre;
  const hhSigners = await ethers.getSigners();
  if (hhSigners.length) return hhSigners[0];

  const pk  = process.env.PRIVATE_KEY;
  const rpc =
    network.name === 'sepolia'     ? process.env.SEPOLIA_RPC :
    network.name === 'rskTestnet'  ? process.env.RSK_TESTNET_RPC :
    network.name === 'hederaTestnet' ? process.env.HEDERA_EVM_RPC :
    undefined;

  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error(`No Hardhat signer and invalid/missing PRIVATE_KEY for ${network.name}`);
  }
  if (!rpc) {
    throw new Error(`No Hardhat signer and missing RPC URL for ${network.name}`);
  }
  return new Wallet(pk, new JsonRpcProvider(rpc));
}

async function main() {
  const { ethers, network } = hre;

  const deployer = await getSigner();
  const oracle   = deployer; // Day-2: same signer as oracle

  const deployerAddr = await deployer.getAddress();
  const oracleAddr   = await oracle.getAddress();

  const algorithmId = ethers.encodeBytes32String('probabilistic-bayes-v1');

  const Scorer = await ethers.getContractFactory('OCCRScorer', deployer);
  const scorer = await Scorer.deploy(deployerAddr, oracleAddr, algorithmId);
  await scorer.waitForDeployment();

  // ethers v6: deployed address on .target
  const scorerAddr = (scorer as any).target as string;

  console.log('Network :', network.name);
  console.log('Deployer:', deployerAddr);
  console.log('Oracle  :', oracleAddr);
  console.log('OCCRScorer deployed at:', scorerAddr);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
