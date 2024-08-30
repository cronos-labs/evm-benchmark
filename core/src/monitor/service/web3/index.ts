import Web3 from 'web3';

export async function getLatestBlockNumber(provider: string) {
  const web3 = new Web3(provider);

  const blockNumber = await web3.eth.getBlockNumber();

  return blockNumber;
}
