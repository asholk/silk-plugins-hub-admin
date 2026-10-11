# Silk Hub Admin

Obsidian plugin for administrators of a [Silk Hub server](https://github.com/asholk/silk-plugins-hub-server). It replaces the web admin panel: everything is managed from a tab in Obsidian over the Hub's admin API.

## What you can do

- **Companies**: create a company with a code that users enter in Silk Hub, change its name, code and email domains for automatic membership, choose available and required plugins, add or remove users by email.
- **Users**: see who signed in and on how many devices, choose the companies of each user, end their sessions or delete them.
- **Plugins**: add a plugin, edit its description and instructions, issue a publish token for CI, set access per company, preview the card and guide, upload a release by hand, see its files, revoke, restore or delete releases.
- **Administrators**: add and remove administrators, change your password.

## Requirements

> [!important] An account is required
> The plugin works only with a [Silk Hub server](https://github.com/asholk/silk-plugins-hub-server) and an administrator account on it. Administrator accounts are created on the server: `npm run admin -- <login>`.

- Obsidian 1.13.0 or later.

## Install

Install the plugin with [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install and turn on **BRAT** from **Settings → Community plugins**.
2. Open the command palette and run **BRAT: Add a beta plugin for testing**.
3. Enter `asholk/silk-plugins-hub-admin` and select **Add plugin**.
4. Turn on **Silk Hub Admin** in **Settings → Community plugins**.

## Get started

1. Open **Settings → Silk Hub Admin**.
2. Enter the server address, then your administrator login and password, and select **Sign in**.
3. Open the panel with the shield icon in the ribbon or with the **Open admin panel** command.

## Security

- The session token is stored in Obsidian's secret storage, not in the plugin data. It lasts 7 days; **Sign out** ends it on every device.
- After 5 wrong passwords from one address, sign-in is locked for 15 minutes.
- The server can limit the admin API to a list of addresses with `ADMIN_ALLOWED_IPS`.
- A publish token is shown once. The server keeps only its hash.

## Network use

The plugin connects to the internet. It only talks to the Hub server address you enter, and loads card images by signed links from the Hub's file storage. It has no telemetry.

## For developers

```bash
npm install
npm run dev       # rebuilds main.js on changes
npm run build     # type check and production build
npm run lint      # Obsidian's community plugin rules
```

To release, run `npm version patch` (or `minor`, `major`) and push the tag: the **Release** workflow publishes `main.js`, `manifest.json` and `styles.css`.

## License

[MIT](LICENSE)
