const { fork } = require('child_process');
const path = require('path');
const pino = require('pino');
const pretty = require('pino-pretty');

const logger = pino({}, pino.multistream([
  { stream: pino.destination('logs.txt') },
  { stream: pretty({ colorize: true }) },
]));

const INDEX_PATH = path.join(__dirname, 'index.js');
const RESTART_DELAY = 10000; // ms

let child;
let shuttingDown = false;

function start() {
  child = fork(INDEX_PATH, [], { stdio: 'inherit', execArgv: ['--no-deprecation'] });

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      process.exit(code ?? 0);
    }

    if (code !== 0) {
      logger.error(`Bot exited unexpectedly with code ${code ?? signal}. Restarting in ${RESTART_DELAY / 1000}s...`);
      setTimeout(start, RESTART_DELAY);
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
