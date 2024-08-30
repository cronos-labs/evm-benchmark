import test from 'ava'
import { ethers } from 'ethers'

import { sum, sendTransaction, sendRawTransactions } from '../index.js'

test('sum from native', (t) => {
  t.is(sum(1, 2), 3)
})


// test('send transaction', async (t) => {
//   for (let i = 0; i < 1000; ++i) {
//     const hash = await sendTransaction('http://localhost:8545', 31337, '4c9bf220174eb3e9a15536ff4ff1985826e0bcef256020686cf8841f56a1119a', '0x06f509F73eefBA36352Bc8228F9112C3786100dA')
//     console.log(hash);
//   }
// })

test('send raw trnasaction', async (t) => {

  let mnemonic = "test test test test test test test test test test test junk";
  let chainId = 31337;
  let httpProvider = "http://localhost:8545"

  let signer = ethers.Wallet.fromMnemonic(mnemonic)

  const tx = {
    to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    value: 100,
    gasPrice: 875000000,
    gasLimit: 21000,
    chainId: chainId,
  }
  const signature = await signer.signTransaction(tx);
  let res = await sendRawTransactions(httpProvider, [signature])

  t.not(res, null)

})