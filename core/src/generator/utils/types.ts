import { TransactionReceipt } from '@ethersproject/providers';
import { ethers } from 'ethers';
import { EvmType } from '../../lib/config';

export type RoundTXFunction = (
  index: number,
  testRound: number,
  chainId: number,
  total?: number,
) => Promise<TransactionResult>;

export interface BuildTxConfig {
  chainId: number;
  evmType: EvmType;
  startIndex: number;
  endIndex: number;
  gasPrice: ethers.BigNumber;
  gasLimit: ethers.BigNumber;
}

export type BuildTxFunc = (config: BuildTxConfig) => Promise<string[]>;

export interface TransactionResult {
  index: number;
  success: boolean;
  startTime: number;
  sendTime: number;
  sendTimeCost: number;
  responseTimeCost: number;
  receipt: Partial<TransactionReceipt>;
}

export interface TestRoundIteration {
  start: number;
  end: number;
}

export interface RoundResult {
  round: number;
  successCount: number;
  failedCount: number;
  averageResponseTime: number;
  longestResponseTime: number;
  start: number;
  end: number;
  transactions: TransactionResult[];
}

export interface BenchmarkResult {
  txType: string;
  benchmarkTps: string;
  averageNetworkTps: string;
  averageClientTps: string;
  successRateInBlock: string;
  successRateInClient: string;
  averageResponseTime: string;
  longestResponseTime: string;
  gasUsedPerSecond: string;
  totalGasUsed: string;
}
