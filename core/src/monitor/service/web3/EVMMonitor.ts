import { Logger } from '@nestjs/common';
import { clearInterval } from 'timers';
import Web3 from 'web3';
import { Block } from 'web3-types';
import { RoundResult } from '../../../generator/utils/types';

export class EVMMonitor {
  web3: Web3;
  timer: NodeJS.Timer;

  lastBlockNumber: number;

  isFetching: boolean;

  onNewBlock?: (block: Block) => void;

  constructor(provider: string) {
    this.web3 = new Web3(provider);
  }

  async getBlockNumber() {
    return parseInt((await this.web3.eth.getBlockNumber()).toString());
  }

  async getTransactionDetail(tx: string) {
    return await this.web3.eth.getTransaction(tx);
  }

  async getBlockInfo(blockNumber: number): Promise<Block> {
    try {
      const result = await this.web3.eth.getBlock(blockNumber, true);
      return result;
    } catch (e) {
      Logger.error(`[Monitor] Error getting block ${blockNumber}: ${e}`);
      throw e;
    }
  }

  async getTotalTxCount(
    startBlockNumber: number,
    endBlockNumber: number,
    roundResults: RoundResult[],
  ) {
    let totalTx = 0;
    const txHashList: string[] = [];
    roundResults.forEach((roundResult) => {
      roundResult.transactions.forEach((tx) => {
        if (tx.receipt) {
          txHashList.push(tx.receipt.transactionHash);
        }
      });
    });

    for await (const index of Array.from(
      { length: endBlockNumber - startBlockNumber + 1 },
      (_, i) => i + startBlockNumber,
    )) {
      const block = await this.getBlockInfo(index);
      block.transactions.forEach((tx) => {
        if (txHashList.includes(tx.hash)) {
          totalTx += 1;
        }
      });
    }

    return totalTx;
  }

  async waitUntilNodeReady() {
    try {
      await this.web3.eth.getChainId();
    } catch (error) {
      Logger.log(`[Monitor] Node is not ready, re-connecting......`);
      await new Promise((r) => setTimeout(r, 1000));
      await this.waitUntilNodeReady();
    }
  }

  async start() {
    await this.waitUntilNodeReady();

    this.lastBlockNumber = await this.getBlockNumber();
    Logger.log(
      `[monitor] Start fetching block info from: ${this.lastBlockNumber}`,
    );
  }

  async stop() {
    clearInterval(this.timer);
  }
}
