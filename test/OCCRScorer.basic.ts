import { expect } from "chai";
import { ethers } from "hardhat";

describe("OCCRScorer Day-1", function () {
  it("deploys and stores/reads score via oracle", async () => {
    const [admin, oracle, user] = await ethers.getSigners();
    const algoId = ethers.encodeBytes32String("probabilistic-bayes-v1");

    const Scorer = await ethers.getContractFactory("OCCRScorer");
    const scorer = await Scorer.deploy(admin.address, oracle.address, algoId);
    await scorer.waitForDeployment();

    const stale = await scorer.calculateRiskScore(user.address);
    expect(stale[0]).to.equal(0n);
    expect(stale[1]).to.equal(3);

    await scorer.connect(oracle).updateScore(user.address, 845, 0);

    const res = await scorer.calculateRiskScore(user.address);
    expect(res[0]).to.equal(845n);
    expect(res[1]).to.equal(0);

    expect(await scorer.validateScore(user.address, 800)).to.equal(true);
    expect(await scorer.validateScore(user.address, 900)).to.equal(false);

    await scorer.connect(admin).setTTL(1);
    await ethers.provider.send("evm_increaseTime", [2]);
    await ethers.provider.send("evm_mine", []);

    const stale2 = await scorer.calculateRiskScore(user.address);
    expect(stale2[0]).to.equal(0n);
    expect(stale2[1]).to.equal(3);
  });

  it("only oracle can update score; only admin changes params", async () => {
    const [admin, oracle, user, attacker] = await ethers.getSigners();
    const Scorer = await ethers.getContractFactory("OCCRScorer");
    const scorer = await Scorer.deploy(
      admin.address,
      oracle.address,
      ethers.encodeBytes32String("v1"),
    );
    await scorer.waitForDeployment();

    await expect(
      scorer.connect(attacker).updateScore(user.address, 500, 2),
    ).to.be.reverted;

    await expect(scorer.connect(attacker).setTTL(999)).to.be.reverted;

    await scorer.connect(oracle).updateScore(user.address, 500, 2);
    const res = await scorer.calculateRiskScore(user.address);
    expect(res[0]).to.equal(500n);
    expect(res[1]).to.equal(2);
  });
});