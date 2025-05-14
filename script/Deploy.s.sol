// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {RFPContract} from "../contracts/RFPContract.sol";

contract RFPDeployScript is Script {
    RFPContract public rfpContract;

    function setUp() public {}

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        rfpContract = new RFPContract();

        vm.stopBroadcast();
    }
}
