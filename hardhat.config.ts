// hardhat.config.ts
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-abi-exporter";   // 👈 added
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
  abiExporter: {                          // 👈 new section
    path: "./ui/src/abi",                 // export ABIs into your UI project
    runOnCompile: true,                   // run automatically when you compile
    clear: true,                          // clear old files before export
    flat: true,                           // don't create nested folders
    only: ["OCCRScorer"],                 // only export your scorer contract
    spacing: 2,
    format: "json"
  },
};

export default config;

// register Hardhat tasks
import "./tasks/occr.update";
import "./tasks/occr.set";
import "./tasks/occr.read";
import "./tasks/occr.functions";
