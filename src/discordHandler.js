const { Client, Intents } = require('discord.js');

const state = require('./state.js');
const utils = require('./utils.js');
const fs = require('fs');

const DEFAULT_AVATAR_URL = 'https://cdn.discordapp.com/embed/avatars/0.png';

const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
    Intents.FLAGS.MESSAGE_CONTENT,
  ],
});
let controlChannel;
const pendingAlbums = {};
const typingTimeouts = {};
const deliveredMessages = new Set();

const sendWhatsappMessage = async (message, mediaFiles = [], messageIds = []) => {
  let msgContent = '';
  const files = [];
  const webhook = await utils.discord.getOrCreateChannel(message.channelJid);
  const avatarURL = message.profilePic || DEFAULT_AVATAR_URL;
  const content = utils.discord.convertWhatsappFormatting(message.content);
  const quoteContent = message.quote ? utils.discord.convertWhatsappFormatting(message.quote.content) : null;
  const quoteKey = message.quote?.id;
  const replyId = quoteKey ? state.lastMessages[quoteKey] : null;
  const hasReplyTarget = Boolean(replyId);

  if (message.isGroup && state.settings.WAGroupPrefix) { msgContent += `[${message.name}] `; }

  if (message.isForwarded) {
    msgContent += `forwarded message:\n${(content || '').split('\n').join('\n> ')}`;
  }
  else if (message.quote) {
    if (!hasReplyTarget) {
      const lines = [];

      const qContentRaw = quoteContent ?? '';
      const qContent = qContentRaw ? qContentRaw.split('\n').join('\n> ') : '';
      if (message.quote.name || qContent) {
        let quoteLine = '> ';
        if (message.quote.name) {
          quoteLine += message.quote.name;
          quoteLine += qContent ? ': ' : ':';
        }
        if (qContent) {
          quoteLine += qContent;
        }
        lines.push(quoteLine.trimEnd());
      }

      let segment = lines.join('\n');
      if (content) {
        segment += (segment ? '\n' : '') + content;
      }
      msgContent += segment || content || '';

      if (message.quote.file) {
        if (message.quote.file.largeFile && state.settings.LocalDownloads) {
          msgContent += await utils.discord.downloadLargeFile(message.quote.file);
        } else if (message.quote.file === -1 && !state.settings.LocalDownloads) {
          msgContent += "WA2DC Attention: Received a file, but it's over Discord's upload limit. Check WhatsApp on your phone or enable local downloads.";
        } else {
          files.push(message.quote.file);
        }
      }
    } else {
      msgContent += content;
    }
  }
  else {
    msgContent += content;
  }

  for (const file of mediaFiles) {
    if (file.largeFile && state.settings.LocalDownloads) {
      // eslint-disable-next-line no-await-in-loop
      msgContent += await utils.discord.downloadLargeFile(file);
    }
    else if (file === -1 && !state.settings.LocalDownloads) {
      msgContent += "WA2DC Attention: Received a file, but it's over Discord's upload limit. Check WhatsApp on your phone or enable local downloads.";
    } else if (file !== -1) {
      files.push(file);
    }
  }

  if (message.isEdit) {
    const dcMessageId = state.lastMessages[message.id];
    if (dcMessageId) {
      try {
        await utils.discord.safeWebhookEdit(webhook, dcMessageId, { content: msgContent || null }, message.channelJid);
        return;
      } catch (err) {
        state.logger?.error(err);
      }
    }
    msgContent = `Edited message:\n${msgContent}`;
    const dcMessage = await utils.discord.safeWebhookSend(webhook, {
      content: msgContent,
      username: message.name,
      avatarURL,
    }, message.channelJid);
    if (message.id != null) {
      // bidirectional map automatically stores both directions
      state.lastMessages[dcMessage.id] = message.id;
    }
    return;
  }

  if (msgContent || files.length) {
    msgContent = utils.discord.partitionText(msgContent);
    while (msgContent.length > 1) {
      // eslint-disable-next-line no-await-in-loop
      await utils.discord.safeWebhookSend(webhook, {
        content: msgContent.shift(),
        username: message.name,
        avatarURL,
      }, message.channelJid);
    }

    const chunkArray = (arr, size) => {
      const chunks = [];
      for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
      }
      return chunks;
    };

    const fileChunks = chunkArray(files, 10);
    const idChunks = chunkArray(messageIds.length ? messageIds : [message.id], 10);

    if (!fileChunks.length) fileChunks.push([]);

    let lastDcMessage;
    for (let i = 0; i < fileChunks.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const sendArgs = {
        content: i === 0 ? (msgContent.shift() || null) : null,
        username: message.name,
        files: fileChunks[i],
        avatarURL,
      };
      if (i === 0 && replyId) {
        const baseAllowed = webhook._wa2dcAllowedMentions || state.dcClient?.options?.allowedMentions;
        const cloneArray = (value) => (Array.isArray(value) ? [...value] : value);
        const allowedMentions = baseAllowed
          ? {
            ...baseAllowed,
            parse: cloneArray(baseAllowed.parse),
            roles: cloneArray(baseAllowed.roles),
            users: cloneArray(baseAllowed.users),
          }
          : {};
        allowedMentions.repliedUser = false;
        sendArgs.allowedMentions = allowedMentions;
        sendArgs.reply = {
          messageReference: replyId,
          failIfNotExists: false,
        };
      }
      lastDcMessage = await utils.discord.safeWebhookSend(webhook, sendArgs, message.channelJid);

      if (i === 0 && lastDcMessage.channel.type === 'GUILD_NEWS' && state.settings.Publish) {
        // eslint-disable-next-line no-await-in-loop
        await lastDcMessage.crosspost();
      }

      if (message.id != null) {
        for (const waId of idChunks[i] || []) {
          // bidirectional map automatically stores both directions
          state.lastMessages[waId] = lastDcMessage.id;
        }
        if (i === 0) {
          // store mapping for Discord -> first WhatsApp id for edits
          state.lastMessages[lastDcMessage.id] = message.id;
        }
      }
    }
  }
};

const flushAlbum = async (key) => {
  const album = pendingAlbums[key];
  if (!album) return;
  clearTimeout(album.timer);
  delete pendingAlbums[key];
  await sendWhatsappMessage(album.message, album.files, album.ids);
};

const setControlChannel = async () => {
  controlChannel = await utils.discord.getControlChannel();
};

client.on('ready', async () => {
  await setControlChannel();
});

client.on('channelDelete', async (channel) => {
  if (channel.id === state.settings.ControlChannelID) {
    controlChannel = await utils.discord.getControlChannel();
  } else {
    const jid = utils.discord.channelIdToJid(channel.id);
    delete state.chats[jid];
    delete state.goccRuns[jid];
    state.settings.Categories = state.settings.Categories.filter((id) => channel.id !== id);
  }
});

client.on('typingStart', async (typing) => {
  if ((state.settings.oneWay >> 1 & 1) === 0) { return; }
  const { channel } = typing;
  const jid = utils.discord.channelIdToJid(channel.id);
  if (!jid) { return; }
  if (!state.waClient) { return; }
  try {
    await state.waClient.sendPresenceUpdate('composing', jid);
    clearTimeout(typingTimeouts[jid]);
    typingTimeouts[jid] = setTimeout(() => {
      state.waClient.sendPresenceUpdate('paused', jid).catch(() => {});
    }, 5000);
  } catch (err) {
    state.logger?.error(err);
  }
});

client.on('whatsappMessage', async (message) => {
  if ((state.settings.oneWay >> 0 & 1) === 0) {
    return;
  }

  const key = `${message.channelJid}:${message.name}`;

  if (message.file && !message.isEdit) {
    if (pendingAlbums[key]) {
      pendingAlbums[key].files.push(message.file);
      pendingAlbums[key].ids.push(message.id);
      clearTimeout(pendingAlbums[key].timer);
      pendingAlbums[key].timer = setTimeout(() => flushAlbum(key), 500);
      return;
    }
    pendingAlbums[key] = {
      message,
      files: [message.file],
      ids: [message.id],
      timer: setTimeout(() => flushAlbum(key), 500),
    };
    return;
  }

  if (pendingAlbums[key]) {
    await flushAlbum(key);
  }

  await sendWhatsappMessage(message, message.file ? [message.file] : []);
});

client.on('whatsappReaction', async (reaction) => {
  if ((state.settings.oneWay >> 0 & 1) === 0) {
    return;
  }

  const channelId = state.chats[reaction.jid]?.channelId;
  const messageId = state.lastMessages[reaction.id];
  if (channelId == null || messageId == null) { return; }

  const channel = await utils.discord.getChannel(channelId);
  const message = await channel.messages.fetch(messageId);
  const msgReactions = state.reactions[messageId] || (state.reactions[messageId] = {});
  const prev = msgReactions[reaction.author];
  if (prev) {
    await message.reactions.cache.get(prev)?.remove().catch(() => {});
    delete msgReactions[reaction.author];
  }
  if (reaction.text) {
    await message.react(reaction.text).catch(async err => {
      if (err.code === 10014) {
        await channel.send(`Unknown emoji reaction (${reaction.text}) received. Check WhatsApp app to see it.`);
      }
    });
    msgReactions[reaction.author] = reaction.text;
  }
  if (!Object.keys(msgReactions).length) {
    delete state.reactions[messageId];
  }
});

client.on('whatsappTyping', async ({ jid, isTyping }) => {
  if ((state.settings.oneWay >> 0 & 1) === 0) { return; }
  const channelId = state.chats[jid]?.channelId;
  if (!channelId || !isTyping) { return; }
  const channel = await utils.discord.getChannel(channelId);
  channel.sendTyping().catch(() => {});
});

client.on('whatsappRead', async ({ id, jid }) => {
  if ((state.settings.oneWay >> 0 & 1) === 0 || !state.settings.ReadReceipts) { return; }
  const channelId = state.chats[jid]?.channelId;
  const messageId = state.lastMessages[id];
  if (!channelId || !messageId || deliveredMessages.has(messageId)) { return; }
  deliveredMessages.add(messageId);
  const channel = await utils.discord.getChannel(channelId);
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) { return; }
  if (state.settings.ReadReceiptMode === 'dm') {
    const name = utils.whatsapp.jidToName(jid);
    message.author.send(`✅ Your message to ${name} was read`).catch(() => {});
  } else {
    const receipt = await channel.send({ content: '✅ Read', reply: { messageReference: messageId } }).catch(() => null);
    if (receipt) {
      setTimeout(() => receipt.delete().catch(() => {}), 5000);
    }
  }
});

client.on('whatsappDelete', async ({ id, jid }) => {
  if (!state.settings.DeleteMessages || (state.settings.oneWay >> 0 & 1) === 0) {
    return;
  }

  const messageId = state.lastMessages[id];
  if (state.chats[jid] == null || messageId == null) {
    return;
  }

  const webhook = await utils.discord.getOrCreateChannel(jid);
  try {
    await utils.discord.safeWebhookDelete(webhook, messageId, jid);
  } catch {
    try {
      await utils.discord.safeWebhookEdit(
        webhook,
        messageId,
        { content: 'Message Deleted' },
        jid,
      );
    } catch (err) {
      state.logger?.error(err);
    }
  }
  delete state.lastMessages[id];
  delete state.lastMessages[messageId];
});

client.on('whatsappCall', async ({ call, jid }) => {
  if ((state.settings.oneWay >> 0 & 1) === 0) {
    return;
  }
  
  const webhook = await utils.discord.getOrCreateChannel(jid);

  const name = utils.whatsapp.jidToName(jid);
  const callType = call.isVideo ? 'video' : 'voice';
  let content = '';

  switch (call.status) {
    case 'offer':
      content = `${name} is ${callType} calling you! Check your phone to respond.`
      break;
    case 'timeout':
      content = `Missed a ${callType} call from ${name}!`
      break;
  }

  if (content !== '') {
    const avatarURL = (await utils.whatsapp.getProfilePic(call)) || DEFAULT_AVATAR_URL;
    await webhook.send({
      content,
      username: name,
      avatarURL,
    });
  }
});

const commands = {
  async ping(message) {
    controlChannel.send(`Pong ${Date.now() - message.createdTimestamp}ms!`);
  },
  async pairwithcode(_message, params) {
    if (params.length !== 1) {
      await controlChannel.send('Please enter your number. Usage: `pairWithCode <number>`. Don\'t use "+" or any other special characters.');
      return;
    }

    const code = await state.waClient.requestPairingCode(params[0]);
    await controlChannel.send(`Your pairing code is: ${code}`);
  },
  async start(_message, params) {
    if (!params.length) {
      await controlChannel.send('Please enter a phone number or name. Usage: `start <number with country code or name>`.');
      return;
    }

    // eslint-disable-next-line no-restricted-globals
    const jid = utils.whatsapp.toJid(params.join(' '));
    if (!jid) {
      await controlChannel.send(`Couldn't find \`${params.join(' ')}\`.`);
      return;
    }
    await utils.discord.getOrCreateChannel(jid);

    if (state.settings.Whitelist.length) {
      state.settings.Whitelist.push(jid);
    }
  },
  async list(_message, params) {
    let contacts = utils.whatsapp.contacts();
    if (params) { contacts = contacts.filter((name) => name.toLowerCase().includes(params.join(' '))); }
    contacts = contacts.sort((a, b) => a.localeCompare(b)).join('\n');
    const message = utils.discord.partitionText(
      contacts.length
        ? `${contacts}\n\nNot the whole list? You can refresh your contacts by typing \`resync\``
        : 'No results were found.',
    );
    while (message.length !== 0) {
      // eslint-disable-next-line no-await-in-loop
      await controlChannel.send(message.shift());
    }
  },
  async addtowhitelist(message, params) {
    const channelID = /<#(\d*)>/.exec(message)?.[1];
    if (params.length !== 1 || !channelID) {
      await controlChannel.send('Please enter a valid channel name. Usage: `addToWhitelist #<target channel>`.');
      return;
    }

    const jid = utils.discord.channelIdToJid(channelID);
    if (!jid) {
      await controlChannel.send("Couldn't find a chat with the given channel.");
      return;
    }

    state.settings.Whitelist.push(jid);
    await controlChannel.send('Added to the whitelist!');
  },
  async removefromwhitelist(message, params) {
    const channelID = /<#(\d*)>/.exec(message)?.[1];
    if (params.length !== 1 || !channelID) {
      await controlChannel.send('Please enter a valid channel name. Usage: `removeFromWhitelist #<target channel>`.');
      return;
    }

    const jid = utils.discord.channelIdToJid(channelID);
    if (!jid) {
      await controlChannel.send("Couldn't find a chat with the given channel.");
      return;
    }

    state.settings.Whitelist = state.settings.Whitelist.filter((el) => el !== jid);
    await controlChannel.send('Removed from the whitelist!');
  },
  async listwhitelist() {
    await controlChannel.send(
      state.settings.Whitelist.length
        ? `\`\`\`${state.settings.Whitelist.map((jid) => utils.whatsapp.jidToName(jid)).join('\n')}\`\`\``
        : 'Whitelist is empty/inactive.',
    );
  },
  async setdcprefix(message, params) {
    if (params.length !== 0) {
      const prefix = message.content.split(' ').slice(1).join(' ');
      state.settings.DiscordPrefixText = prefix;
      await controlChannel.send(`Discord prefix is set to ${prefix}!`);
    } else {
      state.settings.DiscordPrefixText = null;
      await controlChannel.send('Discord prefix is set to your discord username!');
    }
  },
  async enabledcprefix() {
    state.settings.DiscordPrefix = true;
    await controlChannel.send('Discord username prefix enabled!');
  },
  async disabledcprefix() {
    state.settings.DiscordPrefix = false;
    await controlChannel.send('Discord username prefix disabled!');
  },
  async enablewaprefix() {
    state.settings.WAGroupPrefix = true;
    await controlChannel.send('WhatsApp name prefix enabled!');
  },
  async disablewaprefix() {
    state.settings.WAGroupPrefix = false;
    await controlChannel.send('WhatsApp name prefix disabled!');
  },
  async enablewaupload() {
    state.settings.UploadAttachments = true;
    await controlChannel.send('Enabled uploading files to WhatsApp!');
  },
  async disablewaupload() {
    state.settings.UploadAttachments = false;
    await controlChannel.send('Disabled uploading files to WhatsApp!');
  },
  async enabledeletes() {
    state.settings.DeleteMessages = true;
    await controlChannel.send('Enabled message delete syncing!');
  },
  async disabledeletes() {
    state.settings.DeleteMessages = false;
    await controlChannel.send('Disabled message delete syncing!');
  },
  async enablereadreceipts() {
    state.settings.ReadReceipts = true;
    await controlChannel.send('Enabled read receipts!');
  },
  async disablereadreceipts() {
    state.settings.ReadReceipts = false;
    await controlChannel.send('Disabled read receipts!');
  },
  async dmreadreceipts() {
    state.settings.ReadReceiptMode = 'dm';
    await controlChannel.send('Read receipts will be sent via DM.');
  },
  async publicreadreceipts() {
    state.settings.ReadReceiptMode = 'public';
    await controlChannel.send('Read receipts will be posted publicly.');
  },
  async help() {
    await controlChannel.send('See all the available commands at https://arespawn.github.io/WhatsAppToDiscord/#/commands');
  },
  async resync(_message, params) {
    await state.waClient.authState.keys.set({
      'app-state-sync-version': { critical_unblock_low: null },
    });
    await state.waClient.resyncAppState(['critical_unblock_low']);
    for (const [jid, attributes] of Object.entries(await state.waClient.groupFetchAllParticipating())) { state.waClient.contacts[jid] = attributes.subject; }
    if (params.includes('rename')) {
      try {
        await utils.discord.renameChannels();
      } catch (err) {
        state.logger?.error(err);
      }
    }
    await controlChannel.send('Re-synced!');
  },
  async enablelocaldownloads() {
    state.settings.LocalDownloads = true;
    await controlChannel.send('Enabled local downloads. You can now download files larger than Discord\'s upload limit.');
  },
  async disablelocaldownloads() {
    state.settings.LocalDownloads = false;
    await controlChannel.send('Disabled local downloads. You won\'t be able to download files larger than Discord\'s upload limit.');
  },
  async getdownloadmessage() {
    await controlChannel.send(`Download message format is set to "${state.settings.LocalDownloadMessage}"`);
  },
  async setdownloadmessage(message) {
    state.settings.LocalDownloadMessage = message.content.split(' ').slice(1).join(' ');
    await controlChannel.send(`Set download message format to "${state.settings.LocalDownloadMessage}"`);
  },
  async getdownloaddir() {
    await controlChannel.send(`Download path is set to "${state.settings.DownloadDir}"`);
  },
  async setdownloaddir(message) {
    state.settings.DownloadDir = message.content.split(' ').slice(1).join(' ');
    await controlChannel.send(`Set download path to "${state.settings.DownloadDir}"`);
  },
  async setdownloadlimit(_message, params) {
    const gb = parseFloat(params[0]);
    if (!Number.isNaN(gb) && gb >= 0) {
      state.settings.DownloadDirLimitGB = gb;
      await controlChannel.send(`Set download directory size limit to ${gb} GB.`);
    } else {
      await controlChannel.send('Please provide a valid size in gigabytes.');
    }
  },
  async setfilesizelimit(message) {
    const size = parseInt(message.content.split(' ')[1], 10);
    if (!Number.isNaN(size) && size > 0) {
      state.settings.DiscordFileSizeLimit = size;
      await controlChannel.send(`Set Discord file size limit to ${size} bytes.`);
    } else {
      await controlChannel.send('Please provide a valid size in bytes.');
    }
  },
  async enablelocaldownloadserver() {
    state.settings.LocalDownloadServer = true;
    utils.ensureDownloadServer();
    await controlChannel.send(`Enabled local download server on port ${state.settings.LocalDownloadServerPort}.`);
  },
  async disablelocaldownloadserver() {
    state.settings.LocalDownloadServer = false;
    utils.stopDownloadServer();
    await controlChannel.send('Disabled local download server.');
  },
  async setlocaldownloadserverport(_message, params) {
    const port = parseInt(params[0], 10);
    if (!Number.isNaN(port) && port > 0 && port <= 65535) {
      state.settings.LocalDownloadServerPort = port;
      utils.stopDownloadServer();
      utils.ensureDownloadServer();
      await controlChannel.send(`Set local download server port to ${port}.`);
    } else {
      await controlChannel.send('Please provide a valid port.');
    }
  },
  async setlocaldownloadserverhost(_message, params) {
    if (params[0]) {
      state.settings.LocalDownloadServerHost = params[0];
      utils.stopDownloadServer();
      utils.ensureDownloadServer();
      await controlChannel.send(`Set local download server host to ${params[0]}.`);
    } else {
      await controlChannel.send('Please provide a host name or IP.');
    }
  },
  async enablehttpsdownloadserver() {
    state.settings.UseHttps = true;
    utils.stopDownloadServer();
    utils.ensureDownloadServer();
    await controlChannel.send('Enabled HTTPS for local download server.');
  },
  async disablehttpsdownloadserver() {
    state.settings.UseHttps = false;
    utils.stopDownloadServer();
    utils.ensureDownloadServer();
    await controlChannel.send('Disabled HTTPS for local download server.');
  },
  async sethttpscert(_message, params) {
    if (params.length !== 2) {
      await controlChannel.send('Usage: `setHttpsCert <key> <cert>`');
      return;
    }
    [state.settings.HttpsKeyPath, state.settings.HttpsCertPath] = params;
    utils.stopDownloadServer();
    utils.ensureDownloadServer();
    await controlChannel.send(`Set HTTPS key path to ${params[0]} and cert path to ${params[1]}.`);
  },
  async enablepublishing() {
    state.settings.Publish = true;
    await controlChannel.send(`Enabled publishing messages sent to news channels.`);
  },
  async disablepublishing() {
    state.settings.Publish = false;
    await controlChannel.send(`Disabled publishing messages sent to news channels.`);
  },
  async enablechangenotifications() {
    state.settings.ChangeNotifications = true;
    await controlChannel.send(`Enabled profile picture change and status update notifications.`);
  },
  async disablechangenotifications() {
    state.settings.ChangeNotifications = false;
    await controlChannel.send(`Disabled profile picture change and status update notifications.`);
  },
  async autosaveinterval(_message, params) {
    if (params.length !== 1) {
      await controlChannel.send("Usage: autoSaveInterval <seconds>\nExample: autoSaveInterval 60");
      return;
    }
    state.settings.autoSaveInterval = +params[0];
    await controlChannel.send(`Changed auto save interval to ${params[0]}.`);
  },
  async lastmessagestorage(_message, params) {
    if (params.length !== 1) {
      await controlChannel.send("Usage: lastMessageStorage <size>\nExample: lastMessageStorage 1000");
      return;
    }
    state.settings.lastMessageStorage = +params[0];
    await controlChannel.send(`Changed last message storage size to ${params[0]}.`);
  },
  async oneway(_message, params) {
    if (params.length !== 1) {
      await controlChannel.send("Usage: oneWay <discord|whatsapp|disabled>\nExample: oneWay whatsapp");
      return;
    }
    
    if (params[0] === "disabled") {
      state.settings.oneWay = 0b11;
      await controlChannel.send(`Two way communication is enabled.`);
    } else if (params[0] === "whatsapp") {
      state.settings.oneWay = 0b10;
      await controlChannel.send(`Messages will be only sent to WhatsApp.`);
    } else if (params[0] === "discord") {
      state.settings.oneWay = 0b01;
      await controlChannel.send(`Messages will be only sent to Discord.`);
    } else {
      await controlChannel.send("Usage: oneWay <discord|whatsapp|disabled>\nExample: oneWay whatsapp");
    }
  },
  async redirectwebhooks(_message, params) {
    if (params.length !== 1) {
      await controlChannel.send("Usage: redirectWebhooks <yes|no>\nExample: redirectWebhooks yes");
      return;
    }

    state.settings.redirectWebhooks = params[0] === "yes";
    await controlChannel.send(`Redirecting webhooks is set to ${state.settings.redirectWebhooks}.`);
  },
  async update() {
    if (!state.updateInfo) {
      await controlChannel.send('No update available.');
      return;
    }
    await controlChannel.send('Updating...');
    const success = await utils.updater.update();
    if (success) {
      await controlChannel.send('Update downloaded. Restarting...');
      await fs.promises.writeFile('restart.flag', '');
      process.exit();
    } else {
      await controlChannel.send('Update failed. Check logs.');
    }
  },
  async checkupdate() {
    await utils.updater.run(state.version, { prompt: false });
    if (state.updateInfo) {
      await controlChannel.send(
        `A new version is available ${state.updateInfo.currVer} -> ${state.updateInfo.version}.\n` +
        `See ${state.updateInfo.url}\n` +
        `Changelog: ${state.updateInfo.changes}\nType \`update\` to apply or \`skipUpdate\` to ignore.`
      );
    } else {
      await controlChannel.send('No update available.');
    }
  },
  async skipupdate() {
    state.updateInfo = null;
    await controlChannel.send('Update skipped.');
  },
  async unknownCommand(message) {
    await controlChannel.send(`Unknown command: \`${message.content}\`\nType \`help\` to see available commands`);
  },
};

client.on('messageCreate', async (message) => {
  if (message.author === client.user || message.applicationId === client.user.id || (message.webhookId != null && !state.settings.redirectWebhooks)) {
    return;
  }

  if (message.channel === controlChannel) {
    const command = message.content.toLowerCase().split(' ');
    await (commands[command[0]] || commands.unknownCommand)(message, command.slice(1));
  } else {
    const jid = utils.discord.channelIdToJid(message.channel.id);
    if (jid == null) {
      return;
    }

    state.waClient.ev.emit('discordMessage', { jid, message });
  }
});

client.on('messageUpdate', async (_, message) => {
  if (message.webhookId != null) {
    return;
  }

  if (message.partial) {
    try {
      await message.fetch();
    } catch (err) {
      state.logger?.warn(err);
      return;
    }
  }

  if (message.editedTimestamp == null) {
    return;
  }

  const jid = utils.discord.channelIdToJid(message.channelId);
  if (jid == null) {
    return;
  }

  const messageId = state.lastMessages[message.id];
  if (messageId == null) {
    await message.channel.send(`Couldn't edit the message. You can only edit the last ${state.settings.lastMessageStorage} messages.`);
    return;
  }

  if (message.content.trim() === '') {
    await message.channel.send('Edited message has no text to send to WhatsApp.');
    return;
  }

  state.waClient.ev.emit('discordEdit', { jid, message });
});

client.on('messageDelete', async (message) => {
  if (!state.settings.DeleteMessages) {
    return;
  }

  const jid = utils.discord.channelIdToJid(message.channelId);
  if (jid == null) {
    return;
  }

  const waIds = [];
  for (const [waId, dcId] of Object.entries(state.lastMessages)) {
    if (dcId === message.id && waId !== message.id) {
      waIds.push(waId);
    }
  }

  if (message.webhookId != null && waIds.length === 0) {
    return;
  }

  if (message.author?.id === client.user.id) {
    return;
  }

  if (waIds.length === 0) {
    await message.channel.send(`Couldn't delete the message. You can only delete the last ${state.settings.lastMessageStorage} messages.`);
    return;
  }

  for (const waId of waIds) {
    state.waClient.ev.emit('discordDelete', { jid, id: waId });
    delete state.lastMessages[waId];
  }
  delete state.lastMessages[message.id];
});

client.on('messageReactionAdd', async (reaction, user) => {
  const jid = utils.discord.channelIdToJid(reaction.message.channel.id);
  if (jid == null) {
    return;
  }
  const messageId = state.lastMessages[reaction.message.id];
  if (messageId == null) {
    await reaction.message.channel.send(`Couldn't send the reaction. You can only react to last ${state.settings.lastMessageStorage} messages.`);
    return;
  }
  if (user.id === state.dcClient.user.id) {
    return;
  }
  const selfJid = state.waClient?.user?.id && utils.whatsapp.formatJid(state.waClient.user.id);
  if (selfJid && state.reactions[reaction.message.id]?.[selfJid]) {
    const prev = state.reactions[reaction.message.id][selfJid];
    await reaction.message.reactions.cache.get(prev)?.remove().catch(() => {});
    delete state.reactions[reaction.message.id][selfJid];
    if (!Object.keys(state.reactions[reaction.message.id]).length) {
      delete state.reactions[reaction.message.id];
    }
  }
  state.waClient.ev.emit('discordReaction', { jid, reaction, removed: false });
});

client.on('messageReactionRemove', async (reaction, user) => {
  const jid = utils.discord.channelIdToJid(reaction.message.channel.id);
  if (jid == null) {
    return;
  }
  const messageId = state.lastMessages[reaction.message.id];
  if (messageId == null) {
    await reaction.message.channel.send(`Couldn't remove the reaction. You can only react to last ${state.settings.lastMessageStorage} messages.`);
    return;
  }
  if (user.id === state.dcClient.user.id) {
    return;
  }
  const selfJid = state.waClient?.user?.id && utils.whatsapp.formatJid(state.waClient.user.id);
  if (selfJid && state.reactions[reaction.message.id]?.[selfJid]) {
    const prev = state.reactions[reaction.message.id][selfJid];
    await reaction.message.reactions.cache.get(prev)?.remove().catch(() => {});
    delete state.reactions[reaction.message.id][selfJid];
    if (!Object.keys(state.reactions[reaction.message.id]).length) {
      delete state.reactions[reaction.message.id];
    }
  }
  state.waClient.ev.emit('discordReaction', { jid, reaction, removed: true });
});

module.exports = {
  start: async () => {
    await client.login(state.settings.Token);
    return client;
  },
  setControlChannel,
};
