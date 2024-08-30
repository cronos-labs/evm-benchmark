import { Logger } from "@nestjs/common";
import { config } from "../config/config.service";
import { getRandomChildSigner, getRootSigner } from "../utils/account";
import { contractDeployer } from "../utils/deployContracts";
import { Receipt, rsFundErc20Tokens, rsFundNativeTokens } from 'rs-addon';
import { ethers } from "ethers";
import { exit } from "process";

import { Provider as zkProvider, Wallet as zkWallet } from "zksync-ethers";
import { FullDepositFee } from "zksync-ethers/build/types";

const PerAccountHoldingETH = ethers.utils.parseEther('0.001');
const PerAccountHodlingBaseToken = ethers.utils.parseEther("0.01");
const PerAccountDepositBaseToken = 1;

var GAS_TOKEN_ADDRESS: string;

async function getGasTokenAddress(l1Provider: string, l2Provider: string) {
  if (!GAS_TOKEN_ADDRESS) {
    const wallet = getWallet(l1Provider, l2Provider);
    GAS_TOKEN_ADDRESS = await wallet.getBaseToken();
    Logger.log(`baseToken Address on L1: ${GAS_TOKEN_ADDRESS}`);
  }

  return GAS_TOKEN_ADDRESS;
}

async function fundBaseToken(l1Provider: string, l2Provider: string) {

  const wallet = getWallet(l1Provider, l2Provider);

  const batchTransferContract = await contractDeployer.getFundingContract(wallet._signerL1());
  const baseTokenAddress = await getGasTokenAddress(l1Provider, l2Provider);
  const baseTokenContract = await contractDeployer.getZKBaseTokenTokenContractL1(wallet._signerL1(), baseTokenAddress);

  await rsFundErc20Tokens(
    config.account.mnemonic,
    config.account.random_mnemonic,
    l1Provider,
    batchTransferContract.address,
    baseTokenContract.address,
    config.total_tx,
    PerAccountHodlingBaseToken.toString(),
  )
}

async function estimateDepositGas(l1NodeUrl: string, zkNodeUrl: string): Promise<FullDepositFee> {
  const wallet = getWallet(l1NodeUrl, zkNodeUrl);

  const fee = await wallet.getFullRequiredDepositFee({
    token: await getGasTokenAddress(l1NodeUrl, zkNodeUrl),
  })

  return fee;
}

function getWallet(l1NodeUrl: string, zkNodeUrl: string): zkWallet {
  const providerL2 = new zkProvider(zkNodeUrl);
  const providerL1 = new ethers.providers.JsonRpcProvider(l1NodeUrl);

  const signer = getRootSigner();
  let privateKey = signer.privateKey;

  const wallet = new zkWallet(privateKey, providerL2, providerL1);

  return wallet;
}

async function ensureETHBalance(l1NodeUrl: string, l2NodeUrl: string) {
  const wallet = getWallet(l1NodeUrl, l2NodeUrl);
  const balance = await wallet.getBalanceL1();

  const singleDepositFee = PerAccountHoldingETH;
  const totalDepositFee = singleDepositFee.mul(config.total_tx);

  const address = await wallet.getAddress();
  Logger.log(`Root Signer Address: ${address}`);

  if (balance.lt(totalDepositFee)) {
    Logger.error(`Insufficient ETH balance: ${ethers.utils.formatEther(balance)} ETH, required ${ethers.utils.formatEther(totalDepositFee)} ETH`);
    exit(-1);
  } else {
    Logger.log(`Sufficient ETH balance: ${ethers.utils.formatEther(balance)} ETH, required ${ethers.utils.formatEther(totalDepositFee)} ETH`);
  }
}

async function deposit(wallet: zkWallet, baseTokenAddress: string): Promise<(Error | Receipt)> {
  try {
    let startTime = new Date().getTime();
    const tx = await wallet.deposit({
      amount: PerAccountDepositBaseToken,
      token: baseTokenAddress,
      approveBaseERC20: true,
    });

    let sendTime = new Date().getTime();

    const receiptL1 = await tx.waitL1Commit();
    let endTime = new Date().getTime();
  
    const receiptL2 = await tx.wait();
    let endTimeL2 = new Date().getTime();

    return {
      hash: receiptL1.transactionHash,
      blockNumber: receiptL1.blockNumber.toString(),
      success: true,
      startTime: startTime.toString(),
      sendTime: sendTime.toString(),
      sendTimeCost: (endTime - startTime).toString(),
      responseTimeCost: (endTimeL2 - endTime).toString(),
    } as Receipt;
  } catch (error) {
    return Error(`Deposit failed: ${error}`);
  }
}

export async function zkSyncBridgeDeposit(
    l1NodeUrl: string, 
    l2NodeUrl: string,
    startIndex: number,
    endIndex: number,
) {
    const wallet = getWallet(l1NodeUrl, l2NodeUrl);
    const baseTokenAddress = await getGasTokenAddress(l1NodeUrl, l2NodeUrl);

    let randomWallets: zkWallet[] = [];
    for (let index = startIndex; index <= endIndex; index++) {
      const randomSigner = getRandomChildSigner(index);
      const randomWallet = new zkWallet(randomSigner.privateKey, wallet.provider, wallet.providerL1);
      randomWallets.push(randomWallet);
    }

    const results = await Promise.all(randomWallets.map(async (randomWallet) => {
      return await deposit(randomWallet, baseTokenAddress)
    }));

    return results;
}

async function ensureBaseTokenBalance(l1NodeUrl: string, l2NodeUrl: string) {
  const wallet = getWallet(l1NodeUrl, l2NodeUrl);
  const baseTokenAddress = await getGasTokenAddress(l1NodeUrl, l2NodeUrl);
  const baseTokenContract = await contractDeployer.getZKBaseTokenTokenContractL1(wallet._signerL1(), baseTokenAddress);

  const totalTX = config.total_tx;
  const totalBaseToken = PerAccountHodlingBaseToken.mul(totalTX);
  const balance = await baseTokenContract.balanceOf(wallet.address);

  if (balance.lt(totalBaseToken)) {
    Logger.error(`Insufficient baseToken balance: ${ethers.utils.formatEther(balance)}, required ${ethers.utils.formatEther(totalBaseToken)} baseToken`);
    exit(-1);
  } else {
    Logger.log(`Sufficient baseToken balance: ${ethers.utils.formatEther(balance)}, required ${ethers.utils.formatEther(totalBaseToken)} baseToken`);
  }
}

export async function fundETH(l1NodeUrl: string, l2NodeUrl: string) {
  const signer = getRootSigner();

  const batchTransferContract = (
    await contractDeployer.getFundingContract(signer)
  ).connect(signer);

  try {
    await rsFundNativeTokens(
      config.account.mnemonic,
      config.account.random_mnemonic,
      l1NodeUrl,
      batchTransferContract.address,
      config.total_tx,
      PerAccountHoldingETH.toString(),
    );
  } catch (e) {
    Logger.error(e);
    throw new Error('Not all accounts are funded successfully');
  }

  // // ETH balances check
  // for (let i = 1; i <= config.total_tx; i++) {
  //   const signerChild = getRandomChildSigner(i); 
  //   const balance = await signerChild.getBalance();
  //   console.log(`Account ${i}: ${signerChild.address}, balance ${ethers.utils.formatEther(balance)} ETH`);
  // }
}

export async function prepareDespositBenchmarkConfig() {
  Logger.log(`[prepareDespositBenchmarkConfig] starts...`);

  const l1NodeUrl = config.network.node_url;
  const l2NodeUrl = config.network.layer2.node_url;

  if (!l1NodeUrl) {
    Logger.error(`config.network.node_url is not required`);
    return;
  }

  if (!l2NodeUrl) {
    Logger.error(`config.network.layer2.node_url is not required`);
    return;
  }

  try {
    await ensureETHBalance(l1NodeUrl, l2NodeUrl);
    await ensureBaseTokenBalance(l1NodeUrl, l2NodeUrl);

    await fundETH(l1NodeUrl, l2NodeUrl);
    await fundBaseToken(l1NodeUrl, l2NodeUrl);

    // await zkSyncBridgeDeposit(l1NodeUrl, l2NodeUrl, 1, config.total_tx);
  } catch (error) {
    Logger.error(`[prepareDespositBenchmarkConfig] error: ${error}`);
    error.stack && Logger.error(error.stack);
  }


}