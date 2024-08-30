import { Injectable, Logger } from '@nestjs/common';
import * as schedule from 'node-schedule';
import { config, ConfigService } from './config/config.service';
import { InfluxDBConnector } from '../lib';
import { Point } from '@influxdata/influxdb-client';
import * as fs from 'fs';
import os from 'os';

import {
  fundNativeTokensRs,
} from './utils/fundNativeTokens';
import { getRootSigner } from './utils/account';
import { fundERC20TokensRS } from './utils/fundERC20Tokens';
import {
  buildNormalTransferSignatures_rs,
} from './module/normalTransfer';
import {
  buildSendERC20Signatures_rs,
} from './module/erc20Transfer';
import { buildSwapSignatures_rs } from './module/swap';
import { buildMintNFTSignatures } from './module/mint';
import { EVMMonitor } from '../monitor/service/web3/EVMMonitor';
import { Block } from 'web3-types';
import { ethers } from 'ethers';
import { Receipt, rsSendRawTransactions } from 'rs-addon';
import {
  BenchmarkResult,
  BuildTxFunc,
  RoundResult,
  TestRoundIteration,
  TransactionResult,
} from './utils/types';
import { createUniSwapLP } from './module/swap';
import { EvmType, getNetwork, RateControlType, TxType } from '../lib/config';
import { prepareMinting } from './module/mint';
import { delay } from '../monitor/utils/delay';
import { waitForKeypress } from '../generator/utils/utils';
import {
  prepareDespositBenchmarkConfig,
  zkSyncBridgeDeposit,
} from './module/deposit';

@Injectable()
export class AppService {
  private testRound = 0;
  private testRoundIteration: TestRoundIteration[] = [];
  private txRoundArray: number[] = []; // tx to be sent by round
  private currentAccountIndex = 1;
  private broadcastedTx = 0;
  private isWarmUp = true;
  private warmUpRound = 0;
  private warmUpBroadcastedTx = 0;
  private totalTx = config.total_tx;
  private broadcastedSuccessfulTx = 0;
  private isBroadcastFinished = false;
  private broadcastStartTimestamp = 0;
  private broadcastFinishTimestamp = new Date();
  private beginningBlockHeight = 0;
  private averageResponseTimeArray: number[] = [];
  private longestResponseTime = 0;
  private roundResults: RoundResult[] = [];
  private chainId = 0;
  private network = getNetwork(config);
  private nodeTimestampDiff = 0; // Timestamp difference between Node and Client
  private totalSubmitToConfirmationTimeDiff = 0; // calculated by 1st transaction submit time and last block

  private numCPUs = os.cpus().length;

  constructor(private configService: ConfigService) {
    this.start();
  }

  async waitUntilNodeReady() {
    this.prepareTxRoundArray();
    try {
      const signer = getRootSigner();
      this.chainId = await signer.getChainId();
    } catch (error) {
      const network = this.network;
      Logger.log(
        `[Generator] ${network.node_url} is not ready, re-connecting......`,
      );
      await new Promise((r) => setTimeout(r, 1000));
      await this.waitUntilNodeReady();
    }
  }

  async start() {
    await this.waitUntilNodeReady();

    const network = this.network;
    const monitor = new EVMMonitor(network.node_url);

    try {
      switch (config.tx_type) {
        case TxType.ERC20: {
          await fundNativeTokensRs();
          Logger.log(`[fundERC20Tokens] starts......`);
          await fundERC20TokensRS(
            config.account.start_index,
            config.account.end_index,
          );
          break;
        }
        case TxType.SWAP: {
          await fundNativeTokensRs();
          Logger.log(`[createUniSwapLP] starts...`);
          await createUniSwapLP();
          break;
        }
        case TxType.MINT_NFT: {
          await fundNativeTokensRs();
          Logger.log(`[prepareMinting] starts...`);
          await prepareMinting();
          break;
        }
        case TxType.NORMAL:
          await fundNativeTokensRs();
          break;
        case TxType.DEPOSIT:
          {
            await prepareDespositBenchmarkConfig();
          }
          break;
      }

      // fetch timestamp on latest block
      this.beginningBlockHeight = await monitor.getBlockNumber();
      this.syncNodeTimestampDiff(this.beginningBlockHeight);

      Logger.log(
        `Sleep for 60s and wait for all initial fundings get processed...`,
      );
      await delay(1_000);

      Logger.log(
        `[monitor] Benchmark starts from block height: ${this.beginningBlockHeight}`,
      );
      if (network.evm_type === EvmType.OPTIMISM) {
        this.beginningBlockHeight += 1;
        Logger.log(
          `[monitor] updated benchmark update to block height: ${this.beginningBlockHeight}`,
        );
      }
      if (network.evm_type === EvmType.ZKSYNC) {
        const block = await monitor.getBlockInfo(this.beginningBlockHeight);
        if (block.gasUsed === 0) {
          this.beginningBlockHeight += 1;
          Logger.log(
            `[monitor] updated benchmark update to block height: ${this.beginningBlockHeight}`,
          );
        }
      }

      this.runScheduleJob();
    } catch (error) {
      Logger.error(`Funding accounts failed: ${error}`);
      error.stack && Logger.error(error.stack);
      process.exit(1);
    }
  }

  async startNewRound(
    testRound: number,
    warmUpRound: number,
    txSending: number,
    buildTxFunc: BuildTxFunc,
    resultHandler: (result: RoundResult) => void,
  ): Promise<RoundResult> {
    const points: Point[] = [];
    const startIndex = this.currentAccountIndex;
    const endIndex = startIndex + txSending - 1;
    const network = this.network;

    let txResults: (Error | Receipt)[] = [];

    if (config.tx_type !== TxType.DEPOSIT) {
      Logger.log(
        `Building transactions | Account Index ${startIndex} - ${endIndex}`,
      );
      const signedTxs = await buildTxFunc({
        startIndex: this.currentAccountIndex,
        endIndex: this.currentAccountIndex + txSending - 1,
        chainId: this.chainId,
        evmType: network.evm_type,
        gasLimit: network.gas_limit,
        gasPrice: network.gas_price,
      });
      Logger.log(`Build transactions done | ${signedTxs.length} transactions`);

      this.currentAccountIndex += txSending;

      txResults = await rsSendRawTransactions(network.node_url, signedTxs);
    } else {
      this.currentAccountIndex += txSending;
      txResults = await zkSyncBridgeDeposit(
        config.network.node_url,
        config.network.layer2.node_url,
        startIndex,
        endIndex,
      );
    }

    InfluxDBConnector.writePoints(points);

    const result: TransactionResult[] = txResults.map((r) => {
      // error
      if ('name' in r) {
        Logger.error(`Transaction Error:`, r);
        return {
          receipt: null,
          index: 0,
          success: false,
          startTime: 0,
          sendTime: 0,
          sendTimeCost: 0,
          responseTimeCost: 0,
        };
      } else {
        if (r.success == false) {
          Logger.error(`Transaction Error:`, r);
          return {
            receipt: {
              blockNumber: Number(r.blockNumber),
              transactionHash: r.hash,
            },
            index: 0,
            success: false,
            startTime: Number(r.startTime) / 1000,
            sendTime: Number(r.sendTime) / 1000,
            sendTimeCost: Number(r.sendTimeCost) / 1000,
            responseTimeCost: Number(r.responseTimeCost) / 1000,
          };
        }
        return {
          receipt: {
            blockNumber: Number(r.blockNumber),
            transactionHash: r.hash,
          },
          index: 0,
          success: true,
          startTime: Number(r.startTime) / 1000,
          sendTime: Number(r.sendTime) / 1000,
          sendTimeCost: Number(r.sendTimeCost) / 1000,
          responseTimeCost: Number(r.responseTimeCost) / 1000,
        };
      }
    });

    result.sort((a, b) => {
      if (!a.receipt && !b.receipt) {
        return 0;
      }

      if (!a.receipt) {
        return 1;
      }

      if (!b.receipt) {
        return -1;
      }

      return a.receipt.blockNumber - b.receipt.blockNumber;
    });

    let start = 0;
    let end = 0;
    if (result.filter((r) => r.startTime !== 0).length !== 0) {
      start = result
        .filter((r) => r.startTime !== 0)
        .reduce((prev, current) =>
          prev.startTime < current.startTime ? prev : current,
        ).startTime;
      end = result.reduce((prev, current) =>
        prev.sendTime > current.sendTime ? prev : current,
      ).sendTime;
    }

    const successCount = result.filter((r) => r.success).length;
    const failedCount = result.filter((r) => !r.success).length;
    const averageResponseTime =
      result.reduce((acc, cur) => acc + cur.responseTimeCost, 0) /
      result.length;
    const longestResponseTime = result.reduce(
      (acc, cur) => (acc > cur.responseTimeCost ? acc : cur.responseTimeCost),
      0,
    );

    this.averageResponseTimeArray.push(averageResponseTime);
    this.longestResponseTime =
      this.longestResponseTime > longestResponseTime
        ? this.longestResponseTime
        : longestResponseTime;

    resultHandler({
      round: testRound - warmUpRound,
      successCount,
      failedCount,
      averageResponseTime,
      longestResponseTime,
      start,
      end,
      transactions: result,
    });

    const resultPoints = result.map((r, i) => {
      return new Point('transaction-result')
        .tag(
          'txIndex',
          `${testRound.toString()}-${(
            i + config.account.start_index
          ).toString()}`,
        )
        .tag('round', `${testRound}`)
        .intField('value', r.success ? 1 : 0)
        .booleanField('success', r.success)
        .intField('timeCost', r.responseTimeCost)
        .timestamp(new Date(end));
    });

    InfluxDBConnector.writePoints([...resultPoints]);

    return {
      round: testRound - warmUpRound,
      successCount,
      failedCount,
      averageResponseTime,
      longestResponseTime,
      start,
      end,
      transactions: result,
    };
  }

  async startNewRoundRevised(
    testRound: number,
    warmUpRound: number,
    txSending: number,
    signedTxs: string[],
    resultHandler: (result: RoundResult) => void,
  ): Promise<RoundResult> {
    const points: Point[] = [];
    const startIndex = this.currentAccountIndex;
    const endIndex = startIndex + txSending - 1;
    const network = this.network;

    Logger.log(
      `Sending transactions | Account Index ${startIndex} - ${endIndex}`,
    );

    this.currentAccountIndex += txSending;

    const txResults = await rsSendRawTransactions(network.node_url, signedTxs);
    InfluxDBConnector.writePoints(points);
    Logger.log(`Send transactions done | ${txResults.length} transactions`);

    const result: TransactionResult[] = txResults.map((r, index) => {
      // error
      if ('name' in r) {
        Logger.error(`Transaction ${startIndex + index} Error:`, r);
        return {
          receipt: null,
          index: 0,
          success: false,
          startTime: 0,
          sendTime: 0,
          sendTimeCost: 0,
          responseTimeCost: 0,
        };
      } else {
        return {
          receipt: {
            blockNumber: Number(r.blockNumber),
            transactionHash: r.hash,
          },
          index: 0,
          success: true,
          startTime: Number(r.startTime) / 1000,
          sendTime: Number(r.sendTime) / 1000,
          sendTimeCost: Number(r.sendTimeCost) / 1000,
          responseTimeCost: Number(r.responseTimeCost) / 1000,
        };
      }
    });

    result.sort((a, b) => {
      if (!a.receipt && !b.receipt) {
        return 0;
      }

      if (!a.receipt) {
        return 1;
      }

      if (!b.receipt) {
        return -1;
      }

      return a.receipt.blockNumber - b.receipt.blockNumber;
    });

    let start = 0;
    let end = 0;
    if (result.filter((r) => r.startTime !== 0).length !== 0) {
      start = result
        .filter((r) => r.startTime !== 0)
        .reduce((prev, current) =>
          prev.startTime < current.startTime ? prev : current,
        ).startTime;
      end = result.reduce((prev, current) =>
        prev.sendTime > current.sendTime ? prev : current,
      ).sendTime;
    }

    const successCount = result.filter((r) => r.success).length;
    const failedCount = result.filter((r) => !r.success).length;
    const averageResponseTime =
      result.reduce((acc, cur) => acc + cur.responseTimeCost, 0) /
      result.length;
    const longestResponseTime = result.reduce(
      (acc, cur) => (acc > cur.responseTimeCost ? acc : cur.responseTimeCost),
      0,
    );

    this.averageResponseTimeArray.push(averageResponseTime);
    this.longestResponseTime =
      this.longestResponseTime > longestResponseTime
        ? this.longestResponseTime
        : longestResponseTime;

    resultHandler({
      round: testRound - warmUpRound,
      successCount,
      failedCount,
      averageResponseTime,
      longestResponseTime,
      start,
      end,
      transactions: result,
    });

    if (config.total_tx > 1000) {
      return;
    }

    const resultPoints = result.map((r, i) => {
      return new Point('transaction-result')
        .tag(
          'txIndex',
          `${testRound.toString()}-${(
            i + config.account.start_index
          ).toString()}`,
        )
        .tag('round', `${testRound}`)
        .intField('value', r.success ? 1 : 0)
        .booleanField('success', r.success)
        .intField('timeCost', r.responseTimeCost)
        .timestamp(new Date(end));
    });

    InfluxDBConnector.writePoints([...resultPoints]);

    return {
      round: testRound - warmUpRound,
      successCount,
      failedCount,
      averageResponseTime,
      longestResponseTime,
      start,
      end,
      transactions: result,
    };
  }

  async printRound(roundResult: RoundResult) {
    const {
      round,
      successCount,
      failedCount,
      averageResponseTime,
      longestResponseTime,
      start,
      end,
    } = roundResult;

    if (round <= this.warmUpRound) {
      return;
    }

    const testRound = round - this.warmUpRound;
    const total = successCount + failedCount;
    const totalTime = end - start;
    if (totalTime === 0) {
      Logger.log(`************ Round ${testRound} Result ***************`);
      Logger.log(
        `Success: ${successCount}/${total} (${(successCount / total) * 100}%)`,
      );
      Logger.log(
        `Failed: ${failedCount}/${total} (${(failedCount / total) * 100}%)`,
      );
      Logger.log(`Total time cost: N/A`);
      Logger.log(`Average Response time: N/A`);
      Logger.log(`Longest Response time: N/A`);
      Logger.log(`Average TPS: : N/A tx/s`);
      const totalTx = this.roundResults.reduce(
        (acc, cur) => acc + cur.successCount,
        0,
      );
      Logger.log(
        `[Generator] ${this.roundResults.length} round passed, total ${totalTx} tx sent`,
      );
      Logger.log(`*************************************************\n`);
      return;
    }
    const tps = successCount / totalTime;

    Logger.log(`************ Round ${testRound} Result ***************`);
    Logger.log(
      `Success: ${successCount}/${total} (${(successCount / total) * 100}%)`,
    );
    Logger.log(
      `Failed: ${failedCount}/${total} (${(failedCount / total) * 100}%)`,
    );
    Logger.log(`Total time cost: ${totalTime.toFixed(3)}s`);
    Logger.log(`Average Response time: ${averageResponseTime.toFixed(3)}s`);
    Logger.log(`Longest Response time: ${longestResponseTime.toFixed(3)}s`);
    Logger.log(`Average TPS: ${tps.toFixed(3)} tx/s`);
    const totalTx = this.roundResults.reduce(
      (acc, cur) => acc + cur.successCount,
      0,
    );
    Logger.log(
      `[Generator] ${this.roundResults.length} round passed, total ${totalTx} tx sent`,
    );
    Logger.log(`*************************************************\n`);

    const point = new Point('tps')
      .tag('round', `${testRound}`)
      .intField('transactions', total)
      .floatField('tps', tps)
      .timestamp(new Date());
    await InfluxDBConnector.writePoints([point]);
  }

  async getBenchmarkResult(beginBlockNumber: number, lastBlockNumber: number) {
    const promises: Promise<Block>[] = [];
    const network = this.network;
    const monitor = new EVMMonitor(network.node_url);
    const points: Point[] = [];
    const pointsGas: Point[] = [];

    monitor.onNewBlock = async (block) => {
      if (network.evm_type === EvmType.OPTIMISM) {
        // Avoid OP blocks with identical timestamp
        const point = new Point('block')
          .tag('benchmark', 'monitor')
          .uintField('value', block.transactions.length)
          .timestamp(
            new Date(
              Number(block.timestamp) * 1000 +
                (beginBlockNumber - Number(block.number)),
            ),
          );
        points.push(point);

        const pointGas = new Point('transaction')
          .tag('benchmark', 'monitor')
          .uintField('gas', block.gasUsed)
          .timestamp(
            new Date(
              Number(block.timestamp) * 1000 +
                (beginBlockNumber - Number(block.number)),
            ),
          );
        pointsGas.push(pointGas);
      } else {
        const point = new Point('block')
          .tag('benchmark', 'monitor')
          .uintField('value', block.transactions.length)
          .timestamp(new Date(Number(block.timestamp) * 1000));
        points.push(point);

        const pointGas = new Point('transaction')
          .tag('benchmark', 'monitor')
          .uintField('gas', block.gasUsed)
          .timestamp(new Date(Number(block.timestamp) * 1000));
        pointsGas.push(pointGas);
      }
    };

    for (let i = beginBlockNumber; i <= lastBlockNumber; i++) {
      promises.push(monitor.getBlockInfo(i));
    }

    let result: Block[];
    try {
      result = await Promise.all(promises);
      result = result.sort((a, b) => {
        const sorting = ethers.BigNumber.from(a.number.toString()).sub(
          b.number.toString(),
        );
        return sorting.toNumber();
      });
    } catch (e) {
      Logger.error(`getBenchmarkResult Failure: ${e}`);
      Logger.log(`Retrying...`);
      await new Promise((r) => setTimeout(r, 1000));
      await this.getBenchmarkResult(beginBlockNumber, lastBlockNumber);
      return;
    }

    // timeDiff(s) calculated by 1st block and last block
    let timeDiff = ethers.BigNumber.from(
      result[result.length - 1].timestamp,
    ).sub(result[0].timestamp);
    // prevent div by zero
    timeDiff = timeDiff.isZero() ? ethers.BigNumber.from(1) : timeDiff;
    // totalSubmitToConfirmationTimeDiff(in ms) calculated by 1st transaction submit time and last block
    this.totalSubmitToConfirmationTimeDiff = ethers.BigNumber.from(
      this.totalSubmitToConfirmationTimeDiff,
    ).isZero()
      ? 1
      : this.totalSubmitToConfirmationTimeDiff;

    const averageResponseTime =
      this.averageResponseTimeArray.reduce((acc, cur) => acc + cur, 0) /
      this.averageResponseTimeArray.length;
    // successful tx including non-benchmarking senders
    const totalSuccessfulTx = result.reduce(
      (acc, cur) => acc + cur.transactions.length,
      0,
    );
    const totalGasUsed = result.reduce((acc, cur) => {
      const reduce = ethers.BigNumber.from(acc).add(cur.gasUsed);
      return reduce.toNumber();
    }, 0);
    const gasUsedPerSecond = ethers.BigNumber.from(totalGasUsed)
      .div(timeDiff)
      .toString();
    const benchmarkTps = (
      config.rate_control.txs_per_batch / config.rate_control.every_n_second
    ).toFixed(0);

    const successRateInBlock = `${totalSuccessfulTx}/${this.totalTx} | ${(
      (totalSuccessfulTx / this.totalTx) *
      100
    ).toFixed(2)}%`;

    const successRateInClient = `${this.broadcastedSuccessfulTx}/${
      this.totalTx
    } | ${((this.broadcastedSuccessfulTx / this.totalTx) * 100).toFixed(2)}%`;

    //  averageNetworkTps: Time between 1st Confirmation Block and Last Confirmation Block
    const averageNetworkTps = (
      totalSuccessfulTx / ethers.BigNumber.from(timeDiff).toNumber()
    ).toFixed(3);
    //  averageClientTps: Time between 1st Transaction Submit Time and Last Confirmation Block
    const averageClientTps = (
      totalSuccessfulTx /
      ethers.BigNumber.from(this.totalSubmitToConfirmationTimeDiff)
        .div(1000)
        .toNumber()
    ).toFixed(3);

    // Adding result points to grafana
    result.map((block) => {
      monitor.onNewBlock(block);
    });

    Logger.log(`************ Benchmark Final Result ***************`);
    Logger.log(`Transaction Type: ${config.tx_type}`);
    Logger.log(`Benchmark TPS: ${benchmarkTps}`);
    Logger.log(`Successful Transcation (Block): ${successRateInBlock}`);
    Logger.log(`Successful Transaction (Client): ${successRateInClient}`);
    Logger.log(`Average Response Time(s): ${averageResponseTime.toFixed(3)}s`);
    Logger.log(
      `Longest Response Time(s): ${this.longestResponseTime.toFixed(3)}s`,
    );
    Logger.log(
      `Blocks: ${lastBlockNumber} - ${beginBlockNumber} + 1 | Total: ${
        lastBlockNumber - beginBlockNumber + 1
      }`,
    );
    Logger.log(`Average Gas Used Per Second: ${gasUsedPerSecond}`);
    Logger.log(`Total Gas Used: ${totalGasUsed}`);
    Logger.log(
      `TPS (Network): ${averageNetworkTps} | Time(s): ${timeDiff}s (Block ${beginBlockNumber} - ${lastBlockNumber}) | Timestamp: ${
        result[0].timestamp
      } - ${result[result.length - 1].timestamp}`,
    );
    Logger.log(
      `TPS (Client): ${averageClientTps} | Time(s): ${
        this.totalSubmitToConfirmationTimeDiff / 1000
      }s (1st transaction submit time - Block ${lastBlockNumber}) | Timestamp: ${Math.ceil(
        this.broadcastStartTimestamp / 1000,
      )} - ${result[result.length - 1].timestamp}`,
    );

    this.exportBenchmarkResult({
      txType: config.tx_type,
      benchmarkTps,
      averageNetworkTps,
      averageClientTps,
      successRateInBlock,
      successRateInClient,
      averageResponseTime: averageResponseTime.toFixed(3),
      longestResponseTime: this.longestResponseTime.toFixed(3),
      gasUsedPerSecond,
      totalGasUsed: totalGasUsed.toString(),
    });

    // Write results to grafana
    await InfluxDBConnector.writePoints(points);
    await InfluxDBConnector.writePoints(pointsGas);
  }

  async exportBenchmarkResult(benchmarkResult: BenchmarkResult) {
    Logger.log(`Exporting Benchmark Result..`);
    const {
      txType,
      benchmarkTps,
      averageNetworkTps,
      averageClientTps,
      successRateInBlock,
      successRateInClient,
      averageResponseTime,
      longestResponseTime,
      gasUsedPerSecond,
      totalGasUsed,
    } = benchmarkResult;
    const dir = './benchmark_result';
    const filePath = `${dir}/${this.network.evm_type}/${txType}.json`;

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
    if (!fs.existsSync(`${dir}/${this.network.evm_type}`)) {
      fs.mkdirSync(`${dir}/${this.network.evm_type}`);
    }

    try {
      const resultContent = fs.readFileSync(filePath, 'utf8');
      const content = `| ${benchmarkTps} | ${averageNetworkTps} | ${averageClientTps} | ${successRateInBlock} | ${successRateInClient} | ${gasUsedPerSecond} | ${totalGasUsed} | ${averageResponseTime} | ${longestResponseTime} |\r\n`;

      // writing the JSON string content to a file
      fs.appendFile(filePath, content, (error) => {
        // throwing the error
        // in case of a writing problem
        if (error) {
          // logging the error
          Logger.error(error);

          throw error;
        }

        Logger.log(`Benchmark results appended in path: ${filePath}`);
      });
    } catch (e) {
      // writing the JSON string content to a file
      let content =
        '| Benchmark TPS | Average TPS (Network) | Average TPS (Client) | Success Rate (Block) | Success Rate (Client) | Gas Used / s | Total Gas Used | Average Response Time(s) | Longest Response Time(s) |\r\n';
      content +=
        '| :----: | :----: | :----: | :----: | :----: | :----: | :----: | :----: |\r\n';
      content += `| ${benchmarkTps} | ${averageNetworkTps} | ${averageClientTps} | ${successRateInBlock} | ${successRateInClient} | ${gasUsedPerSecond} | ${totalGasUsed} | ${averageResponseTime} | ${longestResponseTime} |\r\n`;
      fs.writeFile(filePath, content, (error) => {
        // throwing the error
        // in case of a writing problem
        if (error) {
          // logging the error
          Logger.error(error);

          throw error;
        }

        Logger.log(`Benchmark results created in path: ${filePath}`);
      });
    }
  }

  async getBenchmarkDetail(
    monitor: EVMMonitor,
    testRoundIteration: TestRoundIteration,
    isSkipWaiting = false,
  ) {
    const testRoundLength =
      testRoundIteration.end - testRoundIteration.start + 1;
    if (this.roundResults.length !== testRoundLength && !isSkipWaiting) {
      return { firstBlockNumber: 0, lastBlockNumber: 0 };
    }

    let firstBlockNumber = 0;
    let lastBlockNumber = 0;
    let txCount = 0;

    for (let i = 0; i < this.roundResults.length; i++) {
      for (let j = 0; j < this.roundResults[i].transactions.length; j++) {
        if (this.roundResults[i].transactions[j].receipt) {
          txCount++;
          if (
            this.roundResults[i].transactions[j].receipt.blockNumber >
            lastBlockNumber
          ) {
            lastBlockNumber =
              this.roundResults[i].transactions[j].receipt.blockNumber;
          }
          if (
            this.roundResults[i].transactions[j].receipt.blockNumber <
              firstBlockNumber ||
            firstBlockNumber === 0
          ) {
            firstBlockNumber =
              this.roundResults[i].transactions[j].receipt.blockNumber;
          }
        }
      }
    }

    return {
      firstBlockNumber,
      lastBlockNumber,
      txCount,
    };
  }

  async prepareTxRoundArray() {
    const rounds: number[] = [];
    const testTxPerRound = config.rate_control.txs_per_batch;
    const type = config.rate_control.type;
    switch (type) {
      case RateControlType.FIXED_LOAD: {
        const warmUpTps = config.rate_control.opts.warmup_tps;
        const warmUpTime = config.rate_control.opts.time;
        const warmUpTotalTx = warmUpTps * warmUpTime;
        const warmUpTxPerBatch = warmUpTps * config.rate_control.every_n_second;
        const warmUpRounds = Math.ceil(warmUpTotalTx / warmUpTxPerBatch);

        for (let i = 0; i < warmUpRounds; i++) {
          rounds.push(warmUpTxPerBatch);
        }

        this.totalTx = config.total_tx - warmUpTotalTx;
        let testTotalTx = this.totalTx;
        const testTotalRounds = Math.ceil(testTotalTx / testTxPerRound);
        for (let i = 0; i < testTotalRounds; i++) {
          if (testTotalTx !== 0) {
            rounds.push(
              testTotalTx > testTxPerRound
                ? testTxPerRound
                : Math.abs(testTotalTx),
            );
          }
          testTotalTx -= testTxPerRound;
        }
        break;
      }
      case RateControlType.MAXIMUM_RATE: {
        let warmUpTotalTx = 0;
        const warmUpTps = config.rate_control.opts.warmup_tps;
        let warmUpTxPerBatch = warmUpTps * config.rate_control.every_n_second;
        const warmUpStepIncrement =
          config.rate_control.opts.step * config.rate_control.every_n_second;
        const warmup_interval_rounds = Math.ceil(
          config.rate_control.opts.sample_interval /
            config.rate_control.every_n_second,
        );

        while (warmUpTxPerBatch < config.rate_control.txs_per_batch) {
          for (let i = 0; i < warmup_interval_rounds; i++) {
            rounds.push(warmUpTxPerBatch);
            warmUpTotalTx += warmUpTxPerBatch;
          }
          warmUpTxPerBatch += warmUpStepIncrement;
        }

        this.totalTx = config.total_tx - warmUpTotalTx;
        let testTotalTx = this.totalTx;
        const total_rounds = Math.ceil(testTotalTx / testTxPerRound);
        for (let i = 0; i < total_rounds; i++) {
          if (testTotalTx !== 0) {
            rounds.push(
              testTotalTx > testTxPerRound
                ? testTxPerRound
                : Math.abs(testTotalTx),
            );
          }
          testTotalTx -= testTxPerRound;
        }
        break;
      }
      default: {
        let testTotalTx = config.total_tx;
        const total_rounds = Math.ceil(config.total_tx / testTxPerRound);
        for (let i = 0; i < total_rounds; i++) {
          if (testTotalTx !== 0) {
            rounds.push(
              testTotalTx > testTxPerRound
                ? testTxPerRound
                : Math.abs(testTotalTx),
            );
          }
          testTotalTx -= testTxPerRound;
        }
      }
    }

    this.txRoundArray = rounds;
  }

  async syncNodeTimestampDiff(blockHeight: number) {
    const network = this.network;
    const monitor = new EVMMonitor(network.node_url);
    const block = await monitor.getBlockInfo(blockHeight);
    const nodeTimestamp = Number(block.timestamp) * 1000;
    this.nodeTimestampDiff = nodeTimestamp - Date.now();
    Logger.log(
      `Block Height: ${blockHeight} | Block Timestamp: ${block.timestamp}`,
    );
    Logger.log(`Client Timestamp: ${Date.now()}`);
    Logger.log(
      `Timestamp difference: ${
        this.nodeTimestampDiff / 1000
      }s (bewtween Node (${network.node_url}) and Client)`,
    );
  }

  async warmUpScheduleJob(txSending: number) {
    // Check Warm Up procedures
    this.warmUpRound++;
    this.warmUpBroadcastedTx += txSending;
    Logger.log(`************ Warm Up Round ${this.testRound} ***************`);
    Logger.log(
      `Sent Tx: ${this.broadcastedTx} | sending ${txSending} transactions`,
    );
    switch (config.rate_control.type) {
      case RateControlType.FIXED_LOAD:
      case RateControlType.MAXIMUM_RATE: {
        // If next round is not warm up round
        if (
          this.txRoundArray[this.testRound] ===
          config.rate_control.txs_per_batch
        ) {
          this.isWarmUp = false;
          this.testRoundIteration.push({ start: 1, end: this.testRound });
          this.testRoundIteration.push({
            start: this.testRound + 1,
            end: this.txRoundArray.length,
          });
          Logger.log(`************ Warm Up Ends ***************`);
        }
        break;
      }
      default:
    }
    return;
  }

  async runScheduleJob() {
    const network = this.network;
    const monitor = new EVMMonitor(network.node_url);
    let isGetBenchmarkJobRunning = false;
    const configuration = {
      startIndex: this.currentAccountIndex,
      endIndex: config.total_tx,
      chainId: this.chainId,
      evmType: network.evm_type,
      gasLimit: network.gas_limit,
      gasPrice: network.gas_price,
    };

    let signedTxs: string[] = [];
    switch (config.tx_type) {
      case TxType.NORMAL:
        {
          signedTxs = await buildNormalTransferSignatures_rs(configuration);
        }
        break;
      case TxType.ERC20:
        {
          signedTxs = await buildSendERC20Signatures_rs(configuration);
        }
        break;
    }

    if (config.pair_benchmark) {
      await waitForKeypress();
    }

    schedule.scheduleJob(
      'blast',
      { rule: config.rate_control.frequency },
      async () => {
        try {
          if (config.total_tx !== 0 && this.broadcastedTx < config.total_tx) {
            this.testRound += 1;
            const txSending = this.txRoundArray[this.testRound - 1];
            this.broadcastedTx += txSending;

            if (
              config.rate_control.type === RateControlType.NONE &&
              this.isWarmUp
            ) {
              this.isWarmUp = false;
              this.testRoundIteration.push({
                start: 1,
                end: this.txRoundArray.length,
              });
            }

            if (this.isWarmUp) {
              this.warmUpScheduleJob(txSending);
            } else {
              Logger.log(
                `Round ${this.testRound - this.warmUpRound} | Sent Tx: ${
                  this.broadcastedTx - this.warmUpBroadcastedTx
                } | sending ${txSending} transactions`,
              );
              // Adjust the broadcastStartTimestamp with Node timestamp difference
              this.broadcastStartTimestamp =
                this.broadcastStartTimestamp === 0
                  ? Date.now() + this.nodeTimestampDiff
                  : this.broadcastStartTimestamp;
            }

            switch (config.tx_type) {
              case TxType.SWAP: {
                // don't wait this function here to finish, or it will block the next round
                this.startNewRound(
                  this.testRound,
                  this.warmUpRound,
                  txSending,
                  buildSwapSignatures_rs,
                  (result) => {
                    if (!this.isWarmUp && result.round > 0) {
                      this.roundResults.push(result);
                      this.printRound(result);
                    }
                  },
                );
                break;
              }
              case TxType.ERC20: {
                this.startNewRoundRevised(
                  this.testRound,
                  this.warmUpRound,
                  txSending,
                  signedTxs.slice(
                    this.currentAccountIndex - 1,
                    this.currentAccountIndex + txSending - 1,
                  ),
                  (result) => {
                    if (!this.isWarmUp && result.round > 0) {
                      this.roundResults.push(result);
                      this.printRound(result);
                    }
                  },
                );
                break;
              }
              case TxType.NORMAL: {
                Logger.log(
                  `startNewRoundRevised Sending transactions | Account Index ${
                    this.currentAccountIndex - 1
                  } - ${this.currentAccountIndex + txSending - 1}`,
                );

                this.startNewRoundRevised(
                  this.testRound,
                  this.warmUpRound,
                  txSending,
                  signedTxs.slice(
                    this.currentAccountIndex - 1,
                    this.currentAccountIndex + txSending - 1,
                  ),
                  (result) => {
                    if (!this.isWarmUp && result.round > 0) {
                      this.roundResults.push(result);
                      this.printRound(result);
                    }
                  },
                );
                break;
              }
              case TxType.MINT_NFT: {
                this.startNewRound(
                  this.testRound,
                  this.warmUpRound,
                  txSending,
                  buildMintNFTSignatures,
                  (result) => {
                    if (!this.isWarmUp && result.round > 0) {
                      this.roundResults.push(result);
                      this.printRound(result);
                    }
                  },
                );
                break;
              }
              case TxType.DEPOSIT:
                {
                  this.startNewRound(
                    this.testRound,
                    this.warmUpRound,
                    txSending,
                    null,
                    (result) => {
                      if (!this.isWarmUp && result.round > 0) {
                        this.roundResults.push(result);
                        this.printRound(result);
                      }
                    },
                  );
                }
                break;
            }
          } else {
            if (!this.isBroadcastFinished) {
              this.broadcastFinishTimestamp = new Date();
              this.isBroadcastFinished = true;
            }

            let iterationIndex = 0;
            switch (config.rate_control.type) {
              case RateControlType.FIXED_LOAD:
              case RateControlType.MAXIMUM_RATE: {
                iterationIndex = 1;
                break;
              }
              case RateControlType.NONE:
              default: {
                iterationIndex = 0;
              }
            }
            const isSkipWaiting =
              new Date().getTime() - this.broadcastFinishTimestamp.getTime() >
              config.rate_control.load_timeout
                ? true
                : false;
            const { firstBlockNumber, lastBlockNumber, txCount } =
              await this.getBenchmarkDetail(
                monitor,
                this.testRoundIteration[iterationIndex],
                isSkipWaiting,
              );
            Logger.log(
              `firstBlockNumber: ${firstBlockNumber} | lastBlockNumber: ${lastBlockNumber}`,
            );
            if (
              !firstBlockNumber ||
              !lastBlockNumber ||
              (txCount < config.total_tx &&
                new Date().getTime() -
                  this.broadcastFinishTimestamp.getTime() <=
                  config.rate_control.load_timeout)
            ) {
              Logger.log(
                `Some transactions are not yet finished, continue waiting..., ${
                  txCount ?? 0
                }/${config.total_tx}`,
              );
              return;
            }
            const lastBlockInfo = await monitor.getBlockInfo(lastBlockNumber);

            // totalSubmitToConfirmationTimeDiff(in ms) calculated by 1st transaction submit time and last confirmation block time
            this.totalSubmitToConfirmationTimeDiff =
              Number(lastBlockInfo.timestamp) * 1000 -
              this.broadcastStartTimestamp;
            const totalBenchmarkTx =
              this.broadcastedTx - this.warmUpBroadcastedTx;

            switch (network.evm_type) {
              case EvmType.HERMEZ: {
                await this.getBenchmarkResult(
                  firstBlockNumber,
                  lastBlockNumber,
                );
                schedule.cancelJob('blast');
                Logger.log(`[monitor] Schedule Job finished`);
                break;
              }
              case EvmType.OPTIMISM: {
                if (
                  totalBenchmarkTx - (lastBlockNumber - firstBlockNumber + 1) <=
                    0 ||
                  new Date().getTime() -
                    this.broadcastFinishTimestamp.getTime() >
                    config.rate_control.load_timeout
                ) {
                  this.getBenchmarkResult(firstBlockNumber, lastBlockNumber);
                  schedule.cancelJob('blast');
                  Logger.log(`[monitor] Schedule Job finished`);
                }
                break;
              }
              case EvmType.Standard:
              case EvmType.ZKSYNC: {
                if (isGetBenchmarkJobRunning) {
                  return;
                }
                isGetBenchmarkJobRunning = true;

                this.broadcastedSuccessfulTx = await monitor.getTotalTxCount(
                  firstBlockNumber,
                  lastBlockNumber,
                  this.roundResults,
                );
                Logger.log(
                  `[monitor] Block Height: ${lastBlockNumber} | Remaining Transactions: ${
                    totalBenchmarkTx - this.broadcastedSuccessfulTx
                  }`,
                );

                isGetBenchmarkJobRunning = false;

                if (
                  totalBenchmarkTx - this.broadcastedSuccessfulTx <= 0 ||
                  new Date().getTime() -
                    this.broadcastFinishTimestamp.getTime() >
                    config.rate_control.load_timeout
                ) {
                  schedule.cancelJob('blast');
                  this.getBenchmarkResult(firstBlockNumber, lastBlockNumber);
                  Logger.log(`[monitor] Schedule Job finished`);
                }
                break;
              }
              default:
            }
          }
        } catch (e) {
          Logger.error(`ScheduleJob Failure: ${e}, ${e.stack}`);
        }
      },
    );
  }
}
