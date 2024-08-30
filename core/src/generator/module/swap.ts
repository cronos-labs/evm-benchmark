import { getRootSigner, getRandomChildSigner } from "../utils/account";
import { contractDeployer } from "../utils/deployContracts";
import { UniswapV2Pair__factory, UniswapV2Router02__factory } from "../contracts/types";
import { Logger } from "@nestjs/common";
import { UnsignedTransaction, ethers } from "ethers";
import * as zkSyncWeb3 from "zksync-web3";
import { BuildTxConfig } from "../utils/types";
import { config } from '../config/config.service';
import { EvmType, getNetwork } from "../../lib/config";
import { rsBuildSignatures } from 'rs-addon';

export async function createUniSwapLP() {
  const network = getNetwork(config);
  const providerL2 = new zkSyncWeb3.Provider(network.node_url);
  const signer = getRootSigner();
  const zkSigner = new zkSyncWeb3.Wallet(signer.privateKey, providerL2);
  const { evm_type: evmType, gas_price: gasPrice, gas_limit: gasLimit } = getNetwork(config);

  const contractSigner = evmType === EvmType.ZKSYNC ? zkSigner : signer;

  const weth9 = await contractDeployer.getWETH9TokenContract(contractSigner)
  const gldToken = await contractDeployer.getGLDTokenContract(contractSigner);
  const gld2Token = await contractDeployer.getGLD2TokenContract(contractSigner);

  const uniswap = await contractDeployer.getUniSwapTokenContracts(contractSigner);

  const { factory, router, multicall } = uniswap;

  Logger.log(`Factory address: ${factory.address}`);
  const feeData = await contractSigner.getFeeData();

  Logger.log("GLD2 balance: " + await gld2Token.balanceOf(contractSigner.address));
  Logger.log("GLD balance: " + await gldToken.balanceOf(contractSigner.address));

  Logger.log(`Creating pair...... ${gld2Token.address} - ${gldToken.address}`);

  let gas = await factory.estimateGas.createPair(gld2Token.address, gldToken.address);
  let tx = await factory.createPair(gldToken.address, gld2Token.address,
    {
      // maxFeePerGas: feeData.maxFeePerGas,
      // maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      gasLimit: gas.add(1000000),
      gasPrice: ethers.BigNumber.from(gasPrice),
      type: 0,
    })

  await tx.wait()

  Logger.log(`Approving GLD2 token to router......`);
  gas = await gld2Token.estimateGas.approve(router.address, ethers.constants.MaxUint256);
  tx = await gld2Token.approve(router.address, ethers.constants.MaxUint256, {
    gasLimit: gas,
    gasPrice,
  });
  await tx.wait();

  Logger.log(`Approving GLD token to router......`);
  gas = await gldToken.estimateGas.approve(router.address, ethers.constants.MaxUint256);
  tx = await gldToken.approve(router.address, ethers.constants.MaxUint256, {
    gasLimit: gas,
    gasPrice: ethers.BigNumber.from(gasPrice),
  });
  await tx.wait()

  Logger.log(`INIT_CODE_HASH: ${ethers.utils.keccak256(UniswapV2Pair__factory.bytecode)}`);

  Logger.log(`Adding liquidity......`);

  const blockNumber = await signer.provider.getBlockNumber();
  const block = await signer.provider.getBlock(blockNumber);

  tx = await router.addLiquidityETH(
    gldToken.address,
    ethers.utils.parseEther("1000000000000"),
    10000,
    10000,
    signer.address,
    block.timestamp + 1000,
    {
      // maxFeePerGas: feeData.maxFeePerGas,
      // maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      gasLimit: ethers.BigNumber.from(4000000),
      value: ethers.utils.parseEther("0.0001"),
    }
  );
  await tx.wait()

  const pairAddress = await factory.getPair(weth9.address, gldToken.address);
  const pair = UniswapV2Pair__factory.connect(pairAddress, contractSigner)
  const balance = await pair.balanceOf(contractSigner.address);
  Logger.log(`LP balance: ${ethers.utils.formatEther(balance)}`);
}

export async function buildSwapSignatures(config: BuildTxConfig): Promise<string[]> {
  const signer = getRootSigner();

  const weth = await contractDeployer.getWETH9TokenContract(signer);
  const gldToken = await contractDeployer.getGLDTokenContract(signer);
  const uniswap = await contractDeployer.getUniSwapTokenContracts(signer);

  const { router } = uniswap;

  const signedTxs: string[] = [];
  for (let index = config.startIndex; index <= config.endIndex; index++) {
    const signer = getRandomChildSigner(index);
    const zkSigner = new zkSyncWeb3.Wallet(signer.privateKey);
    const contractSigner = config.evmType === EvmType.ZKSYNC ? zkSigner : signer;

    const data = UniswapV2Router02__factory.createInterface().encodeFunctionData("swapETHForExactTokens", [10000, [weth.address, gldToken.address], contractSigner.address, Math.round(Date.now() / 1000) + 10 * 60]);
  
    const tx: UnsignedTransaction = {
      chainId: config.chainId,
      to: router.address,
      gasPrice: ethers.BigNumber.from(config.gasPrice),
      gasLimit: ethers.BigNumber.from(config.gasLimit),
      value: ethers.BigNumber.from(10000),
      nonce: 0,
      data,
    }

    const signedTx = await signer.signTransaction(tx);
    signedTxs.push(signedTx);
  }

  return signedTxs;
}

export async function buildSwapSignatures_rs(txConfig: BuildTxConfig): Promise<string[]> {
  const rootSignerAddress = getRootSigner().address;
  
  const signer = getRandomChildSigner(0);
  const weth = await contractDeployer.getWETH9TokenContract(signer);
  const gldToken = await contractDeployer.getGLDTokenContract(signer);
  const uniswap = await contractDeployer.getUniSwapTokenContracts(signer);
  const data = UniswapV2Router02__factory.createInterface().encodeFunctionData("swapETHForExactTokens", [10000, [weth.address, gldToken.address], rootSignerAddress, Math.round(Date.now() / 1000) + 10 * 60]);

  const signedTxs = await rsBuildSignatures(
    config.account.random_mnemonic,
    txConfig.startIndex,
    txConfig.endIndex,
    txConfig.chainId,
    data,
    0,
    10000,
    uniswap.router.address,
    txConfig.gasPrice.toString(),
    txConfig.gasLimit.toString(),
  );
  
  return signedTxs;
}