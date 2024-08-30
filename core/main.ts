import { bootstrap as bootstrapMonitor } from './src/monitor';
import { bootstrap as bootstrapGenerator } from './src/generator';
import cluster from 'cluster';

async function run() {
  if (cluster.isPrimary) {
    await bootstrapMonitor();
  }
  await bootstrapGenerator();
}

run();
