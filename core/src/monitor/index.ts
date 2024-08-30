import { EVMMonitor } from './service/web3/EVMMonitor';
import { InfluxDBConnector, loadConfig } from '../lib';
import { Point } from '@influxdata/influxdb-client';
import { getNetwork } from '../lib/config';

export async function bootstrap() {
  const config = loadConfig((config) => config);

  await InfluxDBConnector.onBoardInfluxDB();

  await InfluxDBConnector.recreateBucket();

  const network = getNetwork(config);
  const monitor = new EVMMonitor(network.node_url);

  monitor.start();

  monitor.onNewBlock = async (block) => {
    const point = new Point('block')
      .tag('benchmark', 'monitor')
      .uintField('value', block.transactions.length)
      .timestamp(new Date(Number(block.timestamp) * 1000));
    await InfluxDBConnector.writePoints([point]);

    const points: Point[] = [];
    for (const tx of block.transactions) {
      if (typeof tx === 'string') {
        continue;
      } else {
        const point = new Point('transaction')
          .tag('benchmark', 'monitor')
          .stringField('blockHush', tx.blockHash)
          .uintField('blockNumber', tx.blockNumber)
          .stringField('from', tx.from)
          .stringField('to', tx.to)
          .uintField('gas', tx.gas)
          .stringField('gasPrice', tx.gasPrice)
          .uintField('nonce', tx.nonce)
          .stringField('hash', tx.hash)
          .stringField('value', tx.value)
          .timestamp(new Date(Number(block.timestamp) * 1000));
        points.push(point);
      }
    }
    await InfluxDBConnector.writePoints(points);
  };
}
