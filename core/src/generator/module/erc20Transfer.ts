import { BigNumber, UnsignedTransaction, ethers } from "ethers";
import * as zkSyncWeb3 from "zksync-web3";
import { contractDeployer } from "../utils/deployContracts";
import { GLDToken__factory } from "../contracts/types";
import { BuildTxConfig } from "../utils/types";
import { EvmType } from '../../lib/config';
import { getRandomChildSigner, getRootSigner } from "../utils/account";
import { rsBuildSignatures } from 'rs-addon';
import { config } from "../config/config.service";

export async function buildSendERC20Signatures_rs(txConfig: BuildTxConfig): Promise<string[]> {
  const rootSignerAddress = getRootSigner().address;


  const signer = getRandomChildSigner(0);
  const zkSigner = new zkSyncWeb3.Wallet(signer.privateKey);
  const contractSigner = txConfig.evmType === EvmType.ZKSYNC ? zkSigner : signer;
  const contractAddress = (await contractDeployer.getGLDTokenContract(contractSigner)).connect(contractSigner).address;
  const data = GLDToken__factory.createInterface().encodeFunctionData("transfer", [rootSignerAddress, ethers.utils.parseEther("0.1")]);


  const signedTxs = await rsBuildSignatures(
    config.account.random_mnemonic,
    txConfig.startIndex,
    txConfig.endIndex,
    txConfig.chainId,
    data,
    0,
    0,
    contractAddress,
    txConfig.gasPrice.toString(),
    txConfig.gasLimit.toString(),
  );
  
  return signedTxs;
}

export async function buildSendERC20Signatures(txConfig: BuildTxConfig): Promise<string[]> {
  const rootSignerAddress = getRootSigner().address;
  const signedTxs: string[] = [];
  
  for (let index = txConfig.startIndex; index <= txConfig.endIndex; index++) {
    const signer = getRandomChildSigner(index);
    const zkSigner = new zkSyncWeb3.Wallet(signer.privateKey);
    const contractSigner = txConfig.evmType === EvmType.ZKSYNC ? zkSigner : signer;
    const contractAddress = (await contractDeployer.getGLDTokenContract(contractSigner)).connect(contractSigner).address;
  
    const data = GLDToken__factory.createInterface().encodeFunctionData("transfer", [rootSignerAddress, ethers.utils.parseEther("0.1")]);

    const tx: UnsignedTransaction = {
      chainId: txConfig.chainId,
      to: contractAddress,
      gasPrice: BigNumber.from(txConfig.gasPrice),
      gasLimit: BigNumber.from(txConfig.gasLimit),
      nonce: 0,
      data,
    }

    const signedTx = await signer.signTransaction(tx);
    signedTxs.push(signedTx);
  }

  return signedTxs;
}
