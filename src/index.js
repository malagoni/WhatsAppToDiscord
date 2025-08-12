const nodeCrypto = require('crypto');
if (!globalThis.crypto) {
  globalThis.crypto = nodeCrypto.webcrypto;
}
const pino = require('pino');
const pretty = require('pino-pretty');
const fs = require('fs');

const discordHandler =  require('./discordHandler.js');
const state =  require('./state.js');
const utils =  require('./utils.js');
const storage = require('./storage.js');
const whatsappHandler =  require('./whatsappHandler.js');

(async () => {
    const version = 'v1.1.27';
  state.version = version;
  const streams = [
    { stream: pino.destination('logs.txt') },
    { stream: pretty({ colorize: true }) },
  ];
  state.logger = pino({ mixin() { return { version }; } }, pino.multistream(streams));
  let autoSaver = setInterval(() => storage.save(), 5 * 60 * 1000);
  ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection'].forEach((eventName) => {
    process.on(eventName, async (err) => {
      clearInterval(autoSaver);
      state.logger.error(err);
      state.logger.info('Exiting!');
      let logs = '';
      try {
        logs = await fs.promises.readFile('logs.txt', 'utf8');
        logs = logs.split('\n').slice(-20).join('\n');
      } catch (readErr) {
        // ignore read errors
      }
      const content = `Bot crashed: \n\n\u0060\u0060\u0060\n${err?.stack || err}\n\u0060\u0060\u0060` +
        (logs ? `\nRecent logs:\n\u0060\u0060\u0060\n${logs}\n\u0060\u0060\u0060` : '');
      let sent = false;
      try {
        const ctrl = await utils.discord.getControlChannel();
        if (ctrl) {
          if (content.length > 2000) {
            await ctrl.send({
              content: `${content.slice(0, 1997)}...`,
              files: [{ attachment: Buffer.from(content, 'utf8'), name: 'crash.txt' }],
            });
          } else {
            await ctrl.send(content);
          }
          sent = true;
        }
      } catch (e) {
        state.logger.error('Failed to send crash info to Discord');
        state.logger.error(e);
      }
      if (!sent) {
        try {
          await fs.promises.writeFile('crash-report.txt', content, 'utf8');
        } catch (e) {
          state.logger.error('Failed to write crash report to disk');
          state.logger.error(e);
        }
      }
      try {
        await storage.save();
      } catch (e) {
        state.logger.error('Failed to save storage');
        state.logger.error(e);
      }
      process.exit(['SIGINT', 'SIGTERM'].includes(eventName) ? 0 : 1);
    });
  });

  state.logger.info('Starting');

  const conversion = await utils.sqliteToJson.convert();
  if (!conversion) {
    state.logger.error('Conversion failed!');
    process.exit(1);
  }
  state.logger.info('Conversion completed.');

  state.settings = await storage.parseSettings();
  state.logger.info('Loaded settings.');

  utils.ensureDownloadServer();

  clearInterval(autoSaver);
  autoSaver = setInterval(() => storage.save(), state.settings.autoSaveInterval * 1000);
  state.logger.info('Changed auto save interval.');

  state.contacts = await storage.parseContacts();
  state.logger.info('Loaded contacts.');

  state.chats = await storage.parseChats();
  state.logger.info('Loaded chats.');

  state.startTime = await storage.parseStartTime();
  state.logger.info('Loaded last timestamp.');

  state.lastMessages = await storage.parseLastMessages();
  state.logger.info('Loaded last messages.');

  state.dcClient = await discordHandler.start();
  state.logger.info('Discord client started.');

  await utils.discord.repairChannels();
  await discordHandler.setControlChannel();
  state.logger.info('Repaired channels.');

  // Send any queued crash report
  try {
    const crashFile = 'crash-report.txt';
    const queued = await fs.promises.readFile(crashFile, 'utf8');
    const ctrl = await utils.discord.getControlChannel();
    if (ctrl) {
      if (queued.length > 2000) {
        await ctrl.send({
          content: `${queued.slice(0, 1997)}...`,
          files: [{ attachment: Buffer.from(queued, 'utf8'), name: 'crash.txt' }],
        });
      } else {
        await ctrl.send(queued);
      }
      await fs.promises.unlink(crashFile);
      state.logger.info('Queued crash report sent.');
    }
  } catch (e) {
    if (e.code !== 'ENOENT') {
      state.logger.error('Failed to send queued crash report');
      state.logger.error(e);
    }
  }

  await whatsappHandler.start();
  state.logger.info('WhatsApp client started.');

  await utils.updater.run(version, { prompt: false });
  state.logger.info('Update checked.');

  if (state.updateInfo) {
    const ctrl = await utils.discord.getControlChannel();
    await ctrl?.send(
      `A new version is available ${state.updateInfo.currVer} -> ${state.updateInfo.version}.\n` +
      `See ${state.updateInfo.url}\n` +
      `Changelog: ${state.updateInfo.changes}\nType \`update\` to apply or \`skipUpdate\` to ignore.`
    );
  }

  setInterval(async () => {
    await utils.updater.run(version, { prompt: false });
    if (state.updateInfo) {
      const ch = await utils.discord.getControlChannel();
      await ch?.send(
        `A new version is available ${state.updateInfo.currVer} -> ${state.updateInfo.version}.\n` +
        `See ${state.updateInfo.url}\n` +
        `Changelog: ${state.updateInfo.changes}\nType \`update\` to apply or \`skipUpdate\` to ignore.`
      );
    }
  }, 2 * 24 * 60 * 60 * 1000);

  state.logger.info('Bot is now running. Press CTRL-C to exit.');
})();
