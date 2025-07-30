const { spawn } = require('child_process');
const path = require('path');

const INDEX_PATH = path.join(__dirname, 'index.js');
const RESTART_DELAY = 5000; // ms

let child;
let shuttingDown = false;

function start() {
  child = spawn(process.argv0, [INDEX_PATH], { stdio: 'inherit' });

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      process.exit(code ?? 0);
    }

    if (code !== 0) {
      console.log(`Bot exited unexpectedly with code ${code ?? signal}. Restarting in ${RESTART_DELAY / 1000}s...`);
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
