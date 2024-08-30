import { Logger } from '@nestjs/common';
import { ethers } from 'ethers';
import * as zkSyncWeb3 from "zksync-web3";
import { getRandomChildSigner, getRootSigner } from './account';
import { contractDeployer } from './deployContracts';
import { config } from '../config/config.service';
import { EvmType, getNetwork } from '../../lib/config';
import { rsFundErc20Tokens } from 'rs-addon';
import { getWeb3HTTPProvider } from './network';

const PerAccountHodling = ethers.utils.parseEther('10');

export async function fundERC20TokensRS(startIndex: number, toIndex: number) {

  // maximum funding account index = total_tx
  toIndex = (toIndex > config.total_tx) ? config.total_tx : toIndex;
  // Get the parent node
  const signer = getRootSigner();
  const zkSigner = new zkSyncWeb3.Wallet(signer.privateKey);
  const { evm_type } = getNetwork(config);

  const contractSigner: ethers.Wallet | zkSyncWeb3.Wallet = evm_type === EvmType.ZKSYNC ? zkSigner : signer;

  const batchTransferContract = (await contractDeployer.getFundingContract(contractSigner)).connect(signer);
  const tokenContract = (await contractDeployer.getGLDTokenContract(contractSigner)).connect(signer);

  await rsFundErc20Tokens(
    config.account.mnemonic,
    config.account.random_mnemonic,
    getWeb3HTTPProvider(),
    batchTransferContract.address,
    tokenContract.address,
    config.total_tx,
    PerAccountHodling.toString(),
  )

  // // GLD balance check
  // for (let i = 1; i <= config.total_tx; i++) {
  //   const signerChild = getRandomChildSigner(i); 
  //   const balance = await tokenContract.connect(signerChild).balanceOf(signerChild.address);
  //   console.log(`Account ${i}: ${signerChild.address}, balance ${ethers.utils.formatEther(balance)} GLD`);
  // }
}

export async function fundERC20Tokens(startIndex: number, toIndex: number) {
  // maximum funding account index = total_tx
  toIndex = (toIndex > config.total_tx) ? config.total_tx : toIndex;


  // Get the parent node
  const signer = getRootSigner();
  const zkSigner = new zkSyncWeb3.Wallet(signer.privateKey);
  const provider = signer.provider;
  const { evm_type } = getNetwork(config);

  const contractSigner: ethers.Wallet | zkSyncWeb3.Wallet = evm_type === EvmType.ZKSYNC ? zkSigner : signer;

  const batchTransferContract = (await contractDeployer.getFundingContract(contractSigner)).connect(signer);
  const tokenContract = (await contractDeployer.getGLDTokenContract(contractSigner)).connect(signer);

  const balance = await tokenContract.balanceOf(signer.address);
  const nativeBalance = await signer.getBalance();
  Logger.log(`Root account balance ${ethers.utils.formatEther(balance)} GLD, ${ethers.utils.formatEther(nativeBalance)} ETH`);
  const tokenBalance = ethers.utils.formatEther(balance);

  // allow batch transfer contract to spend tokens
  const allowanceTX = await tokenContract.approve(batchTransferContract.address, ethers.constants.MaxUint256);
  await allowanceTX.wait()


  for await (const round of Array.from(
    { length: Math.ceil(config.account.funding_factor) },
    (_, i) => i,
  )) {
    const needFundAccounts: string[] = [];

    for await (const index of Array.from(
      { length: toIndex - startIndex + 1 },
      (_, i) => (i + startIndex + (round * (toIndex - startIndex + 1))),
    )) {
      if (index > config.total_tx) { break; }

      const address = getRandomChildSigner(index).address;
      // const balance = await tokenContract.balanceOf(address);

      // if (ethers.BigNumber.from(balance).lt(PerAccountHodling) ) {
      needFundAccounts.push(address);
      // }
    }

    const start = startIndex + (round * (toIndex - startIndex + 1));
    const end = Math.min(start + toIndex - startIndex, config.total_tx)

    if (needFundAccounts.length < 1) {
      Logger.log(`✅ No account need to be funded between index ${start} - ${end}`);
      continue;
    }

    const value = PerAccountHodling.mul(needFundAccounts.length);
    Logger.log(
      `[ERC20] Root account balance ${tokenBalance} GLD, need to fund ${ethers.utils.formatEther(
        value,
      )} GLD`,
    );

    const feeData = await provider.getFeeData();

    const fundsArray = needFundAccounts.map(() => PerAccountHodling);
    Logger.log(`⏳ [ERC20] Start funding for ${needFundAccounts.length} account index ${start} - ${end}...`);
    const result = await batchTransferContract.multisendToken(
      tokenContract.address,
      needFundAccounts,
      fundsArray,
      {
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
        gasLimit: 7000000,
        // gasLimit: 20000000,
      },
    );

    await result.wait();
  }

  Logger.log(`✅ All accounts are funded.`);
}
