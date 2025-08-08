const baileys = require('@whiskeysockets/baileys');
const { DisconnectReason } = baileys;

const utils = require('./utils.js');
const state = require("./state.js");


let authState;
let saveState;

const connectToWhatsApp = async (retry = 1) => {
    const controlChannel = await utils.discord.getControlChannel();
    const { version } = await baileys.fetchLatestBaileysVersion();

    const client = baileys.default({
        version,
        printQRInTerminal: false,
        auth: authState,
        logger: state.logger,
        markOnlineOnConnect: false,
        shouldSyncHistoryMessage: () => true,
        generateHighQualityLinkPreview: false,
        browser: ["Firefox (Linux)", "", ""]
    });
    client.contacts = state.contacts;

    client.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            utils.whatsapp.sendQR(qr);
        }
        if (connection === 'close') {
            state.logger.error(lastDisconnect.error);
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode === DisconnectReason.loggedOut || statusCode === DisconnectReason.badSession) {
                await controlChannel.send('WhatsApp session invalid. Please rescan the QR code.');
                await utils.whatsapp.deleteSession();
                await actions.start(true);
                return;
            }
            if (retry <= 3) {
                await controlChannel.send(`WhatsApp connection failed! Trying to reconnect! Retry #${retry}`);
                await connectToWhatsApp(retry + 1);
            } else if (retry <= 5) {
                const delay = (retry - 3) * 10;
                await controlChannel.send(`WhatsApp connection failed! Waiting ${delay} seconds before trying to reconnect! Retry #${retry}.`);
                await new Promise((resolve) => { setTimeout(resolve, delay * 1000); });
                await connectToWhatsApp(retry + 1);
            } else {
                await controlChannel.send('Connection failed 5 times. Please rescan the QR code.');
                await utils.whatsapp.deleteSession();
                await actions.start(true);
            }
        } else if (connection === 'open') {
            state.waClient = client;
            // eslint-disable-next-line no-param-reassign
            retry = 1;
            await controlChannel.send('WhatsApp connection successfully opened!');

            try {
                const groups = await client.groupFetchAllParticipating();
                for (const [jid, data] of Object.entries(groups)) {
                    state.contacts[jid] = data.subject;
                    client.contacts[jid] = data.subject;
                }
            } catch (err) {
                state.logger?.error(err);
            }
        }
    });
    client.ev.on('creds.update', saveState);
    ['chats.set', 'contacts.set', 'chats.upsert', 'chats.update', 'contacts.upsert', 'contacts.update', 'groups.upsert', 'groups.update'].forEach((eventName) => client.ev.on(eventName, utils.whatsapp.updateContacts));

    client.ev.on('messages.upsert', async (update) => {
        if (['notify', 'append'].includes(update.type)) {
            for await (const rawMessage of update.messages) {
                const messageId = utils.whatsapp.getId(rawMessage);
                if (state.sentMessages.has(messageId)) {
                    state.sentMessages.delete(messageId);
                    continue;
                }
                const messageType = utils.whatsapp.getMessageType(rawMessage);
                if (!utils.whatsapp.inWhitelist(rawMessage) || !utils.whatsapp.sentAfterStart(rawMessage) || !messageType) continue;

                const [nMsgType, message] = utils.whatsapp.getMessage(rawMessage, messageType);
                state.dcClient.emit('whatsappMessage', {
                    id: utils.whatsapp.getId(rawMessage),
                    name: utils.whatsapp.getSenderName(rawMessage),
                    content: utils.whatsapp.getContent(message, nMsgType, messageType),
                    quote: await utils.whatsapp.getQuote(rawMessage),
                    file: await utils.whatsapp.getFile(rawMessage, messageType),
                    profilePic: await utils.whatsapp.getProfilePic(rawMessage),
                    channelJid: utils.whatsapp.getChannelJid(rawMessage),
                    isGroup: utils.whatsapp.isGroup(rawMessage),
                    isForwarded: utils.whatsapp.isForwarded(message),
                    isEdit: messageType === 'editedMessage'
                });
                const ts = utils.whatsapp.getTimestamp(rawMessage);
                if (ts > state.startTime) state.startTime = ts;
            }
        }
    });

    client.ev.on('messages.reaction', async (reactions) => {
        for await (const rawReaction of reactions) {
            if (!utils.whatsapp.inWhitelist(rawReaction) || !utils.whatsapp.sentAfterStart(rawReaction))
                return;

            state.dcClient.emit('whatsappReaction', {
                id: utils.whatsapp.getId(rawReaction),
                jid: utils.whatsapp.getChannelJid(rawReaction),
                text: rawReaction.reaction.text,
            });
            const ts = utils.whatsapp.getTimestamp(rawReaction);
            if (ts > state.startTime) state.startTime = ts;
        }
    });

    client.ev.on('messages.delete', async (updates) => {
        const keys = 'keys' in updates ? updates.keys : updates;
        for (const key of keys) {
            if (!utils.whatsapp.inWhitelist({ chatId: key.remoteJid })) continue;
            state.dcClient.emit('whatsappDelete', {
                id: key.id,
                jid: utils.whatsapp.formatJid(key.remoteJid),
            });
        }
    });

    client.ev.on('messages.update', async (updates) => {
        for (const { update, key } of updates) {
            const protocol = update.message?.protocolMessage;
            if (protocol?.type !== baileys.proto.Message.ProtocolMessage.Type.REVOKE) continue;
            const msgKey = protocol.key || key;
            if (!utils.whatsapp.inWhitelist({ chatId: msgKey.remoteJid })) continue;
            state.dcClient.emit('whatsappDelete', {
                id: msgKey.id,
                jid: utils.whatsapp.formatJid(msgKey.remoteJid),
            });
        }
    });

    client.ev.on('call', async (calls) => {
        for await (const call of calls) {
            if (!utils.whatsapp.inWhitelist(call) || !utils.whatsapp.sentAfterStart(call))
                return;

            state.dcClient.emit('whatsappCall', {
                jid: utils.whatsapp.getChannelJid(call),
                call,
            });
            const ts = utils.whatsapp.getTimestamp(call);
            if (ts > state.startTime) state.startTime = ts;
        }
    });

    client.ev.on('contacts.update', async (contacts) => {
        for await (const contact of contacts) {
            if (typeof contact.imgUrl === 'undefined') continue;
            if (!utils.whatsapp.inWhitelist({ chatId: contact.id })) continue;

            utils.whatsapp._profilePicsCache[contact.id] = await client.profilePictureUrl(contact.id, 'preview').catch(() => null);

            if (!state.settings.ChangeNotifications) continue;
            const removed = utils.whatsapp._profilePicsCache[contact.id] === null;
            state.dcClient.emit('whatsappMessage', {
                id: null,
                name: "WA2DC",
                content: "[BOT] " + (removed ? "User removed their profile picture!" : "User changed their profile picture!"),
                profilePic: utils.whatsapp._profilePicsCache[contact.id],
                channelJid: utils.whatsapp.getChannelJid({ chatId: contact.id }),
                isGroup: contact.id.endsWith('@g.us'),
                isForwarded: false,
                file: removed ? null : await client.profilePictureUrl(contact.id, 'image').catch(() => null),
            });
        }
    });

    client.ws.on(`CB:notification,type:status,set`, async (update) => {
        if (!utils.whatsapp.inWhitelist({ chatId: update.attrs.from })) return;

        if (!state.settings.ChangeNotifications) return;
        const status = update.content[0]?.content?.toString();
        if (!status) return;
        state.dcClient.emit('whatsappMessage', {
            id: null,
            name: "WA2DC",
            content: "[BOT] User changed their status to: " + status,
            profilePic: utils.whatsapp._profilePicsCache[update.attrs.from],
            channelJid: utils.whatsapp.getChannelJid({ chatId: update.attrs.from }),
            isGroup: update.attrs.from.endsWith('@g.us'),
            isForwarded: false,
        });
    });

    client.ev.on('discordMessage', async ({ jid, message }) => {
        if ((state.settings.oneWay >> 1 & 1) === 0) {
            return;
        }
        
        const options = {};

        if (message.reference) {
            options.quoted = await utils.whatsapp.createQuoteMessage(message);
            if (options.quoted == null) {
                message.channel.send("Couldn't find the message quoted. You can only reply to last ${state.settings.lastMessageStorage} messages. Sending the message without the quoted message.");
            }
        }

        let text = message.content;

        if (state.settings.DiscordPrefix) {
            const prefix = state.settings.DiscordPrefixText || message.member?.nickname || message.author.username;
            text = `*${prefix}*\n${text}`;
        }

        const mentionJids = utils.whatsapp.getMentionedJids(text);

        if (state.settings.UploadAttachments && message.attachments.size) {
            let first = true;
            for (const file of message.attachments.values()) {
                const doc = utils.whatsapp.createDocumentContent(file);
                if (first) {
                    if (text || mentionJids.length) doc.caption = text;
                    if (mentionJids.length) doc.mentions = mentionJids;
                    try {
                        const m = await client.sendMessage(jid, doc, options);
                        state.lastMessages[message.id] = m.key.id;
                        state.sentMessages.add(m.key.id);
                    } catch (err) {
                        state.logger?.error(err);
                    }
                    first = false;
                } else {
                    try {
                        const m = await client.sendMessage(jid, doc);
                        state.lastMessages[message.id] = m.key.id;
                        state.sentMessages.add(m.key.id);
                    } catch (err) {
                        state.logger?.error(err);
                    }
                }
            }
            return;
        }

        const content = {};
        content.text = state.settings.UploadAttachments
            ? text || ""
            : [text, ...Array.from(message.attachments.values()).map((file) => file.url)].join(' ');

        if (mentionJids.length) {
            content.mentions = mentionJids;
        }

        if (content.text === "") return;

        try {
            const sent = await client.sendMessage(jid, content, options);
            state.lastMessages[message.id] = sent.key.id;
            state.sentMessages.add(sent.key.id);
        } catch (err) {
            state.logger?.error(err);
        }
    });

    client.ev.on('discordEdit', async ({ jid, message }) => {
        if ((state.settings.oneWay >> 1 & 1) === 0) {
            return;
        }

        const key = {
            id: state.lastMessages[message.id],
            fromMe: message.webhookId == null || message.author.username === 'You',
            remoteJid: jid,
        };

        if (jid.endsWith('@g.us')) {
            key.participant = utils.whatsapp.toJid(message.author.username);
        }

        let text = message.content;
        if (state.settings.DiscordPrefix) {
            const prefix = state.settings.DiscordPrefixText || message.member?.nickname || message.author.username;
            text = `*${prefix}*\n${text}`;
        }
        const editMentions = utils.whatsapp.getMentionedJids(text);
        try {
            const editMsg = await client.sendMessage(
                jid,
                {
                    text,
                    edit: key,
                    ...(editMentions.length ? { mentions: editMentions } : {}),
                }
            );
            state.sentMessages.add(editMsg.key.id);
        } catch (err) {
            state.logger?.error(err);
            await message.channel.send("Couldn't edit the message on WhatsApp.");
        }
    });

    client.ev.on('discordReaction', async ({ jid, reaction, removed }) => {
        if ((state.settings.oneWay >> 1 & 1) === 0) {
            return;
        }

        const key = {
            id: state.lastMessages[reaction.message.id],
            fromMe: reaction.message.webhookId == null || reaction.message.author.username === 'You',
            remoteJid: jid,
        };

        if (jid.endsWith('@g.us')) {
            key.participant = utils.whatsapp.toJid(reaction.message.author.username);
        }

        try {
            const reactionMsg = await client.sendMessage(jid, {
                react: {
                    text: removed ? '' : reaction.emoji.name,
                    key,
                },
            });
            const messageId = reactionMsg.key.id;
            state.lastMessages[messageId] = true;
            state.sentMessages.add(messageId);
        } catch (err) {
            state.logger?.error(err);
        }
    });

    client.ev.on('discordDelete', async ({ jid, id }) => {
        if ((state.settings.oneWay >> 1 & 1) === 0) {
            return;
        }

        try {
            await client.sendMessage(jid, {
                delete: {
                    remoteJid: jid,
                    id,
                    fromMe: true,
                },
            });
        } catch (err) {
            state.logger?.error(err);
        }
    });

    return client;
};

const actions = {
    async start() {
        const baileyState = await baileys.useMultiFileAuthState('./storage/baileys');
        authState = baileyState.state;
        saveState = baileyState.saveCreds;
        state.waClient = await connectToWhatsApp();
    },
}

module.exports = actions;
