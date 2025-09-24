// scripts/whoami.ts
import hre from "hardhat";
import { Wallet, JsonRpcProvider, formatEther } from "ethers";

async function main() {
  const { network } = hre;

  const pk = process.env.PRIVATE_KEY;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error("PRIVATE_KEY is missing/invalid (needs 0x + 64 hex chars)");
  }

  const rpc =
    network.name === "hederaTestnet"
      ? process.env.HEDERA_EVM_RPC
      : network.name === "rskTestnet"
      ? process.env.RSK_TESTNET_RPC
      : process.env.SEPOLIA_RPC;

  if (!rpc) throw new Error(`Missing RPC for ${network.name}`);

  const provider = new JsonRpcProvider(rpc);
  const wallet = new Wallet(pk, provider);

  const addr = await wallet.getAddress();
  const bal = await provider.getBalance(addr);

  console.log("Network:", network.name);
  console.log("Deployer address:", addr);
  console.log("Balance:", formatEther(bal));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
