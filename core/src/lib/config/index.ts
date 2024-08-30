import * as path from 'path';
import * as fs from 'fs';
import { Logger } from '@nestjs/common';
import { assert } from 'console';
import { ethers } from 'ethers';
import { getRandomMnemonic } from '../../generator/utils/account';

const MAX_BATCH_SIZE = 200;

export interface Network {
  evm_type: EvmType;
  node_url: string;
  gas_limit: ethers.BigNumber;
  gas_price: ethers.BigNumber;
  benchmark: boolean;
}

export interface BaseNetwork extends Network {
  layer2: Network;
}

export interface BenchmarkConfig {
  network: BaseNetwork;
  write_to_influxdb: boolean;
  pair_benchmark: boolean;
  account: Account;
  evm_type: EvmType;
  tx_type: TxType;
  rate_control: RateControl;
  total_tx: number;
}

export interface Account {
  mnemonic: string;
  l1_holding: string;
  optimism_holding: string;
  zksync_holding: string;
  random_mnemonic: string;
  start_index: number;
  end_index: number;
  funding_factor: number;
}

export enum EvmType {
  Standard = 'standard',
  OPTIMISM = 'optimism',
  ZKSYNC = 'zkSync',
  HERMEZ = 'hermez',
}

export enum TxType {
  NORMAL = 'normalTransfer',
  ERC20 = 'erc20Transfer',
  SWAP = 'swap',
  MINT_NFT = 'mint',
  DEPOSIT = 'deposit',
}

export enum RateControlType {
  FIXED_LOAD = 'fixed-load',
  MAXIMUM_RATE = 'maximum-rate',
  NONE = 'none',
}

export interface Opts {
  warmup_tps?: number;
  time?: number;
  step?: number;
  sample_interval?: number;
}

export interface RateControl {
  frequency: string;
  txs_per_batch: number;
  every_n_second: number;
  load_timeout: number;
  type: RateControlType;
  opts?: Opts;
}

export const BenchmarkConfigPath = path.resolve(
  __dirname,
  '../../../../../config.json',
);

export function getNetwork(config: BenchmarkConfig): Network {
  if (config.network.benchmark === true) {
    return config.network;
  }

  if (config.network.layer2.benchmark === true) {
    return config.network.layer2;
  }

  assert('Cannot find benchmark network');
}

export function loadConfig(
  validate: (BenchmarkConfig) => BenchmarkConfig,
): BenchmarkConfig {
  let result: BenchmarkConfig;
  try {
    const params = process.argv.slice(2);
    const startIndex = parseInt(params[0] ?? '0');
    const config: BenchmarkConfig = JSON.parse(
      fs.readFileSync(BenchmarkConfigPath).toString(),
    );
    validate(config);
    let total_tx = config.total_tx;
    let warmup_tx = 0;
    switch (config.rate_control.type) {
      case RateControlType.FIXED_LOAD: {
        if (
          config.rate_control.opts.time &&
          config.rate_control.opts.warmup_tps
        ) {
          warmup_tx =
            config.rate_control.opts.time * config.rate_control.opts.warmup_tps;
          total_tx += warmup_tx;
        }
        break;
      }
      case RateControlType.MAXIMUM_RATE: {
        if (
          config.rate_control.opts.warmup_tps &&
          config.rate_control.opts.sample_interval &&
          config.rate_control.opts.step
        ) {
          let warmup_tps = config.rate_control.opts.warmup_tps;
          const warmup_interval_rounds =
            config.rate_control.opts.sample_interval /
            config.rate_control.every_n_second;
          // Increase tps until warm up tps reaches benchmark tps
          while (
            warmup_tps * config.rate_control.every_n_second <
            config.rate_control.txs_per_batch
          ) {
            warmup_tx +=
              warmup_tps *
              config.rate_control.every_n_second *
              warmup_interval_rounds;
            warmup_tps += config.rate_control.opts.step;
          }
          total_tx += warmup_tx;
        }
        break;
      }
      case RateControlType.NONE:
      default:
        warmup_tx = 0;
    }

    result = {
      ...config,
      network: {
        ...config.network,
        gas_limit: ethers.BigNumber.from(config.network.gas_limit),
        gas_price: ethers.BigNumber.from(config.network.gas_price),
      },
      write_to_influxdb: config.write_to_influxdb,
      pair_benchmark: config.pair_benchmark,
      account: {
        ...config.account,
        random_mnemonic: getRandomMnemonic(),
        start_index: 1 + startIndex,
        end_index:
          Math.min(config.rate_control.txs_per_batch, MAX_BATCH_SIZE) +
          startIndex,
        funding_factor:
          (config.total_tx + warmup_tx) /
          Math.min(config.rate_control.txs_per_batch, MAX_BATCH_SIZE),
      },
      rate_control: {
        ...config.rate_control,
        frequency: `*/${config.rate_control.every_n_second.toString()} * * * * *`,
        load_timeout: config.rate_control.load_timeout * 1000,
      },
      total_tx: total_tx,
    };
  } catch (error) {
    Logger.error(
      `Cannot read config from ${BenchmarkConfigPath}. Please check if the file exists and is valid JSON.`,
      error,
    );
    process.exit(-1);
  }
  return result;
}
