import { Logger } from '@nestjs/common';

export function waitForKeypress() {
  return new Promise<void>((resolve, reject) => {
    Logger.log(`Press 'y' to start the blast, 'n' to exit.`);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const keyListener = (key) => {
      if (key.toString() === 'y') {
        Logger.log('Continue the blast...');
        process.stdin.off('data', keyListener);
        process.stdin.setRawMode(false);
        resolve();
      } else if (key.toString() === 'n') {
        Logger.log(`Exiting...`);
        reject();
        process.stdin.off('data', keyListener);
        process.stdin.setRawMode(false);
        process.exit(0);
      }
    };

    process.stdin.on('data', keyListener);

    process.on('SIGINT', () => {
      Logger.log(`Process interrupted...`);
      process.stdin.off('data', keyListener);
      process.stdin.setRawMode(false);
      process.exit(0);
    });
  });
}
