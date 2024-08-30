import { Injectable } from '@nestjs/common';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as Joi from 'joi';
import { BenchmarkConfig, loadConfig } from '../../lib';
import { EvmType, RateControlType, TxType } from '../../lib/config';

export let ENV: Env;
export let config: BenchmarkConfig;

export interface Env {}

@Injectable()
export class ConfigService {
  readonly config: BenchmarkConfig;
  readonly env: Env;

  constructor(filePath: string) {
    this.config = loadConfig(ConfigService.validateConfig);
    config = this.config;
    this.env = ConfigService.validateInput(
      dotenv.parse(fs.readFileSync(filePath)),
    );
    ENV = this.env;
  }

  private static validateConfig(config: BenchmarkConfig): BenchmarkConfig {
    const evmTypeArray = Object.values(EvmType);
    const txTypeArray = Object.values(TxType);
    const rateControlTypeArray = Object.values(RateControlType);

    const envVarsSchema = Joi.object<BenchmarkConfig>({
      network: {
        evm_type: Joi.string()
          .valid(...evmTypeArray)
          .required(),
        node_url: Joi.string().required(),
        gas_limit: Joi.string().required(),
        gas_price: Joi.string().required(),
        benchmark: Joi.bool().optional().default(false),
        layer2: {
          evm_type: Joi.string()
            .valid(...evmTypeArray)
            .required(),
          node_url: Joi.string().required(),
          gas_limit: Joi.string().required(),
          gas_price: Joi.string().required(),
          benchmark: Joi.bool().optional().default(false),
        },
      },
      write_to_influxdb: Joi.bool().optional().default(false),
      pair_benchmark: Joi.bool().optional().default(false),
      account: Joi.object({
        mnemonic: Joi.string().required(),
        l1_holding: Joi.string().required(),
        optimism_holding: Joi.string().required(),
        zksync_holding: Joi.string().required(),
      }),
      tx_type: Joi.string()
        .valid(...txTypeArray)
        .required(),
      rate_control: Joi.object({
        txs_per_batch: Joi.number().required(),
        every_n_second: Joi.number().required(),
        load_timeout: Joi.number().required(),
        type: Joi.string()
          .valid(...rateControlTypeArray)
          .required(),
        opts: Joi.alternatives().conditional('type', [
          {
            is: RateControlType.FIXED_LOAD,
            then: Joi.object({
              warmup_tps: Joi.number().required().default(0),
              time: Joi.number().required().default(0),
              step: Joi.number().optional().default(0),
              sample_interval: Joi.number().optional().default(0),
            }),
          },
          {
            is: RateControlType.MAXIMUM_RATE,
            then: Joi.object({
              warmup_tps: Joi.number().required().default(0),
              time: Joi.number().optional().default(0),
              step: Joi.number().required().default(0),
              sample_interval: Joi.number().required().default(0),
            }),
          },
          {
            is: RateControlType.NONE,
            then: Joi.any().optional().default({}),
          },
        ]),
      }),
      total_tx: Joi.number().required(),
    });

    const { error, value: validatedConfig } = envVarsSchema.validate(config, {
      abortEarly: false,
    });

    if (error) {
      throw new Error(`Config validation error: ${error.message}`);
    }

    return validatedConfig;
  }

  private static validateInput(config: dotenv.DotenvParseOutput): Env {
    const envVarsSchema = Joi.object<Env>({
      PORT: Joi.number().optional(),
    });

    const { error, value: validatedEnvConfig } = envVarsSchema.validate(config);

    if (error) {
      throw new Error(`Config validation error: ${error.message}`);
    }

    return validatedEnvConfig;
  }
}
