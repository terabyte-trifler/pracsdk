import { ethers } from "ethers";
// import ABI straight from the compiled contract
import OCCR_JSON from "../../artifacts/contracts/OCCRScorer.sol/OCCRScorer.json";

export const OCCR_SCORER_ABI = OCCR_JSON.abi;

export function getScorerContract(
  address: string,
  providerOrSigner: ethers.Provider | ethers.Signer
) {
  return new ethers.Contract(address, OCCR_SCORER_ABI, providerOrSigner);
}
