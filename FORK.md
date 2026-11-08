# Donh fork 维护说明

这是 [donhac/dsh-notify-tray](https://github.com/donhac/dsh-notify-tray) 的自用维护分支，基于 [ROYLeXJ/dsh-notify-tray](https://github.com/ROYLeXJ/dsh-notify-tray)。当前 fork 版本为 `0.1.8-donh.1`。此版本不代表原作者发布，也不是原作者的更新通道；无需发布到 npm。

This is Donh's personal Goal-aware fork of ROYLeXJ's project. It retains the same package identity, author attribution, MIT license, and original icon. Install a verified local checkout or pin the fork to a commit/tag through DSH PluginManager. The upstream npm update channel does not distribute this fork.

## 来源、身份与许可

- 包名仍为 `dsh-notify-tray`，以替换同一插件并沿用设置与存储身份，避免两份插件同时运行。
- `author` 保留 `ROYLeXJ`；原作者与上游贡献者的署名、版权声明和 MIT 许可均保留。Donh 仅维护这里的 fork 改动，不以原作者身份发布。
- 现有原创 `icon.webp` 及其上游许可、署名要求继续保留，不替换或重新声明图标归属。包的 `license` 继续为 `MIT`。
- 仓库、主页与问题反馈链接指向 Donh fork；上游项目仍通过以上来源链接明确标注。
- 这是仓库维护与安装说明，不构成当前 DSH 实例已安装或已激活此版本的证明。

## 分支约定

| 分支 | 用途 |
|---|---|
| `master` | 仅跟随 `upstream/master`，不加入 Donh 的功能或元数据修改 |
| `donh` | 长期自用分支，合并上游和已验证的修复 |
| `fix/goal-aware-notifications` | Goal 续轮通知修复，基于 `donh` 开发并合回 `donh` |

`origin` 为 `https://github.com/donhac/dsh-notify-tray.git`，`upstream` 为 `https://github.com/ROYLeXJ/dsh-notify-tray.git`。通过 merge 保留来源历史，不 rebase 或强推已公开的分支。若 `master` 的 fast-forward 失败，先调查分叉原因，不强制重置或把 fork 改动合入它。

CI 的 push 分支覆盖 `master`、`donh` 和 `fix/**`；pull request 检查保持原有触发方式。

## Goal 感知行为

- 归属于 `active` Goal 的中间 turn 结束不产生完成提醒，也不增加完成任务计数；遗留 Goal 不会静默独立的人类问答。
- Goal 在所属 turn 内标记为 `complete` 后，等待该 turn 正常收尾，再产生一次完成结果。重复结束事件不重复通知或计数；外部手动状态变更不补发历史通知。仍遵循原有开关、聚合与当前会话抑制规则。
- Goal 为 `blocked`、需要用户处理时，走原有失败提醒开关，失败统计与最近任务记录采用相同判断。
- 普通问答、运行失败、批准、选择与文字输入保持原有行为。任务完成/失败统计跟随 Goal 判定，Token 用量与花费继续按实际消耗记录。
- 不新增设置项，不调整现有侧栏和设置布局。

## 本地安装与固定版本

维护工作仓库可直接作为安装来源，但切换分支或合并代码会改变其内容。长期运行建议使用独立、固定版本的 worktree。将下面的 `<commit-or-tag>` 换成已经验证且实际存在的提交哈希或 tag；同一个版本字符串可能对应多次未发布修改，提交哈希最明确。

```sh
git worktree add --detach /absolute/path/to/dsh-notify-tray-pinned <commit-or-tag>
```

在 DSH 原生 PluginManager 中安装这个 worktree 的绝对路径。使用 Agent 工具的调用形式为：

```json
{
  "action": "install_bundle",
  "target": "/absolute/path/to/dsh-notify-tray-pinned"
}
```

CLI 可使用：

```sh
dsh plugin --profile desktop add /absolute/path/to/dsh-notify-tray-pinned
```

Web 用户将 `desktop` 改成 `web`。如需直接固定 Git 来源，PluginManager 的 `target` 可指定为 `git+https://github.com/donhac/dsh-notify-tray.git#<commit-or-tag>`；该引用必须已存在于远端，不要依赖会移动的分支名来复现版本。

安装结果中的应用状态、警告及重启要求决定是否生效。安装后核对插件版本与来源，并验证通知行为；仅修改工作仓库或运行测试不等于已经安装。替换已安装插件可能需要重启对应 DSH 实例。

`dsh-notify-tray` 的 npm 正式版和设置页的在线更新卡片属于上游通道。本 fork 的更新方式是同步代码、验证、选择新的固定提交，再通过 PluginManager 安装；不用 `npm publish`，也不把 `0.1.8-donh.1` 当成已发布的 npm 版本。

## 同步与集成命令

以下命令供维护时使用，不会因为文档存在而自动执行。先确认工作区已提交或妥善保存；执行 merge 时按实际冲突处理，不重写公共历史。

同步纯净上游镜像，再合入自用分支：

```sh
git fetch upstream --prune
git switch master
git merge --ff-only upstream/master
git switch donh
git merge master
```

将自用分支的新上游改动带到现有修复分支，完成开发与验证后合回：

```sh
git switch fix/goal-aware-notifications
git merge donh
npm test
npm pack --dry-run --ignore-scripts
git switch donh
git merge --no-ff fix/goal-aware-notifications
npm test
```

确认合并结果后，由维护者按自己的提交、tag 和推送流程保存及发布 Git 引用。不要在 `master` 制作 fork 提交，不自动创建 npm 发布，也不把 merge 改成 rebase。固定安装目标时使用实际存在的 commit/tag。

## 检查与版本维护

现有项目要求 Node.js 20 或更新版本；CI 使用 Node.js 22 在 Linux、macOS、Windows 运行测试，并在 Linux 覆盖 Node.js 20。已有依赖环境下的检查命令：

```sh
npm test
npm pack --dry-run --ignore-scripts
git diff --check
```

Goal 相关回归应覆盖 active 多轮不误报、complete 后等待 turn 收尾、重复事件、blocked 失败提醒、旧 Goal 下的独立问答、普通失败/输入行为、重载时恢复已有轮次，以及通知与统计的一致性。测试结果不替代实际安装验证。

检查打包清单应包含运行文件、现有图标、locale、三份 README 与本说明。此次版本变更只手动更新 `package.json` 的 `version`、`package-lock.json` 顶层 `version` 和根包 `packages[""].version`，保持依赖锁定树不变。

不要为 fork 版本变更运行 `npm version`：现有 `version` 生命周期脚本会运行 `scripts/sync-readme-version.mjs` 并自动 `git add` README，可能改到无关编号和暂存内容。手动定点更新版本及文档，审阅 diff 后再由维护者决定提交。
