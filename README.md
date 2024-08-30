# EVM Benchmark Tool

## Folder Structure

- Generator
  - Generate load to the network
  - Generate accounts, fund accounts, send TX, manage nonce, etc
  - Write metrics to Collector
- Monitor
  - Monitor network status
  - Keep track of block, tx count, gas usage, account count, etc
  - Write metrics to Collector
- Collector
  - Collect metrics of generator & monitor produce
  - Analyze and plot chart based on metrics

## Pre-requirements

- [Docker](https://www.docker.com/)
- [pnpm](https://pnpm.io/)
  - `curl -fsSL https://get.pnpm.io/install.sh | sh -`
- [npx](https://nodejs.dev/en/learn/the-npx-nodejs-package-runner/)
  - `npm install --global npx`

## Dev Quick start

### Configs
We currently provide 2 kinds of config file for `hermez` and `zksync` L2 project.
Please copy `config-[project].json` to `config.json` under the repo root.

Check with your configs in `config.json` before running the benchmark:
```
"network": {
  "evm_type": "standard",
  "node_url": "http://localhost:8545",
  "gas_limit": "100000",
  "gas_price": "5000000000000",
  "layer2": {
    "node_url": "http://localhost:3050",
    "gas_limit": "10000000",
    "gas_price": "0x10000000",
    "evm_type": "zkSync",
    "benchmark": true
  }
  ...
}
```
There are both layer1 & layer2 network configs. `"benchmark": true` is the indicator to decide which config to be used. Only the config object containing `"benchmark": true` will be used, and other config object will be ignored. But chain like `zkSync` requires both layers config in order to work properly. 

- `node_url`: The Node RPC endpoint serving the blockchain network. 
- `evm_type`: 4 types of chains are available:
	- `standard` | `optimism` | `zkSync` | `hermez`
Please use the correct type of chain, or the benchmark result calculation might not be accurate due to different chain's behavior. 
```
{
  "account": {
    "mnemonic": "test test test test test test test test test test test junk",
    "l1_holding": "10",
    "optimism_holding": "0.000001",
    "zksync_holding": "0.0005"
  },
  "tx_type": "erc20Transfer",
  "rate_control": {
    "txs_per_batch": 100,
    "every_n_second": 2
  },
  "total_tx": 500
}
```

- `tx_type`: 
	- `normalTransfer`
	- `erc20Transfer`
	- `swap`
	- `mint`
	- `deposit`: benchmark for zkSync deposit, from L1 to L2
- `rate_control`: Control the rate of transaction blast. 
Approximate transactions per min = `txs_per_batch` * (60 / `txs_per_batch`)
	- `txs_per_batch`: Decrease the number if transactions are failing.
	- `every_n_second`: Increase the number if transactions are failing.
	- `load_timeout`: The benchmark process will end whatever after the specified timeout(in Second).
  - `type`: There are 2 types of warm up, which allows you to warm up the node by sending transactions, before the benchmark starts
    - `fixed-load` | `maximum-rate` | `none`: Reference on [Hyperledger Caliper Rate Controllers](https://hyperledger.github.io/caliper/v0.5.0/rate-controllers/#fixed-rate)
  - `opts`: Warm Up settings. Please refer to [Hyperledger Caliper Rate Controllers](https://hyperledger.github.io/caliper/v0.5.0/rate-controllers/#fixed-rate)
- `total_tx`: Total no. of transactions to be blasted

Other configs: 
```
{
  "write_to_influxdb": false,
  "pair_benchmark": true,
}
```

- `write_to_influxdb`: Whether to write data into InfluxDB for grafana showcase. Reminded that this will slow down the benchmark processing speed, and may result in a lower benchmark TPS.
- `pair_benchmark`: Benchmark is onhold until a key press start signal. This is particularly useful when you are using multiple machines to benchmark on the same network.

### Start & connect to a dedicated node
```bash
pnpm start:dev
```
#### Troubleshot
When benchmarking zkSync, there's a possibility that you might encounter this error: 
```
│ Error occured:  No files passed.
│ `src/generator/contracts/artifacts/src/**/*[^dbg].json` didn't match any input files in ...
│ Run with --show-stack-traces to see the full stacktrace
```
Please locally change `src/generator/contracts/artifacts/src/**/*[^dbg].json` into `src/generator/contracts/artifacts-zk/src/**/*[^dbg].json` in `/core/package.json` to fix this.

### Start with a local hardhat devnet
Make sure `node_url: "http://localhost:8545"` in `config.json` 

```bash
pnpm start:hardhat-dev
```

## Production Docker image

Start all services with Docker Compose
```bash
docker-compose up
```

If you want to run the services in the background
```bash
docker-compose up -d
```

If you want to rebuild the service containers with your changes
```bash
docker-compose up --build
```

After the services are all deployed:
### Grafana
- Navigate to [http://localhost:3000](http://localhost:3000), enter `admin` and `admin` to login grafana.
- Inside grafana, there is a dashboard named `Benchmark`, and you can see the charts.

### InfluxDB
- Navigate to [http://localhost:8086](http://localhost:8086), enter `my-user` and `my-password` to login InfluxDB.


