const { fork } = require('child_process');
const path = require('path');
const pino = require('pino');
const pretty = require('pino-pretty');
const fs = require('fs');

const logger = pino({}, pino.multistream([
  { stream: pino.destination('logs.txt') },
  { stream: pretty({ colorize: true }) },
]));

const INDEX_PATH = path.join(__dirname, 'index.js');
const RESTART_DELAY = 10000; // ms
const MAX_RESTARTS = 5;

let restartAttempts = 0;

let child;
let shuttingDown = false;

function start() {
  child = fork(INDEX_PATH, [], { stdio: 'inherit', execArgv: ['--no-deprecation'] });

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      process.exit(code ?? 0);
    }

    const restartRequested = fs.existsSync('restart.flag');
    if (restartRequested) {
      fs.unlinkSync('restart.flag');
    }

    if (code !== 0 || restartRequested) {
      restartAttempts += 1;
      if (restartAttempts > MAX_RESTARTS) {
        logger.error(`Maximum restart attempts (${MAX_RESTARTS}) reached. Exiting.`);
        process.exit(code ?? 1);
        return;
      }

      const delay = RESTART_DELAY * (2 ** (restartAttempts - 1));
      const reason = code !== 0 ? ` unexpectedly with code ${code ?? signal}` : '';
      logger.error(
        `Bot exited${reason}. Restarting in ${delay / 1000}s (attempt ${restartAttempts}/${MAX_RESTARTS})...`,
      );
      setTimeout(start, delay);
    } else {
      process.exit(0);
    }
  });
}

['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, () => {
    shuttingDown = true;
    if (child && !child.killed) {
      child.kill(sig);
    }
  });
});

start();

