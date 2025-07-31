# WhatsApp To Discord

WhatsAppToDiscord is a Discord bot that uses WhatsApp Web as a bridge between Discord and WhatsApp. It is built on top of [discord.js](https://github.com/discordjs/discord.js) and [Baileys](https://github.com/WhiskeySockets/Baileys) libraries.

Originally created by [Fatih Kilic](https://github.com/FKLC), the project is now maintained by [arespawn](https://github.com/arespawn) with the blessing of the previous author.

### Requirements

- Node.js 18 or higher

### Features

- Supports media (Image, Video, Audio, Document, Stickers) and reactions!
- Allows whitelisting, so you can choose what to see on Discord
- Allows usage of WhatsApp through the Discord overlay
- It uses less memory as it doesn't simulate a browser
- Open Source, you can see, modify and run your own version of the bot!
- Self Hosted, so your data never leaves your computer
- Automatically restarts itself if it crashes
- Restarts automatically after applying updates and checks for new versions every couple of days

**Note:** Due to limitations of the WhatsApp Web protocol, the bot can only notify you of incoming or missed calls. It cannot forward the audio or video streams of a WhatsApp call to Discord.

### Running

Run the bot with `npm start` or use the executable downloaded from the releases
page. Both methods use a small helper script that watches the process and
restarts it automatically if it exits unexpectedly. Directly running
`node src/index.js` will skip this helper and the bot won't restart on crashes.

---

### For setup and commands, check out the [documentation](https://arespawn.github.io/WhatsAppToDiscord/)!
