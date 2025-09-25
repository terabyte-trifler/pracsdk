// ui/src/abi/OCCRScorer.ts
import { ethers } from "ethers";
import OCCR_JSON from "./OCCRScorer.json";

export const OCCR_SCORER_ABI = (OCCR_JSON as any)?.abi;

function assertAbiOk(abi: unknown): asserts abi is ethers.InterfaceAbi {
  if (!Array.isArray(abi)) {
    throw new Error("Invalid ABI: ./OCCRScorer.json does not contain `abi` array");
  }
}

export function getScorerContract(
  address: string,
  providerOrSigner: ethers.Provider | ethers.Signer
) {
  assertAbiOk(OCCR_SCORER_ABI);
  return new ethers.Contract(address, OCCR_SCORER_ABI, providerOrSigner);
}
