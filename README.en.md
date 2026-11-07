# Whale Notify Station · User guide

[简体中文](README.md) | **English**

Get notified when tasks finish, fail, or need your attention. On macOS / Linux, the status-bar whale also shows task progress, daily spend, and plan quota.

## Get started

1. Install and enable the plugin, then click **Whale Notify Station** (the whale icon) in DSH's **left sidebar**. The icon also works when the sidebar is collapsed.
2. Under notifications, choose which events should alert you and whether to play a sound.
3. On macOS / Linux, enable the status-bar whale. macOS also offers text, a count, or just the icon beside the whale.
4. Changes **save automatically**, about half a second after you stop editing. A **Settings saved** banner confirms success; there is no Save button.

Failed saves retain your changes and offer **Retry saving**. Correct invalid input before saving. Leaving this page does not discard queued changes.

The plugin detail page contains this user guide in Chinese by default, with a link to this English version. Notification, status-bar, spend, and plan settings all live in the sidebar page.

Existing settings and spend records are retained after an update. Restart DSH if the new entry is missing. If the sidebar has moved it into **More**, you can find and pin it there.

## Notifications

Five events are enabled by default: **completed, failed, approval needed, choice needed, and text input needed**. Clicking a notification sent by the DSH window opens its session.

- Notifications for the session you are currently viewing are suppressed by default. Turn off the focused-session suppression option under **Advanced** if you want them anyway.
- Each session keeps one notification. Answering a question or resolving an approval withdraws its attention notification, subject to platform support for the system channel.
- Tasks that finish within a few seconds of each other have their later completion notifications grouped.
- Manually stopping a task does not notify. Subagents do not notify separately.

The notification channel defaults to **Auto**: a DSH window with notification permission sends notifications; otherwise the host uses system notifications. Usually you can leave this unchanged.

## Status-bar whale

![Whale states](assets/preview.svg)

| Appearance | Meaning |
|---|---|
| Resting | Idle |
| Bubbles | Tasks running |
| `!` | Waiting for approval, a choice, or text |
| `×` | A recent failure; held for 10 minutes by default |

Click the whale to see running tasks, pending actions, recent results, daily usage, and plan quota. Clicking a task opens its session.

| Platform | Features provided by this plugin |
|---|---|
| macOS | System notifications, menu-bar whale, progress text, and optional spend beside it |
| Linux (UOS / Deepin / Kylin / KDE and others) | System notifications and a system-tray whale with state colors |
| Windows | System notifications; this plugin does not provide a Windows tray icon or tray settings |

If you hide the whale from its menu, use **Show the status-bar icon again** in the sidebar settings page. No restart is needed. GNOME generally needs an AppIndicator extension to display the tray icon.

## Spend and plans

The spend and plan section shows daily spend, the current model, and its API prices.

- **Spend:** Auto prefers DeepSeek account balance changes, using estimates while billing catches up. Other providers use token usage and unit prices. These figures are estimates; the provider's bill is authoritative.
- **Prices:** Your prices take priority, followed by DSH's model catalog, built-in prices, or the bundled models.dev snapshot. Custom prices and the exchange rate are under **Advanced**.
- **Plans:** Choosing a provider and plan fills preset values. Expand the plan details to edit the name, price, period, balance, and quota.
- **Automatic quota:** Enter the credential reference name saved in DSH's Models page, or an environment-variable name, under **API key reference**. Clicking **Refresh** saves pending settings before querying quota. Enter the reference name, not the secret itself. Providers without a quota endpoint allow manual values or blank fields.
- **Query failures:** The page shows the reason and credential sources tried. Check the reference name, permissions, and selected provider before refreshing.

Plan presets and price snapshots may lag behind provider changes and can be overridden. A subscription's price and API token spend are shown separately.

## Troubleshooting

**No notifications?**

Confirm that the event type is enabled and the **Settings saved** banner appeared. Check system notification permissions for DeepSeek Harness and Do Not Disturb. In a browser, allow site notifications. The session you are viewing is suppressed by default.

**Clicking a notification does not open its session?**

Keep the channel on **Auto** and the DSH window running. The macOS system fallback using `osascript` cannot target a session; installing [terminal-notifier](https://github.com/julienXX/terminal-notifier) enables targeting and withdrawal. Windows system fallback notifications are subject to foreground-window restrictions; minimized windows can be restored.

**Why are there no whale icon settings on Windows?**

This plugin implements only notifications on Windows. Status-bar features are for macOS / Linux. The DSH sidebar settings entry appears on all three platforms.

**Spend or quota looks wrong?**

Check the current model's price source, display currency, exchange rate, and any manual remaining quota overriding automatic results. Automatic queries require a supported provider endpoint and a key with suitable permissions.

**Where are records stored?**

The spend ledger is at `~/.dsh/storages/dsh-notify-tray/ledger.json` by default and retains 31 days. A configured `DSH_HOME` replaces that directory. DSH manages settings in the current profile.

## Install and update

In DSH, open **Plugins → Add plugin** and enter `dsh-notify-tray`. To select a published version, enter `dsh-notify-tray@version`; check [npm](https://www.npmjs.com/package/dsh-notify-tray) for available releases.

### Online updates

The **Updates** card at the bottom of the sidebar settings page:

- Checks when you open the page, or when you click **Check for updates**.
- Offers **Update now** for a compatible, non-deprecated stable release. Clicking saves settings first, then asks DSH's native plugin manager to update.
- Never installs automatically. DSH handles compatibility checks and recovery on failure. The page distinguishes completion, a required restart, restoration, and an unconfirmed outcome.
- Explains why local-directory and Git installations cannot use this update path. Once a release is published to npm, switch to an npm installation through plugin management to enable online updates.

DSH's native plugin management update controls remain available. Restart DSH when requested.

To develop or try unpublished code, install a local checkout:

```sh
dsh plugin --profile desktop add /absolute/path/to/dsh-notify-tray
```

Web users should replace `desktop` with `web`. Restart the corresponding DSH instance after installation.

Report problems on [GitHub Issues](https://github.com/ROYLeXJ/dsh-notify-tray/issues), including DSH and plugin versions, the operating system, and reproduction steps.
