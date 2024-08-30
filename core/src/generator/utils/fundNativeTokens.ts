import { Logger } from '@nestjs/common';
import { BigNumber, ethers } from 'ethers';
import {
  getSigner,
  getRandomChildSigner,
  getRandomMnemonic,
  getRootSigner,
} from './account';
import { contractDeployer } from './deployContracts';
import { config } from '../config/config.service';
import { EvmType, getNetwork } from '../../lib/config';
import * as zkSyncWeb3 from 'zksync-web3';
import cluster from 'cluster';
import os from 'os';
import { rsFundNativeTokens } from 'rs-addon';
import { getWeb3HTTPProvider } from './network';

const MAX_BATCH_SIZE = 200;
export async function fundNativeTokens(startIndex: number, toIndex: number) {
  // maximum funding account index = total_tx
  toIndex = toIndex > config.total_tx ? config.total_tx : toIndex;

  // Get the parent node
  const signer = getRootSigner();
  const { evm_type, gas_price, gas_limit } = getNetwork(config);
  const zkSigner = new zkSyncWeb3.Wallet(signer.privateKey);
  const provider = signer.provider;

  const balance = await signer.getBalance();
  const ethersBalance = ethers.utils.formatEther(balance);
  let PerAccountHolding = ethers.utils.parseEther(config.account.l1_holding);
  let contractSigner: ethers.Wallet | zkSyncWeb3.Wallet = signer;

  switch (evm_type) {
    case EvmType.Standard:
      PerAccountHolding = ethers.utils.parseEther(config.account.l1_holding);
      break;
    case EvmType.OPTIMISM:
      PerAccountHolding = ethers.utils.parseEther(config.account.optimism_holding);
      break;
    case EvmType.ZKSYNC:
      PerAccountHolding = ethers.utils.parseEther(config.account.zksync_holding);
      contractSigner = zkSigner;
      break;
    case EvmType.HERMEZ:
      PerAccountHolding = BigNumber.from(gas_price).mul(gas_limit);
      break;
    default:
  }

  const batchTransferContract = (
    await contractDeployer.getFundingContract(contractSigner)
  ).connect(signer);

  Logger.log(`batchTransferContract: `, batchTransferContract.address);
  Logger.log(`Funding Factor: ${config.account.funding_factor}`);

  for await (const round of Array.from(
    { length: Math.ceil(config.account.funding_factor) },
    (_, i) => i,
  )) {
    const needFundAccounts: string[] = [];

    for await (const index of Array.from(
      { length: toIndex - startIndex + 1 },
      (_, i) => i + startIndex + round * (toIndex - startIndex + 1),
    )) {
      if (index > config.total_tx) {
        break;
      }

      const address = getRandomChildSigner(index).address;
      Logger.log(`Funding ${index}: ${address}`);
      needFundAccounts.push(address);
    }

    const start = startIndex + round * (toIndex - startIndex + 1);
    const end = Math.min(start + toIndex - startIndex, config.total_tx);

    if (needFundAccounts.length < 1) {
      Logger.log(
        `✅ No account need to be funded between index ${start} - ${end}`,
      );
      continue;
    }

    const value = PerAccountHolding.mul(needFundAccounts.length);
    Logger.log(
      `Root account balance ${ethersBalance} ETH, need to fund ${ethers.utils.formatEther(
        value,
      )} ETH`,
    );

    const fundsArray = needFundAccounts.map(() => PerAccountHolding);

    Logger.log(
      `⏳ Start funding for ${needFundAccounts.length} account index ${start} - ${end}...`,
    );

    if (evm_type == EvmType.ZKSYNC || evm_type == EvmType.HERMEZ) {
      const result = await batchTransferContract.multisendNative(
        needFundAccounts,
        fundsArray,
        {
          gasPrice: BigNumber.from(gas_price),
          gasLimit: BigNumber.from(gas_limit).mul(toIndex - startIndex + 1),
          value: value,
        },
      );

      await result.wait();
    } else {
      const feedData = await provider.getFeeData();
      const result = await batchTransferContract.multisendNative(
        needFundAccounts,
        fundsArray,
        {
          maxFeePerGas: feedData.maxFeePerGas,
          maxPriorityFeePerGas: feedData.maxPriorityFeePerGas,
          value: value,
        },
      );

      await result.wait();
    }
  }

  Logger.log(`✅ All accounts are funded.`);
}

export async function fundNativeTokensRs() {
  const signer = getRootSigner();
  const { evm_type, gas_price, gas_limit } = getNetwork(config);
  const zkSigner = new zkSyncWeb3.Wallet(signer.privateKey);

  let PerAccountHolding = ethers.utils.parseEther(config.account.l1_holding);
  let contractSigner: ethers.Wallet | zkSyncWeb3.Wallet = signer;

  switch (evm_type) {
    case EvmType.Standard:
      PerAccountHolding = ethers.utils.parseEther(config.account.l1_holding);
      break;
    case EvmType.OPTIMISM:
      PerAccountHolding = ethers.utils.parseEther(config.account.optimism_holding);
      break;
    case EvmType.ZKSYNC:
      PerAccountHolding = ethers.utils.parseEther(config.account.zksync_holding);
      contractSigner = zkSigner;
      break;
    case EvmType.HERMEZ:
      PerAccountHolding = BigNumber.from(gas_price).mul(gas_limit);
      break;
    default:
  }

  const batchTransferContract = (
    await contractDeployer.getFundingContract(contractSigner)
  ).connect(signer);

  try {
    await rsFundNativeTokens(
      config.account.mnemonic,
      config.account.random_mnemonic,
      getWeb3HTTPProvider(),
      batchTransferContract.address,
      config.total_tx,
      PerAccountHolding.toString(),
    );
  } catch (e) {
    Logger.error(e);
    throw new Error('Not all accounts are funded successfully');
  }

  // // print balances of these addresses
  // for (let i = 1; i <= config.total_tx; i++) {
  //   const signerChild = getRandomChildSigner(i);
  //   const balance = await signerChild.getBalance();
  //   console.log(`Account ${i}: ${signerChild.address}, balance ${ethers.utils.formatEther(balance)} ETH`);
  // }
}

export async function fundNativeTokensRevised(
  startIndex: number,
  toIndex: number,
) {
  // maximum funding account index = total_tx
  toIndex = toIndex > config.total_tx ? config.total_tx : toIndex;

  // Get the parent node
  const signer = getRootSigner();
  const { evm_type, gas_price, gas_limit } = getNetwork(config);
  const zkSigner = new zkSyncWeb3.Wallet(signer.privateKey);
  const provider = signer.provider;

  const balance = await signer.getBalance();
  const ethersBalance = ethers.utils.formatEther(balance);
  let PerAccountHolding = ethers.utils.parseEther(config.account.l1_holding);
  let contractSigner: ethers.Wallet | zkSyncWeb3.Wallet = signer;

  switch (evm_type) {
    case EvmType.Standard:
      PerAccountHolding = ethers.utils.parseEther(config.account.l1_holding);
      break;
    case EvmType.OPTIMISM:
      PerAccountHolding = ethers.utils.parseEther(config.account.optimism_holding);
      break;
    case EvmType.ZKSYNC:
      PerAccountHolding = ethers.utils.parseEther(config.account.zksync_holding);
      contractSigner = zkSigner;
      break;
    case EvmType.HERMEZ:
      PerAccountHolding = BigNumber.from(gas_price).mul(gas_limit);
      break;
    default:
  }

  const workerMnemonicArray = [];
  for (let i = 0; i < os.cpus().length; i++) {
    workerMnemonicArray.push(getRandomMnemonic());
  }

  const batchTransferContract = (
    await contractDeployer.getFundingContract(contractSigner)
  ).connect(signer);

  const chunkSize = Math.ceil((toIndex - startIndex) / os.cpus().length);
  const workerStartIndex =
    startIndex + parseInt(process.env.WORKER_ID ?? '0') * chunkSize + 1;
  const workerEndIndex = Math.min(workerStartIndex + chunkSize - 1, toIndex);

  // Fund the worker accounts
  if (cluster.isPrimary) {
    const needFundAccounts = workerMnemonicArray.map(
      (workerMnemonic) => getSigner(workerMnemonic, 0).address,
    );

    const fundingFactor = Math.ceil(
      (workerEndIndex - workerStartIndex) / MAX_BATCH_SIZE,
    );

    const fundingGasLimit = BigNumber.from(gas_limit).mul(chunkSize);
    const fundingGasPrice = BigNumber.from(gas_price);

    const fundsArray = workerMnemonicArray.map(() =>
      PerAccountHolding.mul(chunkSize).add(
        ethers.BigNumber.from(fundingGasLimit)
          .mul(fundingGasPrice)
          .mul(fundingFactor),
      ),
    );
    const value = PerAccountHolding.mul(chunkSize)
      .add(
        ethers.BigNumber.from(fundingGasLimit)
          .mul(fundingGasPrice)
          .mul(fundingFactor),
      )
      .mul(workerMnemonicArray.length);

    if (evm_type == EvmType.ZKSYNC || evm_type == EvmType.HERMEZ) {
      const result = await batchTransferContract.multisendNative(
        needFundAccounts,
        fundsArray,
        {
          gasPrice: fundingGasPrice,
          gasLimit: fundingGasLimit,
          value: value,
        },
      );

      await result.wait();
      Logger.log(`Master funded worker accounts.`);
    } else {
      const feedData = await provider.getFeeData();
      const result = await batchTransferContract.multisendNative(
        needFundAccounts,
        fundsArray,
        {
          maxFeePerGas: feedData.maxFeePerGas,
          maxPriorityFeePerGas: feedData.maxPriorityFeePerGas,
          value: value,
        },
      );

      await result.wait();
      Logger.log(`Master funded worker accounts.`);
    }
  }

  await worker(
    batchTransferContract,
    config.account.random_mnemonic,
    workerMnemonicArray,
  );

  if (cluster.isPrimary) {
    Logger.log(`✅ All accounts are funded.`);
    return;
  }

  await workerFundNativeTokens(
    workerStartIndex,
    workerEndIndex,
    getSigner(process.env.WORKER_MNEMONIC, 0),
  );
}

export async function workerFundNativeTokens(
  startIndex: number,
  toIndex: number,
  signer: ethers.Wallet,
) {
  // maximum funding account index = total_tx
  toIndex = toIndex > config.total_tx ? config.total_tx : toIndex;

  // Get the parent node
  const { evm_type, gas_price, gas_limit } = getNetwork(config);
  const zkSigner = new zkSyncWeb3.Wallet(signer.privateKey);
  const provider = signer.provider;

  const balance = await signer.getBalance();
  const ethersBalance = ethers.utils.formatEther(balance);
  let PerAccountHolding = ethers.utils.parseEther(config.account.l1_holding);
  let contractSigner: ethers.Wallet | zkSyncWeb3.Wallet = signer;

  switch (evm_type) {
    case EvmType.Standard:
      PerAccountHolding = ethers.utils.parseEther(config.account.l1_holding);
      break;
    case EvmType.OPTIMISM:
      PerAccountHolding = ethers.utils.parseEther(config.account.optimism_holding);
      break;
    case EvmType.ZKSYNC:
      PerAccountHolding = ethers.utils.parseEther(config.account.zksync_holding);
      contractSigner = zkSigner;
      break;
    case EvmType.HERMEZ:
      PerAccountHolding = BigNumber.from(gas_price).mul(gas_limit);
      break;
    default:
  }

  const batchTransferContract = (
    await contractDeployer.getFundingContract(contractSigner)
  ).connect(signer);

  const fundingFactor = (toIndex - startIndex) / MAX_BATCH_SIZE;
  const roundLength = Math.ceil(
    (toIndex - startIndex + 1) / Math.ceil(fundingFactor),
  );
  for await (const round of Array.from(
    { length: Math.ceil(fundingFactor) },
    (_, i) => i,
  )) {
    const needFundAccounts: string[] = [];

    for await (const index of Array.from(
      {
        length: roundLength,
      },
      (_, i) => i + startIndex + round * roundLength,
    )) {
      if (index > config.total_tx || index > toIndex) {
        break;
      }

      const address = getSigner(process.env.RANDOM_MNEMONIC, index).address;
      needFundAccounts.push(address);
    }

    const start = startIndex + round * roundLength;
    const end = Math.min(start + roundLength, toIndex);

    Logger.log(
      `Worker ID: ${process.env.WORKER_ID} | Round: ${round} | Index ${start} - ${end}`,
    );

    if (needFundAccounts.length < 1) {
      Logger.log(
        `✅ No account need to be funded between index ${start} - ${end}`,
      );
      continue;
    }

    const value = PerAccountHolding.mul(needFundAccounts.length);
    Logger.log(
      `Worker ID: ${
        process.env.WORKER_ID
      } account balance ${ethersBalance} ETH, need to fund ${ethers.utils.formatEther(
        value,
      )} ETH`,
    );

    const fundsArray = needFundAccounts.map(() => PerAccountHolding);

    Logger.log(
      `⏳ Start funding for ${needFundAccounts.length} account index ${start} - ${end}...`,
    );

    if (evm_type == EvmType.ZKSYNC || evm_type == EvmType.HERMEZ) {
      const result = await batchTransferContract.multisendNative(
        needFundAccounts,
        fundsArray,
        {
          gasPrice: BigNumber.from(gas_price),
          gasLimit: BigNumber.from(gas_limit).mul(roundLength),
          value: value,
        },
      );

      await result.wait();
    } else {
      const feedData = await provider.getFeeData();
      const result = await batchTransferContract.multisendNative(
        needFundAccounts,
        fundsArray,
        {
          maxFeePerGas: feedData.maxFeePerGas,
          maxPriorityFeePerGas: feedData.maxPriorityFeePerGas,
          value: value,
        },
      );

      await result.wait();
    }
  }

  Logger.log(
    `✅ All accounts for Worker ID ${process.env.WORKER_ID} are funded.`,
  );
  cluster.worker.send('done');
}

async function worker(
  batchTransferContract: ethers.Contract,
  randomMnemonic: string,
  workerMnemonicList: string[],
) {
  const numCPUs = os.cpus().length;
  if (cluster.isPrimary) {
    Logger.log(`Master process ${process.pid} is running`);

    const workers = Array.from(
      { length: numCPUs },
      (_, i) =>
        new Promise<void>((resolve) => {
          const worker = cluster.fork({
            WORKER_ID: i,
            BATCH_TRANSFER_CONTRACT_ADDRESS: batchTransferContract.address,
            RANDOM_MNEMONIC: randomMnemonic,
            WORKER_MNEMONIC: workerMnemonicList[i],
          });
          Logger.log(`Cluster fork for CPU ${i}`);
          worker.on('message', (msg) => {
            if (msg === 'done') {
              Logger.log(`Worker ID ${process.env.WORKER_ID} resolved done.`);
              worker.kill();
              resolve();
            }
          });
        }),
    );

    await Promise.all(workers);

    cluster.on('exit', (worker, code, signal) => {
      Logger.log(`Worker process ${worker.process.pid} exits.`);
    });
  } else {
    Logger.log(`Worker ID ${process.env.WORKER_ID} is running`);
  }
}
