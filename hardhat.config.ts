// hardhat.config.ts
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

const PK = process.env.PRIVATE_KEY || "";
const ACCOUNTS = /^0x[0-9a-fA-F]{64}$/.test(PK) ? [PK] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    hardhat: {},
    sepolia: {
      url: process.env.SEPOLIA_RPC || "",
      accounts: ACCOUNTS,
    },
    rskTestnet: {
      url: process.env.RSK_TESTNET_RPC || "",
      accounts: ACCOUNTS,
      chainId: 31,
      gasPrice: 100000000,
    },
    hederaTestnet: {
      url: process.env.HEDERA_EVM_RPC || "",
      accounts: ACCOUNTS,
    },
  },
};

export default config;
import "./tasks/occr.update";
import "./tasks/occr.set";
import "./tasks/occr.read";

