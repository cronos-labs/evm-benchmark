import { getRandomChildSigner, getRootSigner } from '../utils/account';
import { BuildTxConfig } from '../utils/types';
import { BigNumber, UnsignedTransaction } from 'ethers';
import { Logger } from '@nestjs/common';
import { config } from '../../generator/config/config.service';
import { rsBuildNativeTokenTransferSignatures } from 'rs-addon';

export async function buildNormalTransferSignatures_rs(
  tx_config: BuildTxConfig,
): Promise<string[]> {
  const to = getRootSigner().address;
  const value = 100;

  const result = await rsBuildNativeTokenTransferSignatures(
    config.account.random_mnemonic,
    to,
    tx_config.chainId,
    tx_config.startIndex,
    tx_config.endIndex,
    value,
    tx_config.gasPrice.toString(),
    tx_config.gasLimit.toString(),
  );

  Logger.log(`All signed transactions built`);

  return result;
}

export async function buildNormalTransferSignatures(
  config: BuildTxConfig,
): Promise<string[]> {
  Logger.log(
    `Start building transactions from ${config.startIndex} to ${config.endIndex}`,
  );
  const to = getRootSigner().address;

  const signedTxs: string[] = [];

  const txListLength = config.endIndex - config.startIndex + 1;

  for (let index = config.startIndex; index <= config.endIndex; index++) {
    const signer = getRandomChildSigner(index);

    const tx: UnsignedTransaction = {
      chainId: config.chainId,
      to,
      value: 100,
      gasPrice: BigNumber.from(config.gasPrice),
      gasLimit: BigNumber.from(config.gasLimit),
      nonce: 0,
    };

    const signedTx = await signer.signTransaction(tx);
    signedTxs.push(signedTx);
    if (index % 100 === 0) {
      Logger.log(
        `${Math.ceil((index / txListLength) * 100)}% transactions built`,
      );
    }
  }

  Logger.log(`All signed transactions built`);

  return signedTxs;
}
