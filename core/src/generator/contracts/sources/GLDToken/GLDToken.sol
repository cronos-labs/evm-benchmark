// contracts/GLDToken.sol
// SPDX-License-Identifier: MIT
pragma solidity =0.5.16;

import '@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol';
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/token/ERC20/ERC20Mintable.sol';


contract GLDToken is ERC20, ERC20Detailed, ERC20Mintable {
    constructor (string memory name, string memory symbol, uint8 decimals)
        public
        ERC20Detailed(name, symbol, decimals)
    {
        _mint(msg.sender, 10000000000000000000000000000000000);
    }

}