# WhatsApp To Discord

WhatsAppToDiscord is a Discord bot that uses WhatsApp Web as a bridge between Discord and WhatsApp. It is built on top of [discord.js](https://github.com/discordjs/discord.js) and [Baileys](https://github.com/WhiskeySockets/Baileys) libraries.

Originally created by [Fatih Kilic](https://github.com/FKLC), the project is now maintained by [arespawn](https://github.com/arespawn) with the blessing of the previous author.

## Requirements

- Node.js 18 or higher

## Features

- Supports media (Image, Video, Audio, Document, Stickers) and reactions!
- Allows whitelisting, so you can choose what to see on Discord
- Translates mentions between WhatsApp and Discord
- Allows usage of WhatsApp through the Discord overlay
- Syncs message edits between WhatsApp and Discord
- Uses minimal resources because it doesn't simulate a browser
- Open Source, you can see, modify and run your own version of the bot!
- Self Hosted, so your data never leaves your computer
- Automatically restarts itself if it crashes
- Restarts automatically after applying updates and checks for new versions every couple of days

**Note:** Due to limitations of the WhatsApp Web protocol, the bot can only notify you of incoming or missed calls. It cannot forward the audio or video streams of a WhatsApp call to Discord.

## Running

Run the bot with `npm start` or use the executable downloaded from the releases
page. Both methods use a small helper script that watches the process and
restarts it automatically if it exits unexpectedly. Directly running `node
src/index.js` skips this helper and the bot won't restart on crashes.

Runtime logs are written to `logs.txt`. Everything printed to the terminal is
also saved to `terminal.log`, which can help diagnose issues when running on a
headless server.

Alternatively, you can run the bot using Docker. Copy `.env.example` to `.env`,
put your Discord bot token in it and execute:

```bash
docker compose up -d
```

The compose file mounts the `storage` directory so data is kept between
container restarts.

### Automatic updates

A pre-built Docker image is published to the GitHub Container Registry on every push to `main`.
The included compose file uses this image and adds a [Watchtower](https://github.com/containrrr/watchtower)
service that checks for new versions every few minutes and restarts the bot
when an update is available.

---

For setup and commands, check out the [documentation](https://arespawn.github.io/WhatsAppToDiscord/)!
