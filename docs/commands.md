# Commands
You can use the following commands only in `#control-room` created by the bot. Note that all the commands are case-insensitive. So, `list`, `LIST`, and `lIsT` would evaluate the same way.

## pairWithCode
Pairing with your phone number
- Format: `pairWithCode <number with country code>`
- Examples:
    - `pairWithCode 18001231234`: This would give you a code for you to enter on your phone and pair the bot with your phone number.

## start
Starts a new conversation. It can be used with a name or a phone number. 
- Format: `start <number with country code or name>`
- Examples:
    - `start 11231231234`: This would start a conversation with +1 123 123 1234.
    - `start John Doe`: This would start a conversation with John Doe. It has to be in your contacts.

## list
Lists your contacts and groups. 
- Format: `list <optional chat name to search>`
- Examples:
    - `list`: This would list all of your contacts and groups.
    - `list John`: This would list all of your contacts and groups that contain "John" in their name.

## listWhitelist
Shows all the whitelisted conversations. If no channel is whitelisted, the whitelist is disabled, meaning every message will be sent to Discord.
- Format: `listWhitelist`

## addToWhitelist
Adds the given channel to the whitelist.
- Format: `addToWhitelist #<channel name>`
- Examples:
    - `addToWhitelist #john-doe`: This would add John Doe to the whitelist, allowing them to send you a message if you have whitelist enabled.

## removeFromWhitelist
Removes the given channel from the whitelist.
- Format: `removeFromWhitelist #<channel name>`
- Examples:
    - `removeFromWhitelist #john-doe`: This would remove John Doe from the whitelist, preventing them to send you a message if you have whitelist enabled.

## resync
Re-syncs your contacts and groups. Can optionally rename the Discord channels to match WhatsApp names.
- Format: `resync [rename]`

## enableWAUpload
When enabled (enabled by default), the files received from Discord will be uploaded to WhatsApp, instead of providing a link to the attachment. File uploads takes longer and consumes more data.
- Format: `enableWAUpload`

## disableWAUpload
When disabled (enabled by default), the files received from Discord will be sent as links to WhatsApp, instead of uploading them as a file. Providing links takes shorter and consumes less data.
- Format: `disableWAUpload`

## setDCPrefix
When set (your username by default), the prefix will be added in bold followed by a newline to messages sent to WhatsApp from Discord.
- Format: `setDCPrefix`

## enableDCPrefix
When enabled (disabled by default), your Discord username will be added in bold followed by a newline to messages sent to WhatsApp from Discord.
- Format: `enableDCPrefix`

## disableDCPrefix
When disabled (disabled by default), your Discord username won't be added in bold followed by a newline to messages sent to WhatsApp from Discord.
- Format: `disableDCPrefix`

## enableWAPrefix
When enabled (disabled by default), WhatsApp names will be added to messages sent to Discord from WhatsApp. (Note that the bot already sets the username to the message sender's name)
- Format: `enableWAPrefix`

## disableWAPrefix
When disabled (disabled by default), WhatsApp names won't be added to messages sent to Discord from WhatsApp. (Note that the bot already sets the username to the message sender's name)
- Format: `disableWAPrefix`

## enableDeletes
When enabled (enabled by default), deleting a message on one platform removes it from the other.
- Format: `enableDeletes`

## disableDeletes
When disabled, deleting a message on one platform will not affect the other, keeping the history.
- Format: `disableDeletes`

## enableReadReceipts
Enables read receipts so you are notified when WhatsApp users read your messages.
- Format: `enableReadReceipts`

## disableReadReceipts
Disables read receipts.
- Format: `disableReadReceipts`

Only one delivery style can be active at a time. Use the following commands to switch between DM, public reply, or reaction-based read receipts. Webhook-authored Discord messages always receive a ☑️ reaction whenever read receipts are enabled so they can be acknowledged without sending DMs.

## dmReadReceipts
Sends read receipts as direct messages to the original Discord author instead of in the channel.
- Format: `dmReadReceipts`

## publicReadReceipts
Posts a short reply in the channel when a WhatsApp message is read (auto-deletes after a few seconds).
- Format: `publicReadReceipts`

## reactionReadReceipts
Adds a ☑️ reaction to the original Discord message when the WhatsApp user reads it.
- Format: `reactionReadReceipts`

## enableLocalDownloads
When enabled, the bot downloads files larger than Discord's upload limit (default 8MB) to your download location. See `getDownloadDir` for your download location.
- Format: `enableLocalDownloads`

## disableLocalDownloads
When enabled, the bot notifies you about receiving a file larger than Discord's upload limit.
- Format: `disableLocalDownloads`

## getDownloadMessage
Prints out the download message. This message is printed when you receive a file larger than Discord's upload limit and it is downloaded.
- Format: `getDownloadMessage`
- Default: *"Downloaded a file larger than the upload limit, check it out at {url}"*

## setDownloadMessage
Prints out the download message. This message is printed when you receive a file larger than Discord's upload limit and it is downloaded. There are keywords that you can use, `{abs}`: Downloaded file's absolute path, `{resolvedDownloadDir}`: Download directory's resolved path, `{downloadDir}`: unedited download directory, `{fileName}`: Downloaded file's name, `{url}`: Downloaded file's URL.
- Format: `setDownloadMessage <your message here>`
- Examples:
    - `setDownloadMessage Received a file. The file name is {fileName}`
    - `setDownloadMessage Received a file. Download it from {url}`
    - `setDownloadMessage Received a file. Information: Absolute path: {abs}, Resolved download directory: {resolvedDownloadDir}, Download directory: {downloadDir}, Filename: {fileName}, URL: {url}`

## getDownloadDir
Prints out the download directory.
- Format: `getDownloadDir`
- Default: `./downloads`: This means the bot will save files to the downloads folder inside bot's folder.

## setDownloadDir
Sets the download directory.
- Format: `setDownloadDir <desired save path>`
- Examples:
    - `setDownloadDir C:\Users\<your username>\Downloads`: Downloads files to your usual Windows downloads folder
    - `setDownloadDir ./downloads`: Downloads files to Downloads folder in your bot's location.

## setDownloadLimit
Sets the maximum size for the download directory in gigabytes. Older files are removed when the limit is exceeded.
- Format: `setDownloadLimit <gigabytes>`
- Default: `0` (unlimited)

## setFileSizeLimit
Changes the file size limit used to decide when to download files locally instead of uploading to Discord. Useful for servers with Nitro.
- Format: `setFileSizeLimit <bytes>`
- Default: `8388608`

## enableLocalDownloadServer
Starts a small web server to serve locally downloaded files and makes `{url}` links accessible over HTTP.
- Format: `enableLocalDownloadServer`

## disableLocalDownloadServer
Stops the local download server.
- Format: `disableLocalDownloadServer`

## setLocalDownloadServerHost
Sets the hostname used in generated download URLs.
- Format: `setLocalDownloadServerHost <host>`
- Default: `localhost`

## setLocalDownloadServerPort
Sets the port for the download server.
- Format: `setLocalDownloadServerPort <port>`
- Default: `8080`

## enableHttpsDownloadServer
Serves downloads over HTTPS instead of HTTP. Requires certificate files to be configured.
- Format: `enableHttpsDownloadServer`

## disableHttpsDownloadServer
Disables HTTPS for the download server and serves files over HTTP.
- Format: `disableHttpsDownloadServer`

## setHttpsCert
Sets the paths for the TLS private key and certificate used by the HTTPS download server.
- Format: `setHttpsCert <key path> <cert path>`

## enablePublishing
Enables publishing messages sent to news channels automatically. By default, the bot won't notify news channel followers. With this option, you can send the message to the channel followers.
- Format: `enablePublishing`

## disablePublishing
Disables publishing messages sent to news channels automatically.
- Format: `disablePublishing`

## enableChangeNotifications
Enables profile picture change and status update notifications.
- Format: `enableChangeNotifications`

## disableChangeNotifications
Disables profile picture change and status update notifications.
- Format: `disableChangeNotifications`

## oneWay
Turns on one-way communication.
- Format: `oneWay <discord|whatsapp|disabled>`
- Examples:
    - `oneWay discord`: would only send messages coming from WhatsApp to Discord, but not the other way.

## autoSaveInterval
Changes the auto save interval to the number of seconds you provide.
- Format: `autoSaveInterval <seconds>`
- Example: `autoSaveInterval 60`

## lastMessageStorage
Changes the last message storage size to the number provided. This determines how many recent messages you can edit, delete, react to, or reply to. A value of 1000 would mean you can interact with the last 1000 messages received or sent.
- Format: `lastMessageStorage <size>`
- Example: `lastMessageStorage 1000`

## redirectWebhooks
Allows sending webhook messages to be redirected to WhatsApp.
- Format: `redirectWebhooks <yes|no>`
- Examples:
    - `redirectWebhooks yes`: Would redirect webhook messages to WhatsApp.
    - `redirectWebhooks no`: Would not redirect webhook messages to WhatsApp.

## ping
Replies back with *"Pong <Now - Time Message Sent>"ms*. It basically shows the bot's ping with the server. An unsynced date and time on your computer may cause big or even negative ping results, however, it doesn't mean you got negative ping or 10mins of lag, rather it is the Discord's time and your computer's time difference plus your ping.
- Format: `ping`

## update
Downloads and installs the latest version when the bot notifies you that a new release is available. The notification message also includes a link to the GitHub release so you can review the changes.
- Format: `update`

## checkUpdate
Manually checks if a new version is available and posts the result in the control channel.
- Format: `checkUpdate`

## skipUpdate
Clears the current update notification without installing anything.
- Format: `skipUpdate`
