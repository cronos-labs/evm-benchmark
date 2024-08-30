import { ethers } from 'ethers';
import { config } from '../../generator/config/config.service';
import { getNetwork } from '../../lib/config';
import * as zkSyncWeb3 from 'zksync-web3';

export const DefaultPathPrefix = "m/44'/60'/0'/0/";

export const getRootSigner = () => {
  return getChildSigner(0);
};

export const getChildSigner = (index: number) => {
  const network = getNetwork(config);
  const hdNode = ethers.utils.HDNode.fromMnemonic(config.account.mnemonic);
  const rootNode = hdNode.derivePath(DefaultPathPrefix + index.toString());
  const provider = new ethers.providers.JsonRpcProvider(network.node_url);
  const signer = new ethers.Wallet(rootNode.privateKey, provider);

  return signer;
};

export const getRandomChildSigner = (index: number) => {
  const network = getNetwork(config);
  const hdNode = ethers.utils.HDNode.fromMnemonic(
    config.account.random_mnemonic,
  );
  const rootNode = hdNode.derivePath(DefaultPathPrefix + index.toString());
  const provider = new ethers.providers.JsonRpcProvider(network.node_url);
  const signer = new ethers.Wallet(rootNode.privateKey, provider);

  return signer;
};

export const getRandomMnemonic = () => {
  return ethers.utils.entropyToMnemonic(ethers.utils.randomBytes(16));
};

export const getSigner = (mnemonic: string, index: number) => {
  const network = getNetwork(config);
  const hdNode = ethers.utils.HDNode.fromMnemonic(mnemonic);
  const rootNode = hdNode.derivePath(DefaultPathPrefix + index.toString());
  const provider = new ethers.providers.JsonRpcProvider(network.node_url);
  const signer = new ethers.Wallet(rootNode.privateKey, provider);

  return signer;
};

export const getZksyncSignerFromPrivateKey = (privateKey: string) => {
  const providerL2 = new zkSyncWeb3.Provider(config.network.layer2.node_url);
  const providerL1 = new zkSyncWeb3.Provider(config.network.node_url);

  const signer = new zkSyncWeb3.Wallet(privateKey, providerL2, providerL1);
  return signer;
};
