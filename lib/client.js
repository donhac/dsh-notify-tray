// dsh-notify-tray, browser half (hand-written in DSH's client module format,
// so no build step is needed).
//
// Polls the host's `notify-tray/state` route (its light `lite=1` form), shows
// a native Notification for each new notice (completed / failed / approval /
// choice / input; one per session, closed again once a question is answered)
// and opens the session when a notification — or a tray menu row — is
// clicked. In the
// desktop app these notifications are OS-native and attributed to
// "DeepSeek Harness".
window.__ModuleLoader__.load({
  id: 'dsh-notify-tray',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var ROUTE = 'notify-tray/state'
    var RAISE_ROUTE = 'notify-tray/raise'
    var POLL_MS = 2000
    var SEEN_KEY = 'dsh-notify-tray:seen'

    function mainSessionId(sessions) {
      try {
        var byId = sessions.list.getSnapshot().byId
        for (var id in byId) {
          var row = byId[id]
          if (row && row.retainedBy && (row.retainedBy.mainView || 0) > 0) return row.id
        }
      } catch (e) {}
      return undefined
    }

    // Cross-tab dedupe: one notification per host event, whichever page sees it first.
    function claim(boot, seq) {
      try {
        var raw = localStorage.getItem(SEEN_KEY)
        var seen = raw ? JSON.parse(raw) : {}
        if (seen.boot === boot && seen.seq >= seq) return false
        localStorage.setItem(SEEN_KEY, JSON.stringify({ boot: boot, seq: seq }))
      } catch (e) {}
      return true
    }

    // Settings mount independently once the layout and host namespace are ready.
    var inject = ['uiWorkspace', 'sessions', 'slots', 'locale', 'configForms']

    // ------------------------------------------------------------------------
    // Settings page: a sidebar entry opens a main panel containing a SettingsForm
    // over the `notify-tray` settings namespace (the `.volatile()` fields of
    // lib/index.js Config, served by @deepseek-ai/dsh-settings), grouped into
    // sections with toggles, segmented choices and number fields, saved automatically.
    // Plain React.createElement, so no build step is needed.
    // ------------------------------------------------------------------------
    function mountSettingsPage(ctx, require) {
      const React = require('react')
      const ui = require('@deepseek-ai/dsh-client-ui-primitives')
      const h = React.createElement

      /** Settings namespace = this plugin's profile entry id (cordis.patch.yml). */
      const NS = 'notify-tray'
      /** Dictionary namespace owned by this page. */
      const LOCALE_NS = 'notify-tray.settings'
      /** The sidebar id and main slot key must match for layout navigation. */
      const PANEL_ID = 'notify-tray'
      const CATALOG_ROUTE = 'notify-tray/catalog'
      const REFRESH_ROUTE = 'notify-tray/refresh'
      const TRAY_ROUTE = 'notify-tray/tray'
      /** How often the page re-reads the host's live state (current model, plan quota). */
      const LIVE_MS = 5000

      // ---- which OS this is --------------------------------------------------------
      // The host reports `process.platform` in its state (authoritative: with
      // `dsh web` the browser may run elsewhere); until that arrives the
      // browser's own platform is the guess. Each OS only gets what it has:
      // Windows has no status bar, so no status-bar section at all; only the
      // macOS menu bar shows text beside the whale.
      function normalizePlatform(p) {
        if (p === 'darwin' || p === 'win32') return p
        if (p === 'linux' || p === 'freebsd' || p === 'openbsd') return 'linux'
        return undefined
      }
      function guessPlatform() {
        try {
          const nav = window.navigator || {}
          const text = String((nav.userAgentData && nav.userAgentData.platform) || nav.platform || nav.userAgent || '')
          // Mac first: "Darwin" contains "win".
          if (/mac|iphone|ipad|darwin/iu.test(text)) return 'darwin'
          if (/win/iu.test(text)) return 'win32'
          if (/linux|x11|bsd|cros/iu.test(text)) return 'linux'
        } catch (e) {}
        return undefined
      }
      /** What each OS shows; an unknown OS shows everything. */
      const FEATURES = {
        darwin: { tray: true, menuBarTitle: true },
        linux: { tray: true, menuBarTitle: false },
        win32: { tray: false, menuBarTitle: false },
      }
      const ALL_FEATURES = { tray: true, menuBarTitle: true }
      /** A translator that prefers `<key>_<platform>` when this page defines one. */
      function platformT(t, platform) {
        if (!platform) return t
        return key => (zh[`${key}_${platform}`] !== undefined ? t(`${key}_${platform}`) : t(key))
      }

      const zh = {
        title: '小鲸鱼通知站',
        autoSave: '自动保存已开启',
        saved: '设置已保存',
        pendingSave: '等待保存…',
        fixSettings: '请检查输入后自动保存',
        retrySave: '重试保存',
        updateTitle: '版本更新',
        updateHint: '打开此页自动检查，发现兼容的正式版后可一键更新。',
        checkUpdate: '检查更新',
        installUpdate: '立即更新',
        update_idle: '准备检查更新',
        update_checking: '正在检查新版本…',
        update_available: '发现可用的新版本',
        update_current: '已是最新正式版',
        update_blocked: '有新版本，但暂无适合当前 DSH 的正式版',
        update_unavailable: '当前 DSH 未提供可用的插件更新权限或接口。',
        update_updating: '正在更新，请稍候…',
        update_updated: '更新已完成',
        update_restart: '更新已安装，重启 DSH 后生效',
        update_error: '检查或更新失败，可重新检查后再试',
        update_unknown: '更新结果尚未确认，请到插件管理页查看，避免重复操作。',
        update_restored: '更新失败，DSH 已恢复旧版本；如提示需要重启，请重启 DSH。',
        update_broken: '更新与恢复均未完成，请到插件管理页处理。',
        updateSaveFirst: '设置尚未保存，请先检查输入或重试保存。',
        installedVersion: '当前版本',
        newVersion: '新版本',

        summary: '任务做完或需要你时提醒你，状态栏里看进度和花费。',
        summary_win32: '任务做完或需要你时弹通知，顺便算算今天花了多少。Windows 没有状态栏，小鲸鱼只用通知来找你。',
        sectionNotify: '提醒我',
        notifyWhen: '这些时候弹通知',
        notifyCompleted: '做完了',
        notifyChoice: '要我选',
        notifyInput: '要我写字',
        notifyApproval: '要我批准',
        notifyFailed: '翻车了',
        sound: '带提示音',
        soundHint: '系统通知响一声。',
        soundHint_darwin: 'macOS 系统通知的「叮」一声。',
        soundHint_win32: 'Windows 系统通知（右下角弹窗）的提示音。',
        soundHint_linux: '系统通知的提示音（要桌面环境支持）。',

        sectionTray: '状态栏小鲸鱼',
        tray: '显示小鲸鱼',
        trayHint: '更改后自动保存并生效。',
        trayHint_linux: 'UOS / Deepin / 麒麟 / KDE 自带托盘；GNOME 要装 AppIndicator 扩展。更改后自动保存并生效。',
        trayHiddenNote: '状态栏图标已从它的菜单里隐藏。',
        trayShowAgain: '重新显示状态栏图标',
        trayShowing: '正在显示…',
        trayFailedNote: '状态栏图标没能启动（没有托盘宿主或 D-Bus？），只保留通知。',
        trayRetry: '重试',
        titleStyle: '鲸鱼旁边显示',
        titleText: '文字',
        titleCount: '数字',
        titleIcon: '不显示',
        titleStyleHint_text: '例：🐳 待处理 1；空闲时什么都不显示。',
        titleStyleHint_count: '例：🐳 1',
        titleStyleHint_icon: '只有鲸鱼，状态看它的样子。',

        sectionMoney: '花费与套餐',
        today: '今天',
        spendNone: '还没有花费记录',
        currentModelNone: '还没看到请求，先聊一句就知道了。',
        perMillion: '每百万',
        offPeakNow: '现在是空闲时段，按半价估算',
        offPeakLater: '空闲时段（北京时间工作日 9–12、14–18 点以外）按半价估算',
        noListedPrice: '目录里没有这个模型的价格，可在「高级设置」里填自定义单价。',
        catalogOff: 'DSH 自带的模型目录没找到，只有插件内置价可用。可设置环境变量 DSH_NOTIFY_TRAY_PI_AI 指向 DSH 的安装目录后重启。',
        myPlan: '我的套餐',
        myPlanHint: '选好后价格、额度自动填好。',
        planProvider: '平台',
        providerNone: '不设置',
        providerCustom: '自定义',
        planId: '套餐',
        planCustom: '手填 / 其他套餐',
        pricingPage: '价格页',
        consolePage: '用量页',
        autoQuota: '自动查剩余额度',
        autoQuotaNone: '这家平台没有公开的额度接口，剩余额度可在下面手填。',
        autoQuotaCustom: '自定义平台：在「高级设置」里填一个返回 JSON 的额度查询地址。',
        planApiKeyEnv: 'API Key 引用',
        planApiKeyEnvHint: '填 DSH「模型」页里保存密钥时用的名字（或同名环境变量），只在查额度时读取。',
        refreshNow: '刷新',
        refreshing: '刷新中…',
        updatedAt: '更新',
        fetchFailed: '获取失败',
        attemptSkipped: '没用上',
        attemptFailed: '失败',
        noFetchYet: '还没获取过',
        resetsAt: '重置',
        remainingShort: '剩余',
        planDetails: '手动改套餐信息',
        planDetailsHint: '名称、价格、周期、余额、重置时间',
        planName: '套餐名',
        planNameHint: '留空用预设名。',
        planPrice: '价格',
        planPriceHint: '留空用预设价；0 表示按量付费。',
        planPeriod: '周期',
        periodMonth: '每月',
        periodYear: '每年',
        periodWeek: '每周',
        periodOnce: '一次性',
        periodFree: '按量',
        planCurrency: '套餐币种',
        planQuota: '额度说明',
        planQuotaHint: '例如「每 5 小时 ≈ 1000 次」，留空用预设。',
        planBalance: '套餐余额（手填）',
        planBalanceHint: '预付费 / 充值余额；能从接口拿到时留空即可。',
        planRemaining: '剩余额度（手填）',
        planRemainingHint: '例如「68%」「1200 次」，手填优先于接口。',
        planResetAt: '下次重置',
        planResetAtHint: '例如「今晚 20:00」「每周一」。',

        advanced: '高级设置',
        advancedHint: '通知通道、花费算法、自定义单价、刷新间隔等，一般不用改。',
        advancedChanged: '已改 {n} 项',
        groupNotify: '通知',
        channel: '通知从哪里弹',
        channelAuto: '自动',
        channelClient: '只用窗口',
        channelSystem: '只用系统',
        channelBoth: '都弹',
        channelOff: '不弹',
        channelHint: '自动：开着 DSH 窗口就由窗口弹，否则由系统弹。',
        suppressWhenFocused: '正看着这个会话时不弹',
        suppressWhenFocusedHint: '关掉后，哪怕你正看着它跑完也会弹一条。',
        groupTray: '状态栏',
        showSpendInTitle: '鲸鱼旁边带上今日花费',
        showSpendInTitleHint: '例：运行中 1 · ¥1.82',
        errorHoldMinutes: '失败后鲸鱼保持「×」几分钟',
        errorHoldMinutesHint: '0 表示只记在菜单里。',
        errorHoldMinutes_linux: '失败后鲸鱼保持红色几分钟',
        groupSpend: '花费',
        spendSource: '花费怎么算',
        spendAuto: '自动',
        spendBalance: '余额扣费',
        spendEstimate: '按单价估算',
        spendSourceHint: '自动：登录了 DeepSeek 账户看余额扣费，否则按单价估算。',
        currency: '显示币种',
        balancePollMinutes: '账户余额几分钟刷新一次',
        balancePollMinutesHint: '每轮任务结束后 5 秒也会刷新一次。',
        groupPrice: '单价（估算用）',
        priceSource: '估算用哪个价',
        priceAuto: '自动',
        priceCatalog: '只用目录价',
        priceCustom: '只用自定义价',
        priceSourceHint: '自动：价格表 → 自定义价 → 目录价 → 内置价。',
        fillCustom: '填入目录价',
        customInput: '输入（未命中缓存）',
        customInputHint: '每百万 token，留空不用',
        customCacheRead: '输入（缓存命中）',
        customCacheReadHint: '留空按输入价',
        customOutput: '输出',
        customOutputHint: '每百万 token',
        customPriceCurrency: '自定义单价币种',
        exchangeRate: '汇率：1 美元 = ? 人民币',
        exchangeRateHint: '目录价是美元，显示人民币时按这个换算。',
        groupQuota: '额度刷新',
        planAutoQuota: '自动刷新套餐额度',
        planAutoQuotaHint: '按下面的间隔定时查询；状态栏菜单里也能手动刷新。',
        planAutoQuotaHint_win32: '按下面的间隔定时查询；上面的「刷新」可以手动查。',
        quotaPollMinutes: '额度几分钟刷新一次',
        quotaPollMinutesHint: '',
        planQuotaUrl: '额度查询地址',
        planQuotaUrlHint: '留空用预设地址。',

        srcTable: '价格表',
        srcCustom: '自定义价',
        srcCatalog: '目录价',
        srcStatic: '内置价',
        srcModelsDev: 'models.dev 价',
        overridden: '已修改',
        reset: '恢复默认',
        readOnly: '本部署的设置为只读。',
        unavailable: '小鲸鱼还没加载好，暂时不能配置。',
        saving: '保存中…',
        saveFailed: '设置未保存，修改已保留，请重试。',
        invalidNumber: '请填数字；留空表示用默认值。',
      }
      const en = {
        title: 'Whale Notify Station',
        autoSave: 'Autosave is on',
        saved: 'Settings saved',
        pendingSave: 'Waiting to save…',
        fixSettings: 'Check your input to save automatically',
        retrySave: 'Retry saving',
        updateTitle: 'Updates',
        updateHint: 'Checks when you open this page. Install a compatible stable release with one click.',
        checkUpdate: 'Check for updates',
        installUpdate: 'Update now',
        update_idle: 'Ready to check for updates',
        update_checking: 'Checking for updates…',
        update_available: 'A new version is available',
        update_current: 'You have the latest stable version',
        update_blocked: 'Newer versions exist, but no compatible stable release is available',
        update_unavailable: 'Plugin update access or APIs are unavailable in this DSH instance.',
        update_updating: 'Updating, please wait…',
        update_updated: 'Update complete',
        update_restart: 'Update installed. Restart DSH to use it.',
        update_error: 'Check or update failed. Check again to retry.',
        update_unknown: 'The update outcome is unknown. Check plugin management before trying again.',
        update_restored: 'Update failed; DSH restored the previous version. Restart DSH if requested.',
        update_broken: 'Update and recovery did not complete. Open plugin management to resolve this.',
        updateSaveFirst: 'Settings are not saved. Check your input or retry saving first.',
        installedVersion: 'Installed',
        newVersion: 'New version',

        summary: 'Notifies you when a task finishes or needs you; the status bar shows progress and spend.',
        summary_win32: 'Notifies you when a task finishes or needs you, and keeps count of today\'s spend. Windows has no status bar, so the whale reaches you through notifications only.',
        sectionNotify: 'Notify me',
        notifyWhen: 'Send a notification when',
        notifyCompleted: 'A task finished',
        notifyChoice: 'A choice is needed',
        notifyInput: 'Text is needed',
        notifyApproval: 'Approval is needed',
        notifyFailed: 'A task failed',
        sound: 'Play a sound',
        soundHint: 'System notifications make a sound.',
        soundHint_darwin: 'The macOS notification chime.',
        soundHint_win32: 'The Windows notification (toast) sound.',
        soundHint_linux: 'The notification sound, where the desktop supports one.',

        sectionTray: 'Status-bar whale',
        tray: 'Show the whale',
        trayHint: 'Changes are saved and applied automatically.',
        trayHint_linux: 'Built into UOS / Deepin / Kylin / KDE; GNOME needs the AppIndicator extension. Changes are saved and applied automatically.',
        trayHiddenNote: 'The status-bar icon was hidden from its own menu.',
        trayShowAgain: 'Show the status-bar icon again',
        trayShowing: 'Showing…',
        trayFailedNote: 'The status-bar icon could not start (no tray host or D-Bus?); notifications still work.',
        trayRetry: 'Retry',
        titleStyle: 'Beside the whale',
        titleText: 'Words',
        titleCount: 'Count',
        titleIcon: 'Nothing',
        titleStyleHint_text: 'e.g. 🐳 待处理 1; nothing while idle.',
        titleStyleHint_count: 'e.g. 🐳 1',
        titleStyleHint_icon: 'Just the whale; its pose tells the state.',

        sectionMoney: 'Spend & plan',
        today: 'Today',
        spendNone: 'No spend recorded yet',
        currentModelNone: 'No request seen yet — send one message and it shows up here.',
        perMillion: 'per million',
        offPeakNow: 'Off-peak now: estimated at half price',
        offPeakLater: 'Off-peak (outside 9–12 and 14–18 Beijing time on weekdays) is estimated at half price',
        noListedPrice: 'No catalog price for this model; set a custom price under Advanced.',
        catalogOff: 'DSH\'s bundled model catalog was not found; only the plugin\'s built-in prices apply. Point the DSH_NOTIFY_TRAY_PI_AI environment variable at the DSH install directory and restart.',
        myPlan: 'My plan',
        myPlanHint: 'Price and quota are filled in from the preset.',
        planProvider: 'Provider',
        providerNone: 'None',
        providerCustom: 'Custom',
        planId: 'Plan',
        planCustom: 'Other / manual',
        pricingPage: 'Pricing page',
        consolePage: 'Usage page',
        autoQuota: 'Fetch remaining quota',
        autoQuotaNone: 'This provider has no public quota endpoint; type the remaining quota below.',
        autoQuotaCustom: 'Custom provider: set a JSON quota URL under Advanced.',
        planApiKeyEnv: 'API key reference',
        planApiKeyEnvHint: 'The name the key was saved under on DSH\'s Models page (or a same-named environment variable); read only to query quota.',
        refreshNow: 'Refresh',
        refreshing: 'Refreshing…',
        updatedAt: 'updated',
        fetchFailed: 'Fetch failed',
        attemptSkipped: 'not used',
        attemptFailed: 'failed',
        noFetchYet: 'Not fetched yet',
        resetsAt: 'resets',
        remainingShort: 'Remaining',
        planDetails: 'Edit plan details',
        planDetailsHint: 'name, price, period, balance, reset time',
        planName: 'Plan name',
        planNameHint: 'Blank: preset name.',
        planPrice: 'Price',
        planPriceHint: 'Blank: preset price; 0 means pay-as-you-go.',
        planPeriod: 'Period',
        periodMonth: 'Monthly',
        periodYear: 'Yearly',
        periodWeek: 'Weekly',
        periodOnce: 'One-off',
        periodFree: 'Pay-as-you-go',
        planCurrency: 'Plan currency',
        planQuota: 'Quota description',
        planQuotaHint: 'e.g. "≈1000 requests per 5 h"; blank: preset.',
        planBalance: 'Plan balance (manual)',
        planBalanceHint: 'Prepaid / top-up balance; leave blank when the API supplies it.',
        planRemaining: 'Remaining quota (manual)',
        planRemainingHint: 'e.g. "68%" or "1200 requests"; a typed value wins over the API.',
        planResetAt: 'Next reset',
        planResetAtHint: 'e.g. "20:00 tonight", "Mondays".',

        advanced: 'Advanced',
        advancedHint: 'Notification channel, spend method, custom prices, refresh intervals — rarely needed.',
        advancedChanged: '{n} changed',
        groupNotify: 'Notifications',
        channel: 'Notification channel',
        channelAuto: 'Auto',
        channelClient: 'Window only',
        channelSystem: 'System only',
        channelBoth: 'Both',
        channelOff: 'Off',
        channelHint: 'Auto: the DSH window notifies while it is open; the OS does otherwise.',
        suppressWhenFocused: 'Stay quiet while I am looking at that session',
        suppressWhenFocusedHint: 'Off: notify even when you watch it finish.',
        groupTray: 'Status bar',
        showSpendInTitle: 'Add today\'s spend beside the whale',
        showSpendInTitleHint: 'e.g. 运行中 1 · ¥1.82',
        errorHoldMinutes: 'Minutes the "×" stays after a failure',
        errorHoldMinutesHint: '0: failures are only listed in the menu.',
        errorHoldMinutes_linux: 'Minutes the whale stays red after a failure',
        groupSpend: 'Spend',
        spendSource: 'How spend is counted',
        spendAuto: 'Auto',
        spendBalance: 'Balance drops',
        spendEstimate: 'Price estimate',
        spendSourceHint: 'Auto: real balance drops when signed in to DeepSeek, otherwise unit prices.',
        currency: 'Currency',
        balancePollMinutes: 'Balance refresh interval (minutes)',
        balancePollMinutesHint: 'Also refreshed 5 s after every finished turn.',
        groupPrice: 'Unit prices (for estimates)',
        priceSource: 'Which price to use',
        priceAuto: 'Auto',
        priceCatalog: 'Catalog only',
        priceCustom: 'Custom only',
        priceSourceHint: 'Auto: price table → custom price → catalog → built-in prices.',
        fillCustom: 'Copy catalog price',
        customInput: 'Input (cache miss)',
        customInputHint: 'per million tokens; blank: unused',
        customCacheRead: 'Input (cache hit)',
        customCacheReadHint: 'Blank: same as input',
        customOutput: 'Output',
        customOutputHint: 'per million tokens',
        customPriceCurrency: 'Custom price currency',
        exchangeRate: 'Rate: 1 USD = ? CNY',
        exchangeRateHint: 'Catalog prices are USD; used when displaying CNY.',
        groupQuota: 'Quota refresh',
        planAutoQuota: 'Refresh plan quota automatically',
        planAutoQuotaHint: 'Polled at the interval below; the tray menu can refresh by hand too.',
        planAutoQuotaHint_win32: 'Polled at the interval below; "Refresh" above fetches by hand.',
        quotaPollMinutes: 'Quota refresh interval (minutes)',
        quotaPollMinutesHint: '',
        planQuotaUrl: 'Quota URL',
        planQuotaUrlHint: 'Blank: preset URL.',

        srcTable: 'price table',
        srcCustom: 'custom',
        srcCatalog: 'catalog',
        srcStatic: 'built-in',
        srcModelsDev: 'models.dev',
        overridden: 'Changed',
        reset: 'Reset to default',
        readOnly: 'This deployment stores settings read-only.',
        unavailable: 'The whale is not loaded yet, so it cannot be configured right now.',
        saving: 'Saving…',
        saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
        invalidNumber: 'Enter a number, or leave blank to use the default.',
      }

      // ---- field specs for SettingsFormModel ---------------------------------------
      // The model stages text; these say how a field's value becomes text and back.
      const boolField = field => ({
        field,
        format: v => (v === true ? 'on' : v === false ? 'off' : ''),
        parse: text => (text === '' ? { kind: 'clear' } : { kind: 'set', value: text === 'on' }),
      })
      const choiceField = field => ({
        field,
        format: v => (typeof v === 'string' ? v : ''),
        parse: text => (text === '' ? { kind: 'clear' } : { kind: 'set', value: text }),
      })
      const textField = field => (typeof ui.settingsTextField === 'function' ? ui.settingsTextField(field) : {
        field,
        format: v => (typeof v === 'string' ? v : ''),
        parse: text => (text.trim() === '' ? { kind: 'clear' } : { kind: 'set', value: text.trim() }),
      })
      const BOOLS = ['notifyCompleted', 'notifyChoice', 'notifyInput', 'notifyApproval', 'notifyFailed', 'suppressWhenFocused', 'sound', 'tray', 'showSpendInTitle', 'planAutoQuota']
      const CHOICES = ['channel', 'titleStyle', 'spendSource', 'currency', 'priceSource', 'customPriceCurrency', 'planPeriod', 'planCurrency']
      const NUMBERS = ['errorHoldMinutes', 'balancePollMinutes', 'customInput', 'customCacheRead', 'customOutput', 'exchangeRate', 'planPrice', 'planBalance', 'quotaPollMinutes']
      const TEXTS = ['planProvider', 'planId', 'planName', 'planQuota', 'planRemaining', 'planResetAt', 'planApiKeyEnv', 'planQuotaUrl']
      const FIELDS = [...BOOLS, ...CHOICES, ...NUMBERS, ...TEXTS]
      /** The five "notify me when" switches, shown as one row of checkboxes. */
      const NOTIFY_FIELDS = ['notifyCompleted', 'notifyChoice', 'notifyInput', 'notifyApproval', 'notifyFailed']
      /** Fields behind the "Advanced" fold (counted for its "n changed" tag). */
      const ADVANCED_FIELDS = ['channel', 'suppressWhenFocused', 'showSpendInTitle', 'errorHoldMinutes', 'spendSource', 'currency', 'balancePollMinutes', 'priceSource', 'customInput', 'customCacheRead', 'customOutput', 'customPriceCurrency', 'exchangeRate', 'planAutoQuota', 'quotaPollMinutes', 'planQuotaUrl']
      const TRAY_FIELDS = ['showSpendInTitle', 'errorHoldMinutes']
      /** Plan fields a preset fills in; switching provider clears them. */
      const PRESET_FIELDS = ['planId', 'planName', 'planPrice', 'planCurrency', 'planPeriod', 'planQuota', 'planQuotaUrl']

      // The form model clears staged edits when a save resolves. Keep edits made
      // during that request and replay them before submitting the next batch.
      class Controller {
        constructor(scope) {
          this.form = new ui.SettingsFormModel(scope, [
            ...BOOLS.map(boolField),
            ...CHOICES.map(choiceField),
            ...NUMBERS.map(f => ui.settingsNumberField(f)),
            ...TEXTS.map(textField),
          ])
          this.actions = this.form.actions()
          this.listeners = new Set()
          this.pending = new Map()
          this.notice = null
          this.noticeSeq = 0
          this.disposed = false
          this.inFlight = false
          this.formStore = this.form.bind(() => this.projection())
          this.unsubscribe = this.formStore.subscribe?.(() => this.publish())
          this.store = {
            getSnapshot: () => this.snapshot,
            subscribe: listener => { this.listeners.add(listener); return () => this.listeners.delete(listener) },
          }
          this.publish()
        }

        projection() {
          const fields = {}
          for (const f of FIELDS) fields[f] = this.form.field(f)
          return { ...this.form.shell(), fields, notice: this.notice }
        }

        publish() {
          if (this.disposed) return
          this.snapshot = this.projection()
          for (const listener of this.listeners) listener()
        }

        change(field, text, reset = false) {
          if (this.disposed || !this.form.shell().writable) return
          this.notice = null
          if (this.inFlight) this.pending.set(field, { text, reset })
          if (reset) this.actions.resetField(field)
          else this.actions.edit(field, text)
          this.publish()
          this.schedule()
        }

        schedule() {
          clearTimeout(this.timer)
          this.timer = setTimeout(() => { this.flush() }, 500)
        }

        async flush() {
          clearTimeout(this.timer)
          if (this.disposed) return false
          // Used by refresh/update actions to wait for every pending setting.
          if (this.inFlight) {
            await this.saving
            return this.flush()
          }
          const state = this.form.shell()
          if (!state.available || !state.writable || state.invalid) return false
          if (!state.dirty) return true
          this.inFlight = true
          this.notice = null
          this.pending.clear()
          this.saving = (async () => {
            try {
              // actions().save() returns void in DSH; save() is the awaitable method.
              await this.form.save()
              if (this.disposed) return false
              const failed = this.form.shell().failed
              const pending = [...this.pending]
              this.pending.clear()
              for (const [field, change] of pending) {
                if (change.reset) this.actions.resetField(field)
                else this.actions.edit(field, change.text)
              }
              const after = this.form.shell()
              this.notice = failed ? { id: ++this.noticeSeq, kind: 'saveFailed' }
                : !after.dirty ? { id: ++this.noticeSeq, kind: 'saved' } : null
              // Do not loop on a rejection. An explicit retry or a new edit retries.
              if (!failed && after.dirty && !after.invalid) this.schedule()
              return !failed && !after.dirty
            } catch (error) {
              if (!this.disposed) this.notice = { id: ++this.noticeSeq, kind: 'saveFailed' }
              return false
            } finally {
              this.inFlight = false
              this.publish()
            }
          })()
          return this.saving
        }

        inject() {
          return {
            hooks: { notifyTray: this.store },
            edit: (field, text) => this.change(field, text),
            resetField: field => this.change(field, '', true),
            flush: () => this.flush(),
            retrySave: () => this.flush(),
            dismissNotice: id => { if (this.notice?.id === id) { this.notice = null; this.publish() } },
          }
        }

        dispose() {
          this.disposed = true
          clearTimeout(this.timer)
          this.unsubscribe?.()
          this.listeners.clear()
          this.form.dispose()
        }
      }
      exports.__SettingsController = Controller

      // All update decisions and package mutations belong to DSH's plugin manager.
      // The browser never runs a shell or chooses an unverified registry version.
      class UpdateController {
        constructor(getManager, flush) {
          this.getManager = getManager
          this.flush = flush
          this.listeners = new Set()
          this.snapshot = { phase: 'idle' }
          this.disposed = false
          this.store = {
            getSnapshot: () => this.snapshot,
            subscribe: listener => { this.listeners.add(listener); return () => this.listeners.delete(listener) },
          }
        }

        patch(change) {
          if (this.disposed) return
          this.snapshot = { ...this.snapshot, ...change }
          for (const listener of this.listeners) listener()
        }

        async check() {
          if (this.disposed || ['checking', 'updating', 'restart'].includes(this.snapshot.phase)) return
          const manager = this.getManager()
          if (!manager?.listVersions || !manager?.updateBundle) return this.patch({ phase: 'unavailable' })
          this.patch({ phase: 'checking', candidate: undefined, error: undefined })
          try {
            const inventory = await manager.listBundles()
            if (!inventory.ok) throw new Error(inventory.error?.message || 'Plugin inventory unavailable')
            const pkg = inventory.value.find(pkg => pkg.name === 'dsh-notify-tray')
            if (!pkg) return this.patch({ phase: 'unavailable' })
            this.patch({ installed: pkg.version })
            if (!pkg.updatable) return this.patch({ phase: /^(?:link:|file:|git|https?:|\/)/u.test(pkg.source || '') ? 'local' : 'unavailable' })
            const answer = await manager.listVersions('dsh-notify-tray', {})
            if (!answer.ok) throw new Error(answer.error?.message || 'Version check failed')
            const list = answer.value
            if (list.status !== 'listed') throw new Error(list.reason || 'Version check refused')
            const candidate = list.versions.find(v => v.bundle && !v.incompatible && !v.deprecated && !v.prerelease)
            this.patch({ phase: candidate ? 'available' : list.versions.length ? 'blocked' : 'current', installed: list.installed, candidate: candidate?.version, registry: list.registry })
          } catch (error) {
            this.patch({ phase: 'error', error: String(error.message || error) })
          }
        }

        async update() {
          if (this.disposed || this.snapshot.phase !== 'available') return
          const { candidate, registry } = this.snapshot
          this.patch({ phase: 'updating', error: undefined })
          try {
            if (!await this.flush()) return this.patch({ phase: 'available', error: 'updateSaveFirst' })
            if (this.disposed) return
            const manager = this.getManager()
            const answer = await manager.updateBundle('dsh-notify-tray', candidate, { registry })
            if (!answer.ok) return this.patch({ phase: 'unknown', error: answer.error?.message })
            const result = answer.value
            const application = result.result?.application
            if (application === 'applied' || application === 'restart-required') {
              this.patch({ phase: application === 'restart-required' ? 'restart' : 'updated', installed: candidate, candidate: undefined })
            } else {
              const restored = result.restore?.application
              this.patch({ phase: restored === 'applied' || restored === 'restart-required' ? 'restored' : restored ? 'broken' : 'error', error: result.result?.error?.diagnostic || result.result?.error?.code || application })
            }
          } catch (error) {
            // A disconnected client cannot assume an update failed; the host may still finish it.
            this.patch({ phase: 'unknown', error: String(error.message || error) })
          }
        }

        dispose() { this.disposed = true; this.listeners.clear() }
      }
      exports.__UpdateController = UpdateController

      // ---- live data: catalog once, host state while the page is open ------------------
      const live = { catalog: undefined, state: undefined, listeners: new Set() }
      /** Which folds are open; kept while the page is closed and reopened. */
      const open = { plan: false, advanced: false }
      function useOpen(key) {
        const [, bump] = React.useState(0)
        return [open[key], () => { open[key] = !open[key]; bump(n => n + 1) }]
      }
      function publishLive() { for (const fn of live.listeners) fn() }
      function fetchJson(url, init) {
        return fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store', ...init }).then(res => (res.ok ? res.json() : undefined))
      }
      function loadCatalog() {
        if (live.catalog) return
        fetchJson(CATALOG_ROUTE).then(body => { if (body) { live.catalog = body; publishLive() } }).catch(() => {})
      }
      function loadState() {
        // Sending back the rev we hold: an unchanged snapshot comes back as `unchanged` only.
        const rev = live.state && live.state.rev ? '&rev=' + encodeURIComponent(live.state.rev) : ''
        return fetchJson(ROUTE + '?after=-2' + rev).then(body => {
          if (!body || body.unchanged) return
          live.state = body
          publishLive()
        }).catch(() => {})
      }
      // Test seam: lets a test drive the loaders without React effects.
      const currentPlatform = () => normalizePlatform(live.state && live.state.platform) || guessPlatform()
      exports.__settingsLive = { live, open, loadCatalog, loadState, currentPlatform }
      function useLive() {
        const [, bump] = React.useState(0)
        React.useEffect(() => {
          const fn = () => bump(n => n + 1)
          live.listeners.add(fn)
          loadCatalog()
          loadState()
          const timer = setInterval(loadState, LIVE_MS)
          return () => { live.listeners.delete(fn); clearInterval(timer) }
        }, [])
        return live
      }

      // ---- presentation -------------------------------------------------------------------
      const S = {
        section: { marginTop: 28 },
        sectionTitle: { fontSize: 15, fontWeight: 600, margin: '0 0 4px' },
        row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '10px 0', borderBottom: '1px solid color-mix(in srgb, currentColor 10%, transparent)' },
        rowText: { minWidth: 0 },
        label: { fontSize: 14 },
        hint: { margin: '2px 0 0', opacity: 0.6, fontSize: 12 },
        badges: { display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 8, fontSize: 12 },
        reset: { background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'inherit', textDecoration: 'underline', opacity: 0.7, fontSize: 12 },
        control: { flex: 'none' },
        grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px 16px', marginTop: 12 },
        card: { border: '1px solid var(--dsw-alias-border-l3, color-mix(in srgb, currentColor 12%, transparent))', borderRadius: 'var(--dsw-radius-lg, 10px)', padding: '12px 14px', margin: '12px 0', fontSize: 13, lineHeight: '20px' },
        cardTitle: { fontSize: 12, fontWeight: 500, opacity: 0.65, marginBottom: 4 },
        mono: { overflowWrap: 'anywhere', fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)', fontSize: 13 },
        muted: { opacity: 0.65 },
        error: { color: 'var(--dsw-alias-state-error-primary, #d33)' },
        select: { boxSizing: 'border-box', border: '.5px solid var(--dsw-alias-border-l4, color-mix(in srgb, currentColor 25%, transparent))', borderRadius: 'var(--dsw-radius-md, 6px)', width: 180, maxWidth: '100%', height: 32, font: 'inherit', background: 'var(--dsw-alias-bg-layer-1, transparent)', color: 'var(--dsw-alias-label-primary, inherit)', padding: '0 10px', fontSize: 14, lineHeight: '22px', cursor: 'pointer' },
        link: { color: 'inherit', textDecoration: 'underline', opacity: 0.75 },
        button: { font: 'inherit', fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '.5px solid var(--dsw-alias-border-l4, color-mix(in srgb, currentColor 25%, transparent))', background: 'transparent', color: 'inherit', cursor: 'pointer' },
        lines: { margin: '6px 0 0', paddingLeft: 18, fontSize: 12, opacity: 0.75 },
        checks: { display: 'flex', flexWrap: 'wrap', gap: '8px 18px', marginTop: 10 },
        check: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 },
        spendCard: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, border: '1px solid var(--dsw-alias-border-l3, color-mix(in srgb, currentColor 12%, transparent))', borderRadius: 'var(--dsw-radius-lg, 10px)', padding: '12px 14px', margin: '4px 0' },
        spendValue: { fontSize: 22, fontWeight: 600, lineHeight: '28px' },
        keyRow: { display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' },
        disclosure: { display: 'flex', alignItems: 'center', gap: 6, width: '100%', font: 'inherit', fontSize: 13, color: 'inherit', background: 'none', border: 0, padding: '10px 0', cursor: 'pointer', textAlign: 'left' },
        disclosureBig: { fontSize: 15, fontWeight: 600, padding: '14px 0' },
        disclosureHint: { fontSize: 12, fontWeight: 400, opacity: 0.6, minWidth: 0 },
        chevron: { width: 14, flex: 'none', opacity: 0.6 },
        disclosureBody: { paddingLeft: 20, paddingBottom: 8 },
        groupTitle: { fontSize: 12, fontWeight: 600, opacity: 0.65, margin: '16px 0 2px' },
        advanced: { marginTop: 28, borderTop: '1px solid color-mix(in srgb, currentColor 10%, transparent)' },
        fieldGap: { marginTop: 12 },
      }

      function Overridden({ t, field, disabled, onReset }) {
        if (!field.overridden) return null
        return h('span', { style: S.badges },
          h(ui.Tag, { tone: 'neutral' }, t('overridden')),
          h('button', { type: 'button', style: S.reset, disabled, onClick: onReset }, t('reset')))
      }

      function ToggleRow({ t, name, field, disabled, edit, resetField }) {
        const hint = t(`${name}Hint`)
        return h('div', { style: S.row },
          h('div', { style: S.rowText },
            h('div', { style: S.label }, t(name), h(Overridden, { t, field, disabled, onReset: () => resetField(name) })),
            hint ? h('p', { style: S.hint }, hint) : null),
          h('div', { style: S.control },
            h(ui.Switch, { checked: field.text === 'on', disabled, label: t(name), onChange: next => edit(name, next ? 'on' : 'off') })))
      }

      function ChoiceRow({ t, name, field, options, disabled, edit, resetField, hint }) {
        return h('div', { style: { ...S.row, flexWrap: 'wrap' } },
          h('div', { style: S.rowText },
            h('div', { style: S.label }, t(name), h(Overridden, { t, field, disabled, onReset: () => resetField(name) })),
            hint ? h('p', { style: S.hint }, t(hint)) : null),
          h('div', { style: S.control },
            h(ui.SegmentedControl, {
              id: `notify-tray-${name}`,
              label: t(name),
              value: field.text,
              disabled,
              options: options.map(([value, key]) => ({ value, label: t(key) })),
              onChange: value => edit(name, value),
            })))
      }

      /** Several on/off fields as one row of checkboxes (a Switch per field where the host has no Checkbox). */
      function CheckRow({ t, label, names, f, disabled, edit, resetField }) {
        const Box = ui.Checkbox || ui.Switch
        const changed = names.filter(name => f[name].overridden)
        return h('div', { style: { ...S.row, display: 'block' } },
          h('div', { style: S.label }, t(label), changed.length ? h('span', { style: S.badges },
            h(ui.Tag, { tone: 'neutral' }, t('overridden')),
            h('button', { type: 'button', style: S.reset, disabled, onClick: () => changed.forEach(resetField) }, t('reset'))) : null),
          h('div', { style: S.checks }, names.map(name => h('span', { key: name, style: S.check },
            h(Box, { checked: f[name].text === 'on', disabled, label: t(name), onChange: next => edit(name, next ? 'on' : 'off') }),
            ui.Checkbox ? null : h('span', null, t(name))))))
      }

      function ValueField({ t, name, field, disabled, edit, resetField, numeric, placeholder, hint }) {
        return h(ui.SettingsValueField, {
          id: `notify-tray-${name}`,
          label: t(name),
          hint: hint === undefined ? t(`${name}Hint`) : hint,
          overriddenLabel: t('overridden'),
          resetLabel: t('reset'),
          invalidLabel: t('invalidNumber'),
          numeric: numeric !== false,
          placeholder,
          disabled,
          text: field.text,
          overridden: field.overridden,
          invalid: field.invalid,
          onEdit: text => edit(name, text),
          onReset: () => resetField(name),
        })
      }
      const NumberField = props => h(ValueField, { numeric: true, ...props })
      const TextField = props => h(ValueField, { ...props, numeric: false })

      /** A bare dropdown (its row carries the label). */
      function Select({ t, name, field, options, disabled, onChange }) {
        return h('select', {
          id: `notify-tray-${name}`,
          style: S.select,
          value: field.text,
          disabled,
          'aria-label': t(name),
          onChange: event => onChange(event.target.value),
        }, options.map(([value, label]) => h('option', { key: value, value }, label)))
      }

      function Section({ title, icon = 'settings', children }) {
        return h('section', { className: 'dnt-card' },
          h('h2', { className: 'dnt-card-title' }, h('span', { className: 'dnt-section-icon' }, h(Icon, { name: icon })), title),
          children)
      }

      /** A collapsible block: a ▸ / ▾ button, its content only while open. */
      function Disclosure({ id, title, hint, badge, big, children }) {
        const [isOpen, toggle] = useOpen(id)
        return h('div', null,
          h('button', { type: 'button', style: big ? { ...S.disclosure, ...S.disclosureBig } : S.disclosure, 'aria-expanded': isOpen, onClick: toggle },
            h('span', { 'aria-hidden': true, style: S.chevron }, isOpen ? '▾' : '▸'),
            h('span', null, title),
            badge ? h(ui.Tag, { tone: 'neutral' }, badge) : null,
            hint ? h('span', { style: S.disclosureHint }, hint) : null),
          isOpen ? h('div', { style: S.disclosureBody }, children) : null)
      }

      function Group({ title, children }) {
        return h('div', null, h('div', { style: S.groupTitle }, title), children)
      }

      const SYM = { CNY: '¥', USD: '$' }
      const fmt = (n, currency) => (typeof n === 'number' ? `${SYM[currency] ?? ''}${Number.isInteger(n) ? n : (n < 1 ? n.toFixed(4).replace(/0+$/u, '').replace(/\.$/u, '') : n.toFixed(2))}` : '—')
      const priceLine = (p, currency) => `${fmt(p.input, currency)} / ${fmt(p.cacheRead, currency)} / ${fmt(p.output, currency)}`
      const SOURCE_KEY = { table: 'srcTable', custom: 'srcCustom', catalog: 'srcCatalog', static: 'srcStatic', modelsDev: 'srcModelsDev' }
      const clock = at => {
        const d = new Date(at)
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      }

      /** Read-only: today's spend, the model in use and the unit price behind the estimate. */
      function SpendCard({ t, state }) {
        const spend = state && state.spend
        const currency = (state && state.usage && state.usage.currency) || 'CNY'
        const pricing = state && state.pricing
        const detail = []
        if (!pricing) {
          detail.push(h('div', { key: 'none', style: S.muted }, t('currentModelNone')))
        } else {
          detail.push(h('div', { key: 'route', style: S.mono }, `${pricing.provider ? `${pricing.provider} / ` : ''}${pricing.model}`))
          const price = pricing.effective
          if (price) {
            const source = SOURCE_KEY[price.source] ? t(SOURCE_KEY[price.source]) : price.source
            detail.push(h('div', { key: 'price', style: S.muted }, `${priceLine(price, price.currency)} ${t('perMillion')} · ${source}`))
            if (price.offPeakFactor !== undefined) detail.push(h('div', { key: 'offpeak', style: S.muted }, t(price.offPeakNow ? 'offPeakNow' : 'offPeakLater')))
          } else if (!pricing.listed) {
            detail.push(h('div', { key: 'nolisted', style: S.muted }, t('noListedPrice')))
          }
        }
        if (spend && spend.label) detail.push(h('div', { key: 'how', style: S.muted }, spend.label))
        return h('div', null,
          h('div', { style: S.spendCard },
            h('div', { style: { flex: '1 1 0', minWidth: 0 } },
              h('div', { style: S.cardTitle }, t('today')),
              spend ? h('div', { style: S.spendValue }, `${SYM[currency] ?? ''}${spend.value.toFixed(2)}`) : h('div', { style: S.muted }, t('spendNone'))),
            h('div', { style: { flex: '2 1 0', minWidth: 0, fontSize: 12, lineHeight: '19px' } }, detail)),
          state && state.catalogLoaded === false ? h('p', { style: S.hint }, t('catalogOff')) : null)
      }

      /** One line on the last quota fetch, plus the fetched lines. */
      function QuotaStatus({ t, plan }) {
        if (!plan || !plan.fetch) return h('p', { style: S.hint }, t('noFetchYet'))
        if (!plan.fetch.ok) {
          // What was tried, in order, and what to fix (lib/quota.js runQuotaPlan).
          const tried = (plan.fetch.attempts || []).filter(a => a.outcome !== 'ok')
          return h('div', null,
            h('p', { style: { ...S.hint, ...S.error } }, `${t('fetchFailed')}（${clock(plan.fetch.at)}）：${plan.fetch.error}`),
            tried.length > 1 || tried.some(a => a.hint)
              ? h('ul', { style: S.lines }, tried.map((a, i) => h('li', { key: i }, `${a.label}：${a.outcome === 'skipped' ? t('attemptSkipped') : t('attemptFailed')} · ${a.hint || a.detail}`)))
              : null)
        }
        const bits = []
        if (plan.remaining !== undefined) bits.push(`${t('remainingShort')} ${plan.remaining}`)
        if (plan.resetAt) bits.push(`${String(plan.resetAt)} ${t('resetsAt')}`)
        bits.push(`${clock(plan.fetch.at)} ${t('updatedAt')}`)
        return h('div', null,
          h('p', { style: S.hint }, bits.join(' · ')),
          plan.lines && plan.lines.length ? h('ul', { style: S.lines }, plan.lines.slice(0, 4).map((line, i) => h('li', { key: i }, line))) : null)
      }

      /** Brings back a status-bar icon hidden from its own menu (or one that failed to start). */
      function TrayStatus({ t, state }) {
        const tray = state && state.tray
        const [busy, setBusy] = React.useState(false)
        if (!tray || !tray.supported || !tray.enabled || tray.shown || !(tray.hidden || tray.failed)) return null
        const show = () => {
          setBusy(true)
          fetchJson(TRAY_ROUTE, { method: 'POST' }).then(() => loadState()).catch(() => {}).then(() => setBusy(false))
        }
        return h('div', { style: S.card },
          h('div', { style: tray.failed && !tray.hidden ? S.error : S.muted }, t(tray.hidden ? 'trayHiddenNote' : 'trayFailedNote')),
          h('div', { style: { marginTop: 8 } }, h('button', { type: 'button', style: S.button, disabled: busy, onClick: show }, busy ? t('trayShowing') : t(tray.hidden ? 'trayShowAgain' : 'trayRetry'))))
      }

      /** What the plan section and the advanced section both need to know about the chosen plan. */
      function planContext(f, state, catalog) {
        const providers = (catalog && catalog.providers) || []
        const providerId = f.planProvider.text || 'none'
        const provider = providers.find(p => p.id === providerId)
        const plans = (provider && provider.plans) || []
        const preset = plans.find(p => p.id === f.planId.text)
        const livePlan = state && state.plan
        const quotaSpec = livePlan && livePlan.canFetch ? { kind: livePlan.fetchKind, url: livePlan.fetchUrl } : ((preset && preset.quotaApi) || (provider && provider.quota))
        return { providers, providerId, provider, plans, preset, livePlan, quotaSpec }
      }

      function PlanSection({ t, f, common, state, catalog }) {
        const { edit, resetField, disabled } = common
        const { providers, providerId, provider, plans, preset, livePlan, quotaSpec } = planContext(f, state, catalog)
        const [busy, setBusy] = React.useState(false)
        const refresh = () => {
          setBusy(true)
          common.flush().then(saved => saved ? fetchJson(REFRESH_ROUTE, { method: 'POST' }).then(() => loadState()) : undefined).catch(() => {}).then(() => setBusy(false))
        }
        const choosePlan = id => {
          edit('planId', id)
          const next = plans.find(p => p.id === id)
          if (!next) return
          edit('planName', next.name)
          edit('planPrice', String(next.price))
          edit('planCurrency', next.currency)
          edit('planPeriod', next.period)
          edit('planQuota', next.quotaText ?? '')
          resetField('planQuotaUrl')
        }
        const chooseProvider = id => {
          edit('planProvider', id)
          for (const name of PRESET_FIELDS) resetField(name)
          // Suggest the provider's usual key reference, unless the user typed their own name.
          const current = f.planApiKeyEnv.text
          const suggested = !current || providers.some(p => p.keyEnv === current)
          const nextProvider = providers.find(p => p.id === id)
          if (suggested) {
            if (nextProvider?.keyEnv) edit('planApiKeyEnv', nextProvider.keyEnv)
            else resetField('planApiKeyEnv')
          }
        }
        const providerOptions = [['none', t('providerNone')], ...providers.map(p => [p.id, p.name]), ['custom', t('providerCustom')]]
        const planOptions = [...plans.map(p => [p.id, `${p.name}${p.price ? ` · ${SYM[p.currency] ?? ''}${p.price}` : ''}`]), ['', t('planCustom')]]
        const links = provider ? [['pricing', provider.pricingUrl], ['console', provider.consoleUrl]].filter(([, url]) => url) : []
        const planChanged = f.planProvider.overridden || f.planId.overridden

        const children = [h('div', { key: 'pick', style: { ...S.row, flexWrap: 'wrap' } },
          h('div', { style: S.rowText },
            h('div', { style: S.label }, t('myPlan'), planChanged ? h('span', { style: S.badges }, h(ui.Tag, { tone: 'neutral' }, t('overridden'))) : null),
            links.length
              ? h('p', { style: S.hint }, links.map(([key, url], i) => h(React.Fragment || 'span', { key }, i ? ' · ' : '', h('a', { href: url, target: '_blank', rel: 'noreferrer', style: S.link }, `${t(`${key}Page`)} ↗`))))
              : h('p', { style: S.hint }, t('myPlanHint'))),
          h('div', { style: { ...S.control, display: 'flex', gap: 8, flexWrap: 'wrap' } },
            h(Select, { t, name: 'planProvider', field: f.planProvider, options: providerOptions, disabled, onChange: chooseProvider }),
            providerId !== 'none' && plans.length ? h(Select, { t, name: 'planId', field: f.planId, options: planOptions, disabled, onChange: choosePlan }) : null))]
        if (providerId === 'none') return children

        // ---- remaining quota: the key reference and a refresh, when the provider has an endpoint ----
        const canFetch = Boolean(quotaSpec || f.planQuotaUrl.text)
        children.push(h('div', { key: 'quota', style: { ...S.row, display: 'block' } },
          h('div', { style: S.label }, t('autoQuota')),
          canFetch
            ? h('div', null,
              h(QuotaStatus, { t, plan: livePlan }),
              h('div', { style: S.keyRow },
                h('div', { style: { flex: '1 1 240px', minWidth: 0 } }, h(TextField, { name: 'planApiKeyEnv', field: f.planApiKeyEnv, placeholder: provider?.keyEnv ?? 'XXX_API_KEY', ...common })),
                livePlan && livePlan.apiKeyEnv ? h('button', { type: 'button', style: { ...S.button, marginTop: 24 }, disabled: disabled || busy, onClick: refresh }, busy ? t('refreshing') : t('refreshNow')) : null))
            : h('p', { style: S.hint }, t(providerId === 'custom' ? 'autoQuotaCustom' : 'autoQuotaNone'))))

        // ---- everything a preset fills in, folded away ----
        const detailFields = ['planName', 'planPrice', 'planPeriod', 'planCurrency', 'planQuota', 'planBalance', 'planRemaining', 'planResetAt']
        const detailsChanged = detailFields.filter(name => f[name].overridden).length
        children.push(h(Disclosure, { key: 'details', id: 'plan', title: t('planDetails'), hint: t('planDetailsHint'), badge: detailsChanged ? t('advancedChanged').replace('{n}', String(detailsChanged)) : undefined },
          h('div', { style: S.grid },
            h(TextField, { name: 'planName', field: f.planName, placeholder: preset?.name ?? '', ...common }),
            h(NumberField, { name: 'planPrice', field: f.planPrice, placeholder: preset ? String(preset.price) : '', ...common }),
            h(TextField, { name: 'planQuota', field: f.planQuota, placeholder: preset?.quotaText ?? '', ...common })),
          h(ChoiceRow, { name: 'planPeriod', field: f.planPeriod, ...common, options: [['month', 'periodMonth'], ['year', 'periodYear'], ['week', 'periodWeek'], ['once', 'periodOnce'], ['free', 'periodFree']] }),
          h(ChoiceRow, { name: 'planCurrency', field: f.planCurrency, ...common, options: [['CNY', 'CNY'], ['USD', 'USD']] }),
          h('div', { style: S.grid },
            h(NumberField, { name: 'planBalance', field: f.planBalance, placeholder: livePlan?.balance !== undefined && livePlan.remainingSource !== 'manual' ? fmt(livePlan.balance, livePlan.balanceCurrency) : '', ...common }),
            h(TextField, { name: 'planRemaining', field: f.planRemaining, placeholder: livePlan?.remaining && livePlan.remainingSource === 'api' ? String(livePlan.remaining) : '', ...common }),
            h(TextField, { name: 'planResetAt', field: f.planResetAt, placeholder: livePlan?.resetAt && !f.planResetAt.text ? String(livePlan.resetAt) : '', ...common }))))
        return children
      }

      /** Everything most people never touch, behind one fold. */
      function AdvancedSection({ t, f, common, features, state, catalog }) {
        const { disabled, edit } = common
        const toggle = name => h(ToggleRow, { key: name, name, field: f[name], ...common })
        const { providerId, quotaSpec } = planContext(f, state, catalog)
        const pricing = state && state.pricing
        const fields = ADVANCED_FIELDS.filter(name => (features.tray || !TRAY_FIELDS.includes(name)) && (features.menuBarTitle || name !== 'showSpendInTitle'))
        const changed = fields.filter(name => f[name].overridden).length
        return h('section', { style: S.advanced },
          h(Disclosure, { id: 'advanced', big: true, title: t('advanced'), hint: t('advancedHint'), badge: changed ? t('advancedChanged').replace('{n}', String(changed)) : undefined },
            h(Group, { title: t('groupNotify') },
              h(ChoiceRow, { name: 'channel', field: f.channel, hint: 'channelHint', ...common, options: [['auto', 'channelAuto'], ['client', 'channelClient'], ['system', 'channelSystem'], ['both', 'channelBoth'], ['off', 'channelOff']] }),
              toggle('suppressWhenFocused')),
            features.tray ? h(Group, { title: t('groupTray') },
              features.menuBarTitle ? toggle('showSpendInTitle') : null,
              h('div', { style: S.fieldGap }, h(NumberField, { name: 'errorHoldMinutes', field: f.errorHoldMinutes, ...common }))) : null,
            h(Group, { title: t('groupSpend') },
              h(ChoiceRow, { name: 'spendSource', field: f.spendSource, hint: 'spendSourceHint', ...common, options: [['auto', 'spendAuto'], ['balance', 'spendBalance'], ['estimate', 'spendEstimate']] }),
              h(ChoiceRow, { name: 'currency', field: f.currency, ...common, options: [['CNY', 'CNY'], ['USD', 'USD']] }),
              h('div', { style: S.fieldGap }, h(NumberField, { name: 'balancePollMinutes', field: f.balancePollMinutes, ...common }))),
            h(Group, { title: t('groupPrice') },
              h(ChoiceRow, { name: 'priceSource', field: f.priceSource, hint: 'priceSourceHint', ...common, options: [['auto', 'priceAuto'], ['catalog', 'priceCatalog'], ['custom', 'priceCustom']] }),
              pricing && pricing.listed ? h('div', { style: S.fieldGap }, h('button', {
                type: 'button',
                style: S.button,
                disabled,
                onClick: () => {
                  edit('customInput', String(pricing.listed.input))
                  edit('customCacheRead', String(pricing.listed.cacheRead))
                  edit('customOutput', String(pricing.listed.output))
                  edit('customPriceCurrency', pricing.listed.currency)
                },
              }, t('fillCustom')), h('span', { style: { ...S.muted, ...S.mono, marginLeft: 8, fontSize: 12 } }, priceLine(pricing.listed, pricing.listed.currency))) : null,
              h('div', { style: S.grid },
                h(NumberField, { name: 'customInput', field: f.customInput, ...common }),
                h(NumberField, { name: 'customCacheRead', field: f.customCacheRead, ...common }),
                h(NumberField, { name: 'customOutput', field: f.customOutput, ...common })),
              h(ChoiceRow, { name: 'customPriceCurrency', field: f.customPriceCurrency, ...common, options: [['CNY', 'CNY'], ['USD', 'USD']] }),
              h('div', { style: S.fieldGap }, h(NumberField, { name: 'exchangeRate', field: f.exchangeRate, ...common }))),
            providerId !== 'none' ? h(Group, { title: t('groupQuota') },
              toggle('planAutoQuota'),
              h('div', { style: S.grid },
                h(NumberField, { name: 'quotaPollMinutes', field: f.quotaPollMinutes, ...common }),
                h(TextField, { name: 'planQuotaUrl', field: f.planQuotaUrl, placeholder: quotaSpec?.url ?? 'https://…', ...common }))) : null))
      }

      const PAGE_CSS = `
        .dnt-page { --dnt-accent: #5085b2; --dnt-border: color-mix(in srgb, currentColor 11%, transparent); height: 100%; min-height: 0; overflow-y: auto; }
        .dnt-content { max-width: 1040px; margin: auto; padding: 30px 26px 48px; }
        .dnt-hero { display: flex; align-items: center; gap: 18px; padding: 22px; margin-bottom: 24px; border-radius: 20px; background: linear-gradient(115deg, color-mix(in srgb, var(--dnt-accent) 12%, transparent), color-mix(in srgb, var(--dnt-accent) 2%, transparent)); border: 1px solid var(--dnt-border); }
        .dnt-mascot { box-sizing: border-box; width: 80px; height: 80px; padding: 8px; flex: none; border-radius: 22px; border: 1px solid var(--dnt-border); background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: 0 3px 10px #00000006; }
        .dnt-mascot-window { width: 100%; height: 100%; overflow: hidden; border-radius: 15px; background: #050505; }
        .dnt-mascot-sprite { display: block; width: 100%; height: 100%; object-fit: contain; transform-origin: center bottom; animation: dnt-peek 7s cubic-bezier(.22, 1, .36, 1) infinite; }
        .dnt-heading { margin: 0; font-size: 24px; font-weight: 650; letter-spacing: -.4px; }
        .dnt-subtitle { margin: 7px 0 10px; opacity: .62; font-size: 13px; line-height: 1.6; }
        .dnt-status { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; opacity: .8; }
        .dnt-status[data-busy=true] svg { animation: dnt-spin 1.4s linear infinite; }
        .dnt-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr)); gap: 18px; margin-bottom: 18px; }
        .dnt-card { min-width: 0; border: 1px solid var(--dnt-border); border-radius: 16px; padding: 20px; margin-bottom: 18px; background: var(--dsw-alias-bg-layer-1, transparent); transition: border-color .2s, box-shadow .2s; }
        .dnt-grid > .dnt-card { margin-bottom: 0; }
        .dnt-card:hover { border-color: color-mix(in srgb, var(--dnt-accent) 36%, transparent); box-shadow: 0 4px 18px #00000004; }
        .dnt-card-title { display: flex; align-items: center; gap: 9px; font-size: 14px; font-weight: 600; margin: 0 0 16px; }
        .dnt-section-icon { display: inline-flex; color: var(--dnt-accent); padding: 7px; border-radius: 10px; background: color-mix(in srgb, var(--dnt-accent) 9%, transparent); }
        .dnt-page button { transition: background .15s, opacity .15s; }
        .dnt-page button:hover:not(:disabled) { filter: brightness(.94); }
        .dnt-page button:focus-visible, .dnt-page select:focus-visible { outline: 2px solid var(--dnt-accent); outline-offset: 3px; }
        .dnt-update-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px; }
        .dnt-update-actions { display: flex; flex-wrap: wrap; gap: 8px; }
        .dnt-update-version { display: inline-flex; gap: 7px; font-size: 12px; font-weight: 500; margin-bottom: 8px; }
        .dnt-update-version span { padding: 3px 8px; border-radius: 6px; background: color-mix(in srgb, var(--dnt-accent) 9%, transparent); }
        .dnt-note { font-size: 12px; line-height: 1.6; opacity: .7; margin: 0; overflow-wrap: anywhere; }
        .dnt-alert { border-radius: 10px; padding: 10px 14px; margin-bottom: 16px; background: color-mix(in srgb, #d68036 10%, transparent); font-size: 13px; }
        @keyframes dnt-peek {
          0%, 8% { transform: translateY(32%); }
          13% { transform: translateY(0); }
          18% { transform: translateY(2%); }
          24%, 48% { transform: translateY(0); }
          76%, 100% { transform: translateY(32%); }
        }
        @keyframes dnt-spin { to { transform: rotate(360deg); } }
        @media (max-width: 1000px) { .dnt-grid { grid-template-columns: 1fr; } }
        @media (max-width: 600px) { .dnt-content { padding: 16px 12px 28px; } .dnt-hero { padding: 16px; gap: 10px; } .dnt-heading { font-size: 20px; } .dnt-mascot { width: 60px; height: 60px; padding: 6px; border-radius: 18px; } .dnt-mascot-window { border-radius: 11px; } .dnt-card { padding: 16px; } }
        @media (prefers-reduced-motion: reduce) { .dnt-page *, .dnt-page *::before { animation: none !important; transition: none !important; } }
      `

      function Icon({ name, size = 16 }) {
        const paths = {
          bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
          chart: 'M4 3v17h17M8 15v-4m5 4V7m5 8V4',
          settings: 'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6',
          update: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1',
          check: 'm5 12 4 4L19 6',
        }
        return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: paths[name] || paths.settings }))
      }

      function Page(props) {
        const liveData = useLive()
        const state = props.useNotifyTray(snapshot => snapshot)
        const busy = state.saving || state.dirty
        const status = !state.available ? 'unavailable' : !state.writable ? 'readOnly' : state.notice?.kind === 'saveFailed' ? 'saveFailed' : state.invalid ? 'fixSettings' : state.saving ? 'saving' : state.dirty ? 'pendingSave' : 'autoSave'
        return h('div', { className: 'dnt-page' },
          h('style', null, PAGE_CSS),
          h('div', { className: 'dnt-content' },
            h('header', { className: 'dnt-hero' },
              h(PeekingMascot),
              h('div', null,
                h('h1', { className: 'dnt-heading' }, props.t('title')),
                h('p', { className: 'dnt-subtitle' }, platformT(props.t, currentPlatform())('summary')),
                h('span', { className: 'dnt-status', role: 'status', 'data-busy': busy }, h(Icon, { name: busy ? 'update' : 'check', size: 13 }), props.t(status)))),
            h(FullPage, { ...props, liveData }),
            h(UpdatePanel, props)))
      }

      function PeekingMascot() {
        const [ready, setReady] = React.useState(false)
        return h('div', { className: 'dnt-mascot', 'aria-hidden': true },
          h('div', { className: 'dnt-mascot-window' },
            h('img', {
              className: 'dnt-mascot-sprite',
              src: 'notify-tray/mascot?v=peeking-2',
              alt: '',
              draggable: false,
              style: { animationPlayState: ready ? 'running' : 'paused' },
              onLoad: () => setReady(true),
            })))
      }

      function UpdatePanel(props) {
        const t = props.t
        const state = props.useNotifyUpdate(snapshot => snapshot)
        React.useEffect(() => { props.checkUpdate() }, [])
        const busy = state.phase === 'checking' || state.phase === 'updating'
        return h(Section, { title: t('updateTitle'), icon: 'update' },
          h('div', { className: 'dnt-update-row' },
            h('div', { style: { flex: '1 1 240px', minWidth: 0 } },
              state.installed ? h('div', { className: 'dnt-update-version' },
                h('span', null, `${t('installedVersion')} ${state.installed}`),
                state.candidate ? h('span', null, `${t('newVersion')} ${state.candidate}`) : null) : null,
              state.phase !== 'local' ? h('p', { className: 'dnt-note', role: 'status' }, t(`update_${state.phase}`)) : null,
              state.error ? h('p', { className: 'dnt-note', style: S.error, role: 'alert' }, state.error === 'updateSaveFirst' ? t(state.error) : state.error) : null),
            h('div', { className: 'dnt-update-actions' },
              h('button', { type: 'button', style: S.button, disabled: busy || state.phase === 'restart', onClick: props.checkUpdate }, t('checkUpdate')),
              state.phase === 'available' ? h('button', { type: 'button', style: { ...S.button, background: 'var(--dnt-accent)', color: '#fff', borderColor: 'transparent' }, onClick: props.installUpdate }, t('installUpdate')) : null)),
          h('p', { className: 'dnt-note', style: { marginTop: 12 } }, t('updateHint')))
      }

      function WhaleIcon({ size = 16 }) {
        return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
          h('path', { d: 'M3 12c0-3.3 2.7-6 6-6s6 2.7 6 6h2c0-2 1.5-3.5 4-4v5c0 4-4 7-9 7s-9-3-9-8Z M8.5 11a1 1 0 1 0-2 0 1 1 0 0 0 2 0Z', fill: 'currentColor', fillRule: 'evenodd' }),
          h('path', { d: 'M10 5V2m0 3 3-2', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }))
      }

      function FullPage(props) {
        const state = props.useNotifyTray(snapshot => snapshot)
        const liveData = props.liveData
        const platform = currentPlatform()
        const features = (platform && FEATURES[platform]) || ALL_FEATURES
        const t = platformT(props.t, platform)
        const disabled = !state.writable
        const common = { t, disabled, edit: props.edit, resetField: props.resetField, flush: props.flush }
        const f = state.fields
        const toggle = name => h(ToggleRow, { key: name, name, field: f[name], ...common })
        const titleStyle = f.titleStyle.text || 'text'
        if (!state.available) return h('p', { role: 'status', className: 'dnt-alert' }, t('unavailable'))
        return h('div', null,
        !state.writable ? h('p', { role: 'status', className: 'dnt-alert' }, t('readOnly')) : null,
        state.notice?.kind === 'saveFailed' ? h('div', { role: 'alert', className: 'dnt-alert' }, t('saveFailed'), ' ',
          h('button', { type: 'button', style: S.button, disabled: state.saving || !state.writable || state.invalid, onClick: props.retrySave }, t('retrySave'))) : null,
        state.notice ? h(ui.Toast, { key: state.notice.id, text: t(state.notice.kind), tone: state.notice.kind === 'saved' ? 'success' : undefined, holdMs: 2200, onDone: () => { if (state.notice.kind === 'saved') props.dismissNotice(state.notice.id) } }) : null,
        h('div', { className: 'dnt-grid' },
        h(Section, { title: t('sectionNotify'), icon: 'bell' },
          h(CheckRow, { label: 'notifyWhen', names: NOTIFY_FIELDS, f, ...common }),
          toggle('sound')),
        features.tray ? h(Section, { title: t('sectionTray'), icon: 'settings' },
          toggle('tray'),
          h(TrayStatus, { t, state: liveData.state }),
          features.menuBarTitle ? h(ChoiceRow, { name: 'titleStyle', field: f.titleStyle, hint: `titleStyleHint_${titleStyle}`, ...common, options: [['text', 'titleText'], ['count', 'titleCount'], ['icon', 'titleIcon']] }) : null) : null),
        h(Section, { title: t('sectionMoney'), icon: 'chart' },
          h(SpendCard, { t, state: liveData.state }),
          h(PlanSection, { t, f, common, state: liveData.state, catalog: liveData.catalog })),
        h(AdvancedSection, { t, f, common, features, state: liveData.state, catalog: liveData.catalog }))
      }

      // ---- mount ------------------------------------------------------------------------------
      const t = ctx.locale.bind(LOCALE_NS)
      ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh: { ...zh, CNY: '¥ 人民币', USD: '$ 美元' }, en: { ...en, CNY: '¥ CNY', USD: '$ USD' } }), 'notify-tray: settings dictionaries')
      const card = new Controller(ctx.configForms.get(NS))
      const updater = new UpdateController(() => ctx.get?.('remote.pluginManager') || ctx.remote?.pluginManager, () => card.flush())
      ctx.effect(() => () => updater.dispose(), 'notify-tray: updates')
      ctx.effect(() => () => card.dispose(), 'notify-tray: settings form')
      // DSH owns sidebar navigation and README rendering on the plugin page.
      // Register no plugin-detail config/actions: settings have one entrance.
      ctx.inject(['layout'], pageCtx => {
        pageCtx.effect(() => pageCtx.configForms.whileServed([NS], () => {
          const stopMain = pageCtx.slots.inject('main', () => pageCtx.slots.register({
            name: 'main',
            key: PANEL_ID,
            locale: LOCALE_NS,
            inject: () => {
              const face = card.inject()
              return { ...face, hooks: { ...face.hooks, notifyUpdate: updater.store }, checkUpdate: () => updater.check(), installUpdate: () => updater.update() }
            },
          }, Page))
          const stopSidebar = pageCtx.slots.inject('sidebar.panellist', () => pageCtx.slots.register({
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 11,
            label: () => t('title'),
          }, WhaleIcon))
          return () => { stopSidebar(); stopMain() }
        }), 'notify-tray: sidebar settings')
      })
    }


    function apply(ctx) {
      var cursor = -1
      var boot
      var stopped = false
      var timer
      /** Focus at the previous poll: a window that just came forward claims the session a system toast announced. */
      var wasFocused = false

      function open(sessionId) {
        try { window.focus() } catch (e) {}
        try { ctx.uiWorkspace.openSession(sessionId) } catch (e) {
          console.warn('[dsh-notify-tray] 打开会话失败', e)
        }
      }

      /** Notifications this window put up, by key (session): the next one for a key replaces it. */
      var shown = {}

      function withdraw(notice) {
        var n = shown[notice.key]
        if (!n) return
        delete shown[notice.key]
        try { n.close() } catch (e) {}
      }

      function show(event, state) {
        if (event.kind === 'withdraw') return withdraw(event)
        if (typeof Notification === 'undefined') return
        if (state.suppressWhenFocused && document.hasFocus() && mainSessionId(ctx.sessions) === event.sessionId) return
        // Without permission the host is not told we listen, so it notifies itself.
        if (Notification.permission !== 'granted') return
        if (!claim(boot, event.seq)) return
        var display = event.display || { title: (state.titles[event.type] || 'DeepSeek Harness') + ' · ' + event.title, body: event.body }
        var key = event.key || event.sessionId
        // Same tag: the OS swaps the session's previous notification for this one.
        var n = new Notification(display.title, { body: display.body, tag: 'dsh-notify-tray:' + key, renotify: true })
        shown[key] = n
        n.onclose = function () { if (shown[key] === n) delete shown[key] }
        n.onclick = function () {
          n.close()
          // The renderer cannot move the OS foreground; the host brings the window forward where it can (Windows).
          fetch(RAISE_ROUTE, { method: 'POST', cache: 'no-store' }).catch(function () {})
          open(event.sessionId)
        }
      }

      function poll() {
        var granted = typeof Notification !== 'undefined' && Notification.permission === 'granted'
        var focused = typeof document !== 'undefined' && typeof document.hasFocus === 'function' && document.hasFocus()
        var claimToast = focused && !wasFocused
        wasFocused = focused
        fetch(ROUTE + '?lite=1&after=' + cursor + (granted ? '&notify=1' : '') + (claimToast ? '&claim=1' : ''), { headers: { accept: 'application/json' }, cache: 'no-store' })
          .then(function (res) { return res.ok ? res.json() : undefined })
          .then(function (state) {
            if (!state || stopped) return
            // Tray clicks first: the host hands each one out once, even on our first poll.
            for (var j = 0; j < state.focus.length; j += 1) open(state.focus[j])
            // First poll, or the host restarted (new boot id): adopt its cursor without replaying history.
            if (state.boot !== boot) { boot = state.boot; cursor = state.seq; return }
            for (var i = 0; i < state.events.length; i += 1) show(state.events[i], state)
            cursor = Math.max(cursor, state.seq)
          })
          .catch(function () {})
          .then(function () { if (!stopped) timer = setTimeout(poll, POLL_MS) })
      }

      // Browsers only show the permission prompt from a user gesture.
      if (typeof Notification !== 'undefined' && Notification.permission === 'default' && typeof document.addEventListener === 'function') {
        document.addEventListener('click', function () { Notification.requestPermission() }, { once: true })
      }

      poll()
      ctx.effect(function () {
        return function () { stopped = true; clearTimeout(timer) }
      }, 'notify-tray: poll')

      if (ctx.slots && ctx.locale && ctx.configForms) {
        try { mountSettingsPage(ctx, require) } catch (e) { console.warn('[dsh-notify-tray] 设置页挂载失败', e) }
      }
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
