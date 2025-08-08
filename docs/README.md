# WhatsApp To Discord

WhatsAppToDiscord is a Discord bot that uses WhatsApp Web as a bridge between Discord and WhatsApp. It is built on top of [discord.js](https://github.com/discordjs/discord.js) and [Baileys](https://github.com/WhiskeySockets/Baileys) libraries.

Originally created by [Fatih Kilic](https://github.com/FKLC), now maintained by [arespawn](https://github.com/arespawn).

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

Start the bot with `npm start` or run the executable from the releases page. The start script watches the process and brings it back up if it crashes. Running `node src/index.js` directly skips this behaviour, so crashes will stop the bot.

Runtime logs are written to `logs.txt`. Everything printed to the terminal is also saved to `terminal.log`, which can help diagnose issues when running on a headless server.

Alternatively, you can run the bot using Docker. Copy `.env.example` to `.env`, put your Discord bot token in it and execute:

```bash
docker compose up -d
```

The compose file mounts the `storage` directory so data is kept between container restarts.

## Setup

The setup is short, but challenging for some. So, we explained every step in detail for your convenience, just [click here](setup.md) to get started.

## Commands

The bot supports many commands to allow rich customization. You can see the commands by [clicking here.](commands.md)
