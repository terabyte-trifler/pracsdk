// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FunctionsClient} from "@chainlink/contracts/src/v0.8/functions/v1_0_0/FunctionsClient.sol";
import {IFunctionsSubscriptions} from "@chainlink/contracts/src/v0.8/functions/v1_0_0/interfaces/IFunctionsSubscriptions.sol";
import {ConfirmedOwner} from "@chainlink/contracts/src/v0.8/shared/access/ConfirmedOwner.sol";
import {IRiskScorer} from "./IRiskScorer.sol";

interface IOCCRScorer {
  function updateScore(address user, uint256 newScore, uint8 newTier) external;
  function ORACLE_ROLE() external view returns (bytes32);
  function grantRole(bytes32 role, address account) external;
}

contract OCCRFunctionsConsumer is FunctionsClient, ConfirmedOwner {
  IOCCRScorer public scorer;
  bytes32 public lastRequestId;
  bytes public lastResponse;
  bytes public lastError;

  event Requested(bytes32 indexed id, address indexed user);
  event Fulfilled(bytes32 indexed id, uint256 score, uint8 tier);

  constructor(address router, address scorerAddr, address owner)
    FunctionsClient(router)
    ConfirmedOwner(owner)
  {
    scorer = IOCCRScorer(scorerAddr);
    // Grant ORACLE_ROLE to this consumer so it can call updateScore
    bytes32 role = scorer.ORACLE_ROLE();
    scorer.grantRole(role, address(this));
  }

  /// @notice request a score update for `user`
  function requestScore(
    uint64 subscriptionId,
    bytes32 donId,
    bytes memory source,      // inline JS
    bytes memory encryptedSecretsUrls, // optional (use empty if not needed)
    bytes memory args,        // abi.encode(user)
    uint32 gasLimit
  ) external onlyOwner returns (bytes32 reqId) {
    FunctionsRequest.Request memory req;
    req.initializeRequestForInlineJavaScript(source);
    if (encryptedSecretsUrls.length > 0) {
      req.addSecretsReference(encryptedSecretsUrls);
    }
    if (args.length > 0) {
      // We pass one arg: user address hex string
      string;
      arr[0] = abi.decode(args, (string));
      req.setArgs(arr);
    }

    reqId = _sendRequest(req.encodeCBOR(), subscriptionId, gasLimit, donId);
    lastRequestId = reqId;
    emit Requested(reqId, _parseAddrFromArg(args));
  }

  /// @dev Chainlink Functions fulfillment hook
  function _fulfillRequest(
    bytes32 requestId,
    bytes memory response,
    bytes memory err
  ) internal override {
    lastResponse = response;
    lastError = err;

    if (err.length == 0 && response.length >= 64) {
      // We expect abi.encode(score(uint256), tier(uint8)) – simplest is decode as (uint256,uint256) and cast tier
      (uint256 score, uint256 tierNum) = abi.decode(response, (uint256, uint256));
      (address user,,,) = abi.decode(lastResponse, (address,uint256,uint256,uint256)); // if you returned user too
      // If you didn’t return user, store it in a mapping keyed by requestId when you made the request.

      // Call OCCRScorer
      scorer.updateScore(user, score, uint8(tierNum));
      emit Fulfilled(requestId, score, uint8(tierNum));
    }
  }

  function _parseAddrFromArg(bytes memory args) internal pure returns (address) {
    if (args.length == 0) return address(0);
    string memory hexStr = abi.decode(args,(string));
    bytes memory b = bytes(hexStr);
    // naive parse – you can hard-check 0x + 40 hex chars
    uint160 val = 0;
    for(uint i=2;i<b.length;i++){
      val = val * 16 + uint160(_fromHexChar(uint8(b[i])));
    }
    return address(val);
  }

  function _fromHexChar(uint8 c) private pure returns (uint8) {
    if (bytes1(c) >= "0" && bytes1(c) <= "9") return c - uint8(bytes1("0"));
    if (bytes1(c) >= "a" && bytes1(c) <= "f") return 10 + c - uint8(bytes1("a"));
    if (bytes1(c) >= "A" && bytes1(c) <= "F") return 10 + c - uint8(bytes1("A"));
    revert("bad hex");
  }
}
