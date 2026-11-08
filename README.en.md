# Whale Notify Station · User guide

[简体中文](README.md) | **English**

Get notified when tasks finish, fail, or need your attention. On macOS / Linux, the status-bar whale also shows task progress, daily spend, and plan quota.

This is **Donh's personal Goal-aware fork**, [donhac/dsh-notify-tray](https://github.com/donhac/dsh-notify-tray), version `0.1.8-donh.1`, based on [ROYLeXJ's upstream project](https://github.com/ROYLeXJ/dsh-notify-tray). It retains the package name `dsh-notify-tray` and replaces the same plugin rather than adding a second copy. The original author, MIT license, and existing original icon are retained. See the [fork maintenance notes](FORK.md) for branches, synchronization, and version pinning.

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

### Goal continuation notifications

- A turn belonging to an `active` Goal can lead to another automatic round. It does not trigger a completion notification or count as a completed task. An old Goal does not suppress independent questions.
- After a Goal is marked `complete` within its owning turn, that turn must finish normally before it produces one completion result, subject to the existing toggles and grouping rules. Duplicate end events do not notify or count again. External manual Goal changes do not replay completion notifications for historical turns.
- A `blocked` Goal needs your attention and uses the failed-notification toggle. Failure statistics and recent task results follow the same decision.
- Ordinary questions, execution failures, approvals, choices, and text input keep their existing behavior. Completion and failure counts follow the Goal rules above; token usage and spend still reflect actual consumption.

This fix adds no settings and keeps the existing sidebar and settings layout.

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

### Install the Donh fork

This fork does not need an npm release. Use a local checkout of [donhac/dsh-notify-tray](https://github.com/donhac/dsh-notify-tray), and set its absolute directory as the installation target in DSH's native PluginManager. For an Agent, this is the `plugin_manager` tool's `install_bundle` action with the directory as `target`. The CLI equivalent is:

```sh
dsh plugin --profile desktop add /absolute/path/to/dsh-notify-tray
```

Web users should replace `desktop` with `web`. Keeping the package name `dsh-notify-tray` replaces the same installed plugin without adding a second copy. The installer's application result and any required restart determine whether the change is active; code changes or passing tests do not establish that this version is installed in the current DSH instance.

A working checkout changes when you switch branches. For long-term use, pin a verified commit or tag in a separate worktree and install that directory. Alternatively, pin the PluginManager target to `git+https://github.com/donhac/dsh-notify-tray.git#<commit-or-tag>`. The version string `0.1.8-donh.1` does not imply an npm release exists. See the [fork maintenance notes](FORK.md) for the full steps.

### Synchronization and update channels

- `master` stays a clean mirror of the original author's upstream; `donh` is the long-term personal branch, and `fix/goal-aware-notifications` carries this fix.
- Merge upstream and maintenance branches without rebasing public history. Test updates, then use PluginManager to install a pinned commit/tag or local directory and restart as its result requires.
- The sidebar **Updates** card retains the upstream npm stable-release checks. Local-directory and Git installations do not use this online update path; it is not the Donh fork's update channel.
- Entering `dsh-notify-tray` or `dsh-notify-tray@version` in **Add plugin** selects the [original author's npm package](https://www.npmjs.com/package/dsh-notify-tray), not this fork automatically.

Report fork problems on [donhac GitHub Issues](https://github.com/donhac/dsh-notify-tray/issues), including DSH and plugin versions, commit/tag, the operating system, and reproduction steps.
