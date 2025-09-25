import { task } from "hardhat/config";
import fs from "fs";
import path from "path";
import { ethers } from "ethers";

task("occr:functions:request", "Request score via Chainlink Functions")
  .addParam("consumer", "OCCRFunctionsConsumer address")
  .addParam("user", "Target wallet address")
  .setAction(async ({ consumer, user }, hre) => {
    const { ethers: hhEthers, network } = hre;

    if (!ethers.isAddress(consumer)) throw new Error("Invalid consumer");
    if (!ethers.isAddress(user)) throw new Error("Invalid user");

    const router = process.env.CHAINLINK_FUNCTIONS_ROUTER!;
    const donId = process.env.CHAINLINK_DON_ID!;
    const subId = BigInt(process.env.CHAINLINK_SUBSCRIPTION_ID!);
    const gasLimit = 300_000;

    if (!router || !donId || !subId) {
      throw new Error("Missing CHAINLINK_FUNCTIONS_ROUTER / DON_ID / SUBSCRIPTION_ID");
    }

    const [signer] = await hhEthers.getSigners();
    const ctr = await hhEthers.getContractAt("OCCRFunctionsConsumer", consumer, signer);

    const sourcePath = path.join(process.cwd(), "functions", "occr-source.js");
    const source = fs.readFileSync(sourcePath, "utf8");

    const args = ethers.AbiCoder.defaultAbiCoder().encode(["string"], [user]);

    const tx = await ctr.requestScore(
      subId,
      ethers.id(donId),          // or pass donId if router expects bytes32 (confirm the API)
      ethers.toUtf8Bytes(source),
      "0x",                      // secrets (none)
      args,
      gasLimit
    );
    const rcpt = await tx.wait();
    console.log("Request sent, tx:", rcpt?.hash);
  });
