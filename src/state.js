module.exports = {
  settings: {
    Whitelist: [],
    DiscordPrefixText: null,
    DiscordPrefix: false,
    WAGroupPrefix: false,
    UploadAttachments: true,
    Token: '',
    GuildID: '',
    Categories: [],
    ControlChannelID: '',
    LocalDownloads: false,
    LocalDownloadMessage: 'Downloaded a file larger than the upload limit, check it out at {url}',
    DownloadDir: './downloads',
    DownloadDirLimitGB: 0,
    DiscordFileSizeLimit: 8 * 1024 * 1024,
    LocalDownloadServer: false,
    LocalDownloadServerHost: 'localhost',
    LocalDownloadServerPort: 8080,
    UseHttps: false,
    HttpsKeyPath: '',
    HttpsCertPath: '',
    Publish: false,
    ChangeNotifications: false,
    autoSaveInterval: 5 * 60,
    lastMessageStorage: 500,
    oneWay: 0b11,
    redirectWebhooks: false,
    DeleteMessages: true,
    ReadReceipts: true,
    ReadReceiptMode: 'public',
  },
  dcClient: null,
  waClient: null,
  chats: {},
  contacts: {},
  startTime: 0,
  logger: null,
  lastMessages: null,
  /**
   * Stores WhatsApp message IDs that originate from Discord so that
   * they are not echoed back to Discord when received from WhatsApp.
  */
  sentMessages: new Set(),
  /**
   * Tracks Discord reactions that mirror WhatsApp reactions so we can
   * update or remove them when WhatsApp users change their reaction.
   * Structure: { [discordMessageId]: { [waJid]: emoji } }
   */
  reactions: {},
  /**
   * Stores WhatsApp message IDs for reactions originating from Discord
   * to avoid echoing them back when WhatsApp sends confirmation events.
   */
  sentReactions: new Set(),
  goccRuns: {},
  updateInfo: null,
  version: '',
};
