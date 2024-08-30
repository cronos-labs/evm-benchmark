import { Logger } from '@nestjs/common';
import * as zkSyncWeb3 from "zksync-web3";
import { getRandomChildSigner, getRootSigner, getZksyncSignerFromPrivateKey } from "../utils/account";
import { contractDeployer } from "../utils/deployContracts";
import { config } from '../config/config.service';
import { EvmType, getNetwork } from "../../lib/config";
import { BuildTxConfig } from "../utils/types";
import { BigNumber, UnsignedTransaction } from "ethers";
import { GameItem__factory } from "../contracts/types";

export async function prepareMinting() {
  const network = getNetwork(config);
  const rootSigner = getRootSigner();
  const zkRootSigner = new zkSyncWeb3.Wallet(rootSigner.privateKey);
  const contractSigner = network.evm_type === EvmType.ZKSYNC ? zkRootSigner : rootSigner;
  await contractDeployer.getNFTContract(contractSigner);
}

export async function buildMintNFTSignatures(config: BuildTxConfig): Promise<string[]> {
  const rootSigner = getRootSigner();
  const zkRootSigner = new zkSyncWeb3.Wallet(rootSigner.privateKey);

  const contractSigner = config.evmType === EvmType.ZKSYNC ? zkRootSigner : rootSigner;
  const nftContract = await contractDeployer.getNFTContract(contractSigner);
  const signedTxs: string[] = [];

  for (let index = config.startIndex; index <= config.endIndex; index++) {
    const signer = getRandomChildSigner(index);

    const data = GameItem__factory.createInterface().encodeFunctionData("mint");
  
    const tx: UnsignedTransaction = {
      chainId: config.chainId,
      to: nftContract.address,
      gasPrice: BigNumber.from(config.gasPrice),
      gasLimit: BigNumber.from(config.gasLimit),
      nonce: 0,
      data,
    }

    const signedTx = await signer.signTransaction(tx);
    signedTxs.push(signedTx);
  }

  return signedTxs;
}
