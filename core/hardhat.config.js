require('@matterlabs/hardhat-zksync-deploy');
require('@matterlabs/hardhat-zksync-solc');
const config = require('../config.json');
/** @type import('hardhat/config').HardhatUserConfig */

const getNetwork = (config) => {
  if (config.network.benchmark === true) {
    return config.network;
  }

  if (config.network.layer2.benchmark === true) {
    return config.network.layer2;
  }
};

const network = getNetwork(config);

module.exports = {
  solidity: {
    compilers: [
      {
        version: '0.5.16',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: '0.6.6',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },

    ],
  },
  paths: {
    sources: 'src/generator/contracts/sources',
    artifacts: 'src/generator/contracts/artifacts',
    cache: 'src/generator/contracts/cache',
    deploy: 'src/generator/deploy'
  },
  // zkSync Config
  zksolc: {
    version: '1.3.1',
    compilerSource: 'binary',
    settings: {},
  },
  networks: {
    hardhat: {
      ethNetwork: 'http://localhost:8545', // URL of the Ethereum Web3 RPC, or the identifier of the network (e.g. `mainnet` or `goerli`)
      zksync: false,
      accounts: {
        mnemonic: config.account.mnemonic,
        path: "m/44'/60'/0'/0",
        initialIndex: 0,
        count: 100,
        passphrase: '',
      },
      allowBlocksWithSameTimestamp: true,
    },
    zkLocal: {
      url: config.network.layer2.node_url, // URL of the zkSync network RPC
      ethNetwork: config.network.node_url, // URL of the Ethereum Web3 RPC, or the identifier of the network (e.g. `mainnet` or `goerli`)
      zksync: true,
      allowUnlimitedContractSize: true,
      allowBlocksWithSameTimestamp: true,
    },
  },
  defaultNetwork: network.evm_type === 'zkSync' ? 'zkLocal' : 'hardhat',
};

extendEnvironment((hre) => {
  const { Web3 } = require('web3');
  hre.Web3 = Web3;

  // hre.network.provider is an EIP1193-compatible provider.
  hre.web3 = new Web3(hre.network.provider);
});
