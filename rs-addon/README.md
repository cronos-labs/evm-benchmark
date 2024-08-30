# rs-addon

Provide a concurrent transaction sending servie using tokio tasks, written with rust.

## Build

```sh
pnpm build

# or build debug version, this will automatic run when running `pnpm i`
pnpm build:debug
```

after building, napi-rs will generate node api in `index.js`


## Usage

Use it like a normal npm package, instead of sending & wating in a single thread in Node.js process, the rs-addon will send & wait all these transactions in a node.js addon

```js
import { sendRawTransactions } from 'rs-addon';

const txResults = await sendRawTransactions(config.network.node_url, signedTxs);
```


## Tech stacks

- [napi-rs](https://napi.rs/)
- [tokio](https://docs.rs/tokio/latest/tokio/index.html#)
- [ethers.rs](https://github.com/gakonst/ethers-rs)