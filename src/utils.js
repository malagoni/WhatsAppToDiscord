const { Webhook, MessageAttachment } = require('discord.js');
const { downloadMediaMessage, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const readline = require('readline');
const QRCode = require('qrcode');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const { pathToFileURL } = require('url');
const http = require('http');
const https = require('https');
const child_process = require('child_process');

const state = require('./state.js');

const downloadTokens = new Map();
function ensureDownloadServer() {
  if (!state.settings.LocalDownloadServer || ensureDownloadServer.server) return;

  const handler = (req, res) => {
    const [, token] = req.url.split('/');
    const filePath = downloadTokens.get(token);
    if (!filePath) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      res.writeHead(500);
      res.end('Error');
    });
    stream.on('close', () => downloadTokens.delete(token));
    stream.pipe(res);
  };

  const start = (serverFactory) => {
    try {
      ensureDownloadServer.server = serverFactory()
        .on('error', (err) => {
          state.logger?.error(err);
          ensureDownloadServer.server = null;
        });
    } catch (err) {
      state.logger?.error(err);
      ensureDownloadServer.server = null;
    }
  };

  if (
    state.settings.UseHttps &&
    state.settings.HttpsKeyPath &&
    state.settings.HttpsCertPath &&
    fs.existsSync(state.settings.HttpsKeyPath) &&
    fs.existsSync(state.settings.HttpsCertPath)
  ) {
    const options = {
      key: fs.readFileSync(state.settings.HttpsKeyPath),
      cert: fs.readFileSync(state.settings.HttpsCertPath),
    };
    start(() =>
      https
        .createServer(options, handler)
        .listen(
          state.settings.LocalDownloadServerPort,
          state.settings.LocalDownloadServerHost,
        )
    );
  } else {
    start(() =>
      http
        .createServer(handler)
        .listen(
          state.settings.LocalDownloadServerPort,
          state.settings.LocalDownloadServerHost,
        )
    );
  }
}

function stopDownloadServer() {
  if (ensureDownloadServer.server) {
    ensureDownloadServer.server.close();
    ensureDownloadServer.server = null;
    downloadTokens.clear();
  }
}


const updater = {
  isNode: process.argv0.replace('.exe', '').endsWith('node'),

  currentExeName: process.argv0.split(/[/\\]/).pop(),

  async renameOldVersion() {
    await fs.promises.rename(this.currentExeName, `${this.currentExeName}.oldVersion`);
  },

  cleanOldVersion() {
    fs.unlink(`${this.currentExeName}.oldVersion`, () => 0);
  },

  revertChanges() {
    fs.unlink(this.currentExeName, () => {
      fs.rename(`${this.currentExeName}.oldVersion`, this.currentExeName, () => 0);
    });
  },

  async fetchLatestVersion() {
    const response = await requests.fetchJson('https://api.github.com/repos/arespawn/WhatsAppToDiscord/releases/latest');
    if ('error' in response) {
      state.logger.error(response.error);
      return null;
    }
    if ('tag_name' in response.result && 'body' in response.result) {
      return {
        version: response.result.tag_name,
        changes: response.result.body,
        url: response.result.html_url,
      };
    }
    state.logger.error("Tag name wasn't in result");
    return null;
  },

  get defaultExeName() {
    let name = 'WA2DC';
    switch (os.platform()) {
      case 'linux':
        name += '-Linux';
        break;
      case 'darwin':
        name += '-macOS';
        break;
      case 'win32':
        break;
      default:
        return '';
    }

    switch (process.arch) {
      case 'arm64':
        name += '-arm64'
        break;
      case 'x64':
        break;
      default:
        return '';
    }

    if (os.platform() === 'win32') {
      name += '.exe';
    }

    return name;
  },

  async downloadLatestVersion(defaultExeName, name) {
    return requests.downloadFile(name, `https://github.com/arespawn/WhatsAppToDiscord/releases/latest/download/${defaultExeName}`);
  },

  async downloadSignature(defaultExeName) {
    const signature = await requests.fetchBuffer(`https://github.com/arespawn/WhatsAppToDiscord/releases/latest/download/${defaultExeName}.sig`);
    if ('error' in signature) {
      state.logger?.error("Couldn't fetch the signature of the update.");
      return false;
    }
    return signature;
  },

  async validateSignature(signature, name) {
    return crypto.verify(
      'RSA-SHA256',
      fs.readFileSync(name),
      this.publicKey,
      signature,
    );
  },

  async update() {
    const currExeName = this.currentExeName;
    const defaultExeName = this.defaultExeName;
    if (!defaultExeName) {
      state.logger?.info(`Auto-update is not supported on this platform: ${os.platform()}`);
      return false;
    }

    await this.renameOldVersion();
    const downloadStatus = await this.downloadLatestVersion(defaultExeName, currExeName);
    if (!downloadStatus) {
      state.logger?.error('Download failed! Skipping update.');
      return false;
    }

    const signature = await this.downloadSignature(defaultExeName);
    if (signature && !this.validateSignature(signature.result, currExeName)) {
      state.logger?.error("Couldn't verify the signature of the updated binary, reverting back. Please update manually.");
      this.revertChanges();
      return false;
    }
    this.cleanOldVersion();
    return true;
  },

  async run(currVer, { prompt = process.stdin.isTTY } = {}) {
    if (
      process.argv.some((arg) => ['--skip-update', '-su'].includes(arg)) ||
      process.env.WA2DC_SKIP_UPDATE === '1'
    ) {
      state.logger?.info('Skipping update due to configuration.');
      return;
    }

    if (this.isNode) {
      state.logger?.info('Running script with node. Skipping auto-update.');
      return;
    }

    this.cleanOldVersion();
    const newVer = await this.fetchLatestVersion();
    if (newVer === null) {
      state.logger?.error('Something went wrong with auto-update.');
      return;
    }

    if (newVer.version === currVer) {
      return;
    }

    if (!prompt) {
      state.updateInfo = { currVer, ...newVer };
      return;
    }

    const answer = (await ui.input(`A new version is available ${currVer} -> ${newVer.version}. Changelog: ${newVer.changes}\nDo you want to update? (Y/N) `)).toLowerCase();
    if (answer !== 'y') {
      state.logger?.info('Skipping update.');
      return;
    }

    state.logger?.info('Please wait as the bot downloads the new version.');
    const exeName = await updater.update();
    if (exeName) {
      await ui.input(`Updated WA2DC. Hit enter to exit and run ${this.currentExeName}.`);
      process.exit();
    }
  },

  publicKey: '-----BEGIN PUBLIC KEY-----\n'
    + 'MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA9Vu9wa838q/QI6WDxroy\n'
    + 'HEGDaZelRrI1GUxxLAoBcU0RTIxqIWTI7DC04DIYbuukpEokBhHZTQMknY7mjONk\n'
    + 'M1GftYPdZGoKMOUL4F0K7jV4axS8dNze81IbS8hkG4UwQTn8z0bQQF6/v+qd/tbG\n'
    + 'ECH2OVpbU9jKBOSr3YviN8f1RNpJVmcgOPd5W8SFhN4ImVUtWtRXN6Nwv6EbYvKV\n'
    + 'nZAbREwYV7wvgZlJZka9onMtER0Ac1tYLK1Syf29Lp+zMWOAjMOHBzmT/MhePmtS\n'
    + 'TqZVOpMo2OQzO9LuHv3sh06L6qCSOCEqImnq1/hHnklnmn/HMVCXnF537Ejggtlt\n'
    + 'BVdXGz+qNh88p0NfGqRP2d4JZ+doGA4pxLE9cJp6/429d4osrAisGywF1Z1R1Tt7\n'
    + 'SAYeeFyn8glp1+9lcb5f+S2HglGafrnxIwyujH269FrZ8d2oYIhfspkZjtB5is99\n'
    + 'aR9HnXMbXuZw+uGJUsDQoDzxJN0tvvnJ5HcuK8NAxBfczY2q93mW2i1x+CHS+x+g\n'
    + 'T9+NOegwshfnYnHBkiz/cqEgMQNZnhacOnTi29zLxHRsREWi143ZPogZJ3uS8GX7\n'
    + 'PYgM2agSkkVbEkSwij2n56fRA1jo+l5833mtKU1HWGufptC3bErKvfH22JwE1q4q\n'
    + 'CDO3JpgAt8wj2RU7n2MOPMkCAwEAAQ==\n'
    + '-----END PUBLIC KEY-----',
};

const sqliteToJson = {
  get defaultExeName() {
    let name = 'stj_';
    let osPlatform = os.platform()

    switch (osPlatform) {
      case 'linux':
      case 'darwin':
      case 'freebsd':
        name += osPlatform + "_";
        break;
      case 'win32':
        name += 'windows_';
        break;
      default:
        return '';
    }

    switch (process.arch) {
      case 'arm':
      case 'arm64':
        name += process.arch;
        break;
      case 'x64':
        name += 'amd64';
        break;
      default:
        return '';
    }

    if (osPlatform === 'win32') {
      name += '.exe'
    }
    return name;
  },

  async downloadLatestVersion(defaultExeName) {
    return requests.downloadFile(defaultExeName, `https://github.com/arespawn/sqlite-to-json/releases/latest/download/${defaultExeName}`);
  },

  async downloadSignature(defaultExeName) {
    const signature = await requests.fetchBuffer(`https://github.com/arespawn/sqlite-to-json/releases/latest/download/${defaultExeName}.sig`);
    if ('error' in signature) {
      state.logger?.error("Couldn't fetch the signature of the update.");
      return false;
    }
    return signature;
  },

  _storageDir: './storage/',
  _dbPath: './storage.db',
  isConverted() {
    return fs.existsSync(this._storageDir) || !fs.existsSync(this._dbPath);
  },

  async downloadAndVerify() {
    const exeName = this.defaultExeName;
    if (exeName == '') {
      state.logger?.error(`Automatic conversion of database is not supported on this platform and arch ${os.platform()}/${process.arch}. Please convert database manually`);
      return false;
    }

    const downloadStatus = await this.downloadLatestVersion(exeName);
    if (!downloadStatus) {
      state.logger?.error('Download failed! Please convert database manually.');
      return false;
    }

    const signature = await this.downloadSignature(exeName);
    if (signature && !updater.validateSignature(signature.result, exeName)) {
      state.logger?.error("Couldn't verify the signature of the database converter. Please convert database manually");
      fs.unlinkSync(exeName);
      return false;
    }

    return exeName;
  },

  runStj(exeName) {
    fs.mkdirSync(this._storageDir);
    if (os.platform() !== 'win32') {
      exeName = './' + exeName;
    }
    const child = child_process.spawnSync(exeName, [this._dbPath, '"SELECT * FROM WA2DC"'], { shell: true });

    const rows = child.stdout.toString().trim().split('\n');
    for (let i = 0; i < rows.length; i++) {
      const row = JSON.parse(rows[i]);
      fs.writeFileSync(path.join(this._storageDir, row[0]), row[1])
    }
  },

  async convert() {
    if (this.isConverted()) {
      return true;
    }

    const stjName = await this.downloadAndVerify();
    if (!stjName) {
      return false;
    }

    this.runStj(stjName);
    fs.unlinkSync(stjName);

    return true;
  },
}

const discord = {
  channelIdToJid(channelId) {
    return Object.keys(state.chats).find((key) => state.chats[key].channelId === channelId);
  },
  partitionText(text) {
    return text.match(/(.|[\r\n]){1,2000}/g) || [];
  },
  async getGuild() {
    return state.dcClient.guilds.fetch(state.settings.GuildID).catch((err) => { state.logger?.error(err) });
  },
  async getChannel(channelID) {
    return (await this.getGuild()).channels.fetch(channelID).catch((err) => { state.logger?.error(err) });
  },
  async getCategory(nthChannel) {
    const nthCategory = Math.floor((nthChannel + 1) / 50);
    if (state.settings.Categories[nthCategory] == null) {
      state.settings.Categories.push((await (await this.getGuild()).channels.create(`whatsapp ${nthCategory + 1}`, {
        type: 'GUILD_CATEGORY',
      })).id);
    }
    return state.settings.Categories[nthCategory];
  },
  async createChannel(name) {
    return (await this.getGuild()).channels.create(name, {
      type: 'GUILD_TEXT',
      parent: await this.getCategory(Object.keys(state.chats).length + this._unfinishedGoccCalls),
    });
  },
  _unfinishedGoccCalls: 0,
  async getOrCreateChannel(jid) {
    if (state.goccRuns[jid]) { return state.goccRuns[jid]; }
    let resolve;
    state.goccRuns[jid] = new Promise((res) => {
      resolve = res;
    });
    if (state.chats[jid]) {
      const webhook = new Webhook(state.dcClient, state.chats[jid]);
      resolve(webhook);
      return webhook;
    }

    this._unfinishedGoccCalls++;
    const name = whatsapp.jidToName(jid);
    const channel = await this.createChannel(name).catch((err) => {
      if (err.code === 50035) {
        return this.createChannel('invalid-name');
      }
      throw err;
    });
    const webhook = await channel.createWebhook('WA2DC');
    state.chats[jid] = {
      id: webhook.id,
      type: webhook.type,
      token: webhook.token,
      channelId: webhook.channelId,
    };
    this._unfinishedGoccCalls--;
    resolve(webhook);
    return webhook;
  },
  async safeWebhookSend(webhook, args, jid) {
    try {
      return await webhook.send(args);
    } catch (err) {
      if (err.code === 10015 && err.message.includes('Unknown Webhook')) {
        delete state.goccRuns[jid];
        const channel = await this.getChannel(state.chats[jid].channelId);
        webhook = await channel.createWebhook('WA2DC');
        state.chats[jid] = {
          id: webhook.id,
          type: webhook.type,
          token: webhook.token,
          channelId: webhook.channelId,
        };
        return await webhook.send(args);
      }
      if (err.code === 40005 || err.httpStatus === 413) {
        const content = `WA2DC Attention: Received a file, but it's over Discord's upload limit. Check WhatsApp on your phone${state.settings.LocalDownloads ? '' : ' or enable local downloads.'}`;
        return await webhook.send({
          content,
          username: args.username,
          avatarURL: args.avatarURL,
        });
      }
      throw err;
    }
  },
  async safeWebhookEdit(webhook, messageId, args, jid) {
    try {
      return await webhook.editMessage(messageId, args);
    } catch (err) {
      if (err.code === 10015 && err.message.includes('Unknown Webhook')) {
        delete state.goccRuns[jid];
        const channel = await this.getChannel(state.chats[jid].channelId);
        webhook = await channel.createWebhook('WA2DC');
        state.chats[jid] = {
          id: webhook.id,
          type: webhook.type,
          token: webhook.token,
          channelId: webhook.channelId,
        };
        return await webhook.editMessage(messageId, args);
      }
      throw err;
    }
  },
  async safeWebhookDelete(webhook, messageId, jid) {
    try {
      return await webhook.deleteMessage(messageId);
    } catch (err) {
      if (err.code === 10015 && err.message.includes('Unknown Webhook')) {
        delete state.goccRuns[jid];
        const channel = await this.getChannel(state.chats[jid].channelId);
        webhook = await channel.createWebhook('WA2DC');
        state.chats[jid] = {
          id: webhook.id,
          type: webhook.type,
          token: webhook.token,
          channelId: webhook.channelId,
        };
        return await webhook.deleteMessage(messageId);
      }
      throw err;
    }
  },
  async repairChannels() {
    const guild = await this.getGuild();
    await guild.channels.fetch();

    if (state.settings.Categories == null) {
      state.settings.Categories = [state.settings.CategoryID];
    }
    const categoryExists = await guild.channels.fetch(state.settings.Categories?.[0]).catch(() => null);
    const controlExists = await guild.channels.fetch(state.settings.ControlChannelID).catch(() => null);

    if (!categoryExists) {
      state.settings.Categories[0] = (
        await guild.channels.create('whatsapp', {
          type: 'GUILD_CATEGORY',
        })
      ).id;
    }

    if (!controlExists) {
      state.settings.ControlChannelID = (await this.createChannel('control-room')).id;
    }

    await (await guild.channels.fetch(state.settings.ControlChannelID)).edit({
      position: 0,
      parent: state.settings.Categories[0],
    });
    for (const [jid, webhook] of Object.entries(state.chats)) {
      guild.channels.fetch(webhook.channelId).catch(() => {
        delete state.chats[jid];
      });
    }

    for await (const categoryId of state.settings.Categories) {
      const category = await guild.channels.fetch(categoryId).catch(() => null);
      if (category == null) { state.settings.Categories = state.settings.Categories.filter((id) => categoryId !== id); }
    }

    for (const [, channel] of guild.channels.cache) {
      if (channel.id !== state.settings.ControlChannelID && state.settings.Categories.includes(channel.parentId) && !this.channelIdToJid(channel.id)) {
        channel.edit({ parent: null });
      }
    }
  },
  async renameChannels() {
    const guild = await this.getGuild();

    for (const [jid, webhook] of Object.entries(state.chats)) {
      try {
        const channel = await guild.channels.fetch(webhook.channelId);
        await channel.edit({
          name: whatsapp.jidToName(jid),
        });
      } catch (err) {
        state.logger?.error(err);
      }
    }
  },
  async getControlChannel() {
    let channel = await this.getChannel(state.settings.ControlChannelID);
    if (!channel) {
      channel = await this.createChannel('control-room');
      state.settings.ControlChannelID = channel.id;
      await channel.edit({
        position: 0,
        parent: await this.getCategory(0),
      });
    }
    return channel;
  },
  async findAvailableName(dir, fileName) {
    let absPath;
    let parsedFName = path.parse(fileName);
    let counter = -1;
    do {
      absPath = path.resolve(dir, parsedFName.name + (counter === -1 ? "" : counter) + parsedFName.ext);
      counter++;
    } while (await fs.promises.stat(absPath).catch(() => false));
    return [absPath, parsedFName.name + (counter === -1 ? "" : counter) + parsedFName.ext];
  },
  async downloadLargeFile(file) {
    await fs.promises.mkdir(state.settings.DownloadDir, { recursive: true });
    const [absPath, fileName] = await this.findAvailableName(state.settings.DownloadDir, file.name);
    if (typeof file.attachment?.pipe === 'function') {
      await pipeline(file.attachment, fs.createWriteStream(absPath));
    } else if (file.downloadCtx) {
      const stream = await downloadContentFromMessage(
        file.downloadCtx.message[file.msgType],
        file.msgType.replace('Message', ''),
        { logger: state.logger, reuploadRequest: state.waClient.updateMediaMessage },
      );
      await pipeline(stream, fs.createWriteStream(absPath));
    } else {
      await fs.promises.writeFile(absPath, file.attachment);
    }
    ensureDownloadServer();
    let url;
    if (state.settings.LocalDownloadServer) {
      const token = crypto.randomBytes(16).toString('hex');
      downloadTokens.set(token, absPath);
      const protocol = state.settings.UseHttps ? 'https' : 'http';
      url = `${protocol}://${state.settings.LocalDownloadServerHost}:${state.settings.LocalDownloadServerPort}/${token}/${encodeURIComponent(fileName)}`;
    } else {
      url = pathToFileURL(absPath).href;
    }
    return this.formatDownloadMessage(
      absPath,
      path.resolve(state.settings.DownloadDir),
      fileName,
      url,
    );
  },
  formatDownloadMessage(absPath, resolvedDownloadDir, fileName, url) {
    return state.settings.LocalDownloadMessage
      .replaceAll("{abs}", absPath)
      .replaceAll("{resolvedDownloadDir}", resolvedDownloadDir)
      .replaceAll("{downloadDir}", state.settings.DownloadDir)
      .replaceAll("{fileName}", fileName)
      .replaceAll("{url}", url)
  }
};

const whatsapp = {
  jidToPhone(jid) {
    return jid.split(':')[0].split('@')[0];
  },
  formatJid(jid) {
    return `${this.jidToPhone(jid)}@${jid.split('@')[1]}`;
  },
  isMe(myJID, jid) {
    return jid.startsWith(this.jidToPhone(myJID)) && !jid.endsWith('@g.us');
  },
  jidToName(jid, pushName) {
    if (this.isMe(state.waClient.user.id, jid)) { return 'You'; }
    return state.waClient.contacts[this.formatJid(jid)] || pushName || this.jidToPhone(jid);
  },
  toJid(name) {
    // eslint-disable-next-line no-restricted-globals
    if (!isNaN(name)) { return `${name}@s.whatsapp.net`; }
    return Object.keys(state.waClient.contacts).find((key) => state.waClient.contacts[key].toLowerCase().trim() === name.toLowerCase().trim());
  },
  contacts() {
    return Object.values(state.waClient.contacts);
  },
  getMentionedJids(text) {
    const mentions = [];
    if (!text) return mentions;
    
    const lower = text.replace(/<@!?\d+>/g, '').toLowerCase();

    for (const [jid, name] of Object.entries(state.contacts)) {
      if (!name) continue;
      if (lower.includes(`@${name.toLowerCase()}`)) {
        mentions.push(jid);
      }
    }
    return mentions;
  },
  async sendQR(qrString) {
    await (await discord.getControlChannel())
      .send({ files: [new MessageAttachment(await QRCode.toBuffer(qrString), 'qrcode.png')] });
  },
  getChannelJid(rawMsg) {
    return this.formatJid(rawMsg?.key?.remoteJid || rawMsg.chatId);
  },
  getSenderJid(rawMsg, fromMe) {
    if (fromMe) { return this.formatJid(state.waClient.user.id); }
    return this.formatJid(rawMsg?.key?.participant || rawMsg?.key?.remoteJid || rawMsg?.chatId || rawMsg?.jid);
  },
  getSenderName(rawMsg) {
    return this.jidToName(this.getSenderJid(rawMsg, rawMsg.key.fromMe), rawMsg.pushName);
  },
  isGroup(rawMsg) {
    return rawMsg.key.participant != null;
  },
  isForwarded(msg) {
    return msg.contextInfo?.isForwarded;
  },
  isQuoted(msg) {
    return msg.contextInfo?.quotedMessage;
  },
  async getQuote(rawMsg) {
    const msgType = this.getMessageType(rawMsg);
    const [, msg] = this.getMessage(rawMsg, msgType);

    if (!this.isQuoted(msg)) return null;

    const qMsg = msg.contextInfo.quotedMessage;
    const qMsgType = this.getMessageType({ message: qMsg });

    const [nMsgType, message] = this.getMessage({ message: qMsg }, qMsgType);
    const content = this.getContent(message, nMsgType, qMsgType);
    const downloadCtx = {
      key: {
        remoteJid: rawMsg.key.remoteJid,
        id: msg.contextInfo.stanzaId,
        fromMe: rawMsg.key.fromMe,
        participant: msg.contextInfo.participant,
      },
      message: qMsg,
    };
    const file = await this.getFile(downloadCtx, qMsgType);

    return {
      name: this.jidToName(msg.contextInfo.participant || ''),
      content,
      file,
    };
  },
  getMessage(rawMsg, msgType) {
    if (msgType === 'documentWithCaptionMessage') {
      return ["documentMessage", rawMsg.message[msgType].message.documentMessage];
    }
    else if (msgType === 'viewOnceMessageV2') {
      const nMsgType = this.getMessageType(rawMsg.message[msgType]);
      return [nMsgType, rawMsg.message[msgType].message[nMsgType]];
    }
    else if (msgType === 'editedMessage') {
      const nMsgType = this.getMessageType({ message: rawMsg.message[msgType].message.protocolMessage.editedMessage });
      return [nMsgType, rawMsg.message[msgType].message.protocolMessage.editedMessage[nMsgType]];
    }
    return [msgType, rawMsg.message[msgType]];
  },
  getFilename(msg, msgType) {
    if (msgType === 'audioMessage') {
      return 'audio.ogg';
    }
    else if ('documentMessage' === msgType) {
      return msg.fileName;
    }
    const ext = msg.mimetype?.split('/')?.[1] || 'bin';
    return `${msgType}.${ext}`;
  },
  async getFile(rawMsg, msgType) {
    const [nMsgType, msg] = this.getMessage(rawMsg, msgType);
    if (msg.fileLength == null) return;
    const fileLength = typeof msg.fileLength === 'object'
      ? msg.fileLength.low ?? msg.fileLength.toNumber()
      : msg.fileLength;
    const largeFile = fileLength > state.settings.DiscordFileSizeLimit;
    if (largeFile && !state.settings.LocalDownloads) return -1;
    try {
      if (largeFile && state.settings.LocalDownloads) {
        return {
          name: this.getFilename(msg, nMsgType),
          downloadCtx: rawMsg,
          msgType: nMsgType,
          largeFile: true,
        };
      }
      return {
        name: this.getFilename(msg, nMsgType),
        // Download media as a stream to avoid buffering entire files in memory
        attachment: await downloadMediaMessage(rawMsg, 'stream', {}, {
          logger: state.logger,
          reuploadRequest: state.waClient.updateMediaMessage,
        }),
        largeFile,
      };
    } catch (err) {
      if (err?.message?.includes('Unrecognised filter type') || err?.message?.includes('Unrecognized filter type')) {
        // Jimp sometimes throws this error when a PNG file is corrupted or malformed.
        // Avoid spamming the log with a stack trace for such cases.
        state.logger?.warn('Skipped sending attachment due to an invalid PNG file');
      } else {
        state.logger?.error(err);
      }
      return null;
    }
  },
  inWhitelist(rawMsg) {
    return state.settings.Whitelist.length === 0 || state.settings.Whitelist.includes(rawMsg?.key?.remoteJid || rawMsg.chatId);
  },
  getTimestamp(rawMsg) {
    if (rawMsg?.messageTimestamp) return rawMsg.messageTimestamp;
    if (rawMsg?.reaction?.senderTimestampMs) return Math.round(rawMsg.reaction.senderTimestampMs / 1000);
    if (rawMsg?.date) return Math.round(rawMsg.date.getTime() / 1000);
    return 0;
  },
  sentAfterStart(rawMsg) {
    const ts = this.getTimestamp(rawMsg);
    const id = this.getId(rawMsg);
    return ts > state.startTime || id == null || !Object.prototype.hasOwnProperty.call(state.lastMessages, id);
  },
  getMessageType(rawMsg) {
    return ['conversation', 'extendedTextMessage', 'imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'documentWithCaptionMessage', 'viewOnceMessageV2', 'stickerMessage', 'editedMessage'].find((el) => Object.hasOwn(rawMsg.message || {}, el));
  },
  _profilePicsCache: {},
  async getProfilePic(rawMsg) {
    const jid = this.getSenderJid(rawMsg, rawMsg?.key?.fromMe);
    if (this._profilePicsCache[jid] === undefined) {
      this._profilePicsCache[jid] = await state.waClient.profilePictureUrl(jid, 'preview').catch(() => null);
    }
    return this._profilePicsCache[jid];
  },
  getId(rawMsg) {
    return rawMsg?.message?.editedMessage?.message?.protocolMessage?.key?.id
      || rawMsg?.key?.id
      || rawMsg?.id;
  },
  getContent(msg, nMsgType, msgType) {
    let content = '';
    if (msgType === 'viewOnceMessageV2') {
      content += 'View once message:\n';
    }
    switch (nMsgType) {
      case 'conversation':
        content += msg;
        break;
      case 'extendedTextMessage':
        content += msg.text;
        break;
      case 'imageMessage':
      case 'videoMessage':
      case 'audioMessage':
      case 'documentMessage':
      case 'documentWithCaptionMessage':
      case 'stickerMessage':
        content += msg.caption || '';
        break;
    }
    const mentions = msg.contextInfo?.mentionedJid || [];
    for (const jid of mentions) {
      const name = this.jidToName(jid);
      const regex = new RegExp(`@${this.jidToPhone(jid)}\\b`, 'g');
      content = content.replace(regex, `@${name}`);
    }
    return content;
  },
  updateContacts(rawContacts) {
    const contacts = rawContacts.chats || rawContacts.contacts || rawContacts;
    for (const contact of contacts) {
      const name = contact.name || contact.subject;
      if (name) {
        state.waClient.contacts[contact.id] = name;
        state.contacts[contact.id] = name;
      }
    }
  },
  createDocumentContent(attachment) {
    let contentType = attachment.contentType?.split('/')?.[0] || 'application';
    contentType = ['image', 'video', 'audio'].includes(contentType) ? contentType : 'document';
    const documentContent = {};
    if (contentType === 'document') {
      documentContent['mimetype'] = attachment.contentType?.split(';')?.[0] || 'application/octet-stream';
    }
    documentContent[contentType] = { url: attachment.url };
    if (contentType === 'document') {
      documentContent.fileName = attachment.name;
    }
    if (attachment.name.toLowerCase().endsWith('.ogg')) {
      documentContent['ptt'] = true;
    }
    return documentContent;
  },
  async createQuoteMessage(message) {
    const { channelId, messageId } = message.reference || {};
    if (!channelId || !messageId) return null;

    try {
      const channel = await message.client.channels.fetch(channelId);
      const refMessage = await channel.messages.fetch(messageId);

      if (state.lastMessages[refMessage.id] == null) return null;

      return {
        key: {
          remoteJid: refMessage.webhookId && refMessage.author.username !== 'You'
            ? this.toJid(refMessage.author.username)
            : state.waClient.user.id,
          id: state.lastMessages[refMessage.id],
        },
        message: { conversation: refMessage.content },
      };
    } catch (err) {
      state.logger?.error(err);
      return null;
    }
  },

  async deleteSession() {
    const dir = './storage/baileys';
    const files = await fs.promises.readdir(dir);
    for (let file of files) {
      fs.unlinkSync(path.join(dir, file));
    }
  }
};

const requests = {
  async fetchJson(url, options) {
    return fetch(url, options)
      .then((resp) => resp.json())
      .then((result) => ({ result }))
      .catch((error) => {
        state.logger?.error(error);
        return { error };
      });
  },

  async fetchText(url, options) {
    return fetch(url, options)
      .then((resp) => resp.text())
      .then((result) => ({ result }))
      .catch((error) => {
        state.logger?.error(error);
        return { error };
      });
  },

  async fetchBuffer(url, options) {
    return fetch(url, options)
      .then((resp) => resp.arrayBuffer())
      .then((buffer) => Buffer.from(buffer))
      .then((result) => ({ result }))
      .catch((error) => {
        state.logger?.error(error);
        return { error };
      });
  },

  async downloadFile(path, url, options) {
    const readable = await fetch(url, options).then((resp) => resp.body).catch((error) => {
      state.logger?.error(error);
      return null;
    });
    if (readable == null) return false;

    return pipeline(readable, fs.createWriteStream(path)).then(() => true).catch((error) => {
      state.logger?.error(error);
      return false;
    });
  },
};

const ui = {
  async input(query) {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question(query, (answer) => {
        resolve(answer);
        rl.close();
      });
    });
  },
};

module.exports = {
  updater,
  discord,
  whatsapp,
  sqliteToJson,
  ensureDownloadServer,
  stopDownloadServer,
};
