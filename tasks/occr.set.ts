// tasks/occr.set.ts
import { task } from "hardhat/config";
import { isAddress, getAddress, parseUnits } from "ethers";

function tierToUint(t: string): number {
  const u = t.toUpperCase();
  if (u === "A") return 0;
  if (u === "B") return 1;
  if (u === "C") return 2;
  if (u === "D") return 3;
  throw new Error(`Invalid tier: ${t} (must be A, B, C, or D)`);
}

task("occr:set", "Manually set a user's OCCR score on-chain")
  .addParam("scorer", "OCCRScorer contract address")
  .addParam("user", "User wallet address")
  .addParam("score", "Score in range 0..1000")
  .addParam("tier", "Tier letter: A|B|C|D")
  .addOptionalParam("gasprice", "Gas price in gwei (for RSK/Hedera)", undefined)
  .setAction(async ({ scorer, user, score, tier, gasprice }, hre) => {
    const { ethers, network } = hre;

    if (!isAddress(scorer)) throw new Error(`Invalid scorer address: ${scorer}`);
    if (!isAddress(user)) throw new Error(`Invalid user address: ${user}`);

    const signer = (await ethers.getSigners())[0];
    const ctr = await ethers.getContractAt("OCCRScorer", getAddress(scorer), signer);

    const s = Math.max(0, Math.min(1000, Number(score) | 0));
    const t = tierToUint(tier);

    console.log("Network :", network.name);
    console.log("Scorer  :", getAddress(scorer));
    console.log("User    :", getAddress(user));
    console.log("Score   :", s);
    console.log("Tier    :", tier.toUpperCase(), "→", t);
    console.log("Signer  :", await signer.getAddress());

    const opts: any = {};
    if (gasprice) {
      opts.gasPrice = parseUnits(gasprice, "gwei");
      console.log("GasPrice:", opts.gasPrice.toString(), "wei");
    }

    const tx = await ctr.updateScore(getAddress(user), s, t, opts);
    console.log("Tx sent :", tx.hash);
    const rcpt = await tx.wait();
    console.log("Mined in block:", rcpt?.blockNumber);
  });
