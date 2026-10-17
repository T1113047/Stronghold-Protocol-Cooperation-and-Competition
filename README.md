# 卫戍协议：狩猎模拟 · Stronghold Protocol: Hunt Simulation

《明日方舟》季节性自走棋塔防玩法「卫戍协议：盟约」的**非官方同人复刻**，浏览器即开即玩：既保留 1–4 人的合作模式，也在上游基础上扩展出**两支双人小队（2V2）**的「**狩猎模拟**」模式——每轮休整期结束后进入**狩猎期**，给对面派去猎物，击杀猎物为己方赢得赏金。

> **本仓库：《卫戍协议：狩猎模拟》 · *Stronghold Protocol: Hunt Simulation***
>
> 这是在 [sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol) **v0.2.6** 基础上开发的**非官方 2V2 衍生版**：把原本 1–4 人的合作玩法扩展为**两支双人小队**的「**2V2 + 狩猎期**」模式，并内置了一批局内交流、统计与画面 / 性能能力。代码同样以 **GPL-3.0-or-later** 发布，同样**非官方、非商业、不含游戏素材**；上游的全部声明与限制继续适用（见下）。上游作者与贡献者的著作权与署名一并保留（详见 [NOTICE.md](NOTICE.md)）。
>
> **本作版本号：`V0.0.1（0.2.6）`** —— 本衍生版的第 1 版，基于上游 **0.2.6**。

## 🙏 原项目与原作者（请先支持上游）

本仓库是 **[sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol)** 的 **2V2 衍生版**。原版的完整合作玩法、规则复刻、战斗模拟、素材工具与全部文档，都出自原作者 **[@sganggs](https://github.com/sganggs)** 与上游贡献者；**没有原项目就没有本衍生版**。本仓库只在上游之上增加了 2V2「狩猎模拟」模式（含狩猎期）与一批局内能力，其余内容与上游一致。

👉 **请优先 Star、关注并使用原项目，把支持给到原作者：**

| 入口 | 链接 |
|---|---|
| ⭐ 原仓库（**Star 请点这里**） | https://github.com/sganggs/Stronghold-Protocol |
| 👤 原作者 | https://github.com/sganggs |
| 📦 原版整合包 / Releases | https://github.com/sganggs/Stronghold-Protocol/releases |
| 📖 原版玩法指南 | https://github.com/sganggs/Stronghold-Protocol/blob/master/docs/PLAYING.md |
| 🐞 上游问题反馈 | https://github.com/sganggs/Stronghold-Protocol/issues |

> 只想体验原版的话，请直接使用上面的原仓库；本衍生版仅在你需要 2V2（狩猎模拟）时使用。本衍生版源码仓库：<https://github.com/T1113047/Stronghold-Protocol-Hunt-Simulation>。

![version](https://img.shields.io/badge/version-0.2.6-2ea44f)
![fork](https://img.shields.io/badge/fork-V0.0.1（0.2.6）-8957e5)
![license](https://img.shields.io/badge/code%20license-GPL--3.0--or--later-blue)
![node](https://img.shields.io/badge/node-22%20%7C%2024-339933)

## 声明

> [!IMPORTANT]
> - 本项目是玩家自制的**非官方同人作品**，与上海鹰角网络科技有限公司（Hypergryph）、Yostar 及其关联方**没有任何关系**，未获其授权或认可。
> - 《明日方舟》及「卫戍协议」相关的名称、角色、美术、音乐、音效、文本与数据等素材，版权归原权利人所有。这些素材**不适用**本项目的 GPL-3.0 许可证；GPL 只覆盖本项目自己编写的代码。
> - 仅供学习交流与个人非商业使用。**严禁任何形式的盈利**，包括但不限于：售卖本项目或整合包、付费下载或付费分发、收费服务器或收费代开、广告 / 打赏 / 会员等变现方式，以及其他任何商业用途。
> - 仓库源码不包含游戏的美术与音频素材（只有由官方数据表生成的数据和几张游戏截图，同样不适用 GPL）；[Releases](../../releases/latest) 中的完整包为了方便玩家附带了素材（精简包不带，首次启动时从公开镜像下载），下载即视为同意本声明。请勿将素材用于本项目以外的用途或单独再分发。完整条款见 [NOTICE.md](NOTICE.md)。
> - 权利人如认为本项目侵犯其权益，请通过 Issue 联系，我们会**立即删除**相关内容。
> - 本项目按「现状」提供，**不提供任何担保**，使用风险自负。

English summary: [below](#english).

| 同盟房间 | 策略轮选 | 休整期（商店 / 盟约） |
|---|---|---|
| ![房间](docs/img/room.jpg) | ![策略](docs/img/band-draft.jpg) | ![休整期](docs/img/prep.jpg) |
| **部署方向轮盘** | **作战** | **最终攻势** |
| ![方向](docs/img/facing-wheel.jpg) | ![作战](docs/img/combat.jpg) | ![最终攻势](docs/img/final-assault.jpg) |

## 目录

- [声明](#声明) · [简介](#简介) · [玩法：狩猎模拟（2V2）与狩猎期](#玩法狩猎模拟2v2与狩猎期) · [功能一览](#功能一览)
- [快速开始](#快速开始)：[整合包](#方式一整合包推荐) · [从源码运行](#方式二从源码运行) · [系统要求](#系统要求) · [端口与配置](#端口与配置) · [局域网联机](#和朋友一起玩局域网)
- [联机方式](#联机方式) · [操作](#操作) · [文档](#文档) · [开发与测试](#开发与测试) · [项目结构](#项目结构)
- [许可证](#许可证) · [致谢与数据来源](#致谢与数据来源) · [贡献](#贡献)

## 简介

「卫戍协议：盟约」是自走棋 + 塔防：休整期在调度中心招募干员、摆阵、配装备，作战期干员自动部署，迎击从红门涌来的敌人，漏过去的敌人扣目标生命值。本项目在浏览器里复刻了这一玩法，规则和数值尽量对照官方数据表与 PRTS 核对。

- **三种模式**：**独立狩猎**（单人）、**同盟狩猎**（1–4 人**合作**）、以及本衍生版新增的 **狩猎模拟（2V2）**。狩猎模拟里 4 个座位分成**两支双人小队**（座位 0 / 1 为一队，2 / 3 为另一队），空位可以加 AI 队友。
- **狩猎期（本作核心差异）**：从抽到的对抗回合起，每个普通（非首领）回合在双方休整期结束后、作战开始前进入狩猎期——双方各提交一份**悬赏名单**，把怪投放到**对面**的波次里。漏过去的怪**不扣目标生命、也不破坏「完美作战」**；**击杀对面投放的怪**才按价值表折算**赏金**。狩猎期结束会**弹出双方名单（含赏金）**。规则细节见[玩法：狩猎模拟（2V2）与狩猎期](#玩法狩猎模拟2v2与狩猎期)。
- **每队共享一条生命池**：顶栏我方 / 对面各显示一条共享 HP，另有一条每队自己的 Boss 血条；队伍同生共死，因此狩猎期的「一对一」配对始终成立。
- **队内隔离**：作战播报按队下发（看不到对面），准备期侦察限本队，策略也按队各一套。
- **服务器是一个 Node.js 程序，战斗在各玩家的浏览器里模拟**（和官方一样），服务器只管经济与回合，一台低功耗小主机就能开服。
- **本作内置**：快速匹配、局内文字聊天与违禁词过滤、对局记录落盘、全服通知横幅、伤害 / 治疗统计板、队友概览、干员素材预取，以及设置里的「画面自动调节」（2D / 3D 棋盘与角色模型开关）和按 GPU 自动降档。
- **账号体系**：本作正在加入账号体系（QQ 绑定 + 云存档 + 端到端加密），当前版本仍可直接匿名游玩。

<!-- TODO(账号线): A 落地后补齐账号章节（登录/绑定/云存档/加密/共享账号库） -->

仍有少数规则按推断实现，与官方不一致的地方欢迎在 Issue 里反馈。

## 玩法：狩猎模拟（2V2）与狩猎期

4 个座位分成**两支双人小队**：座位 0 / 1 为一队（team 0），2 / 3 为另一队（team 1）。空位可以加 AI 队友，AI 会照常招募、摆阵与投放怪物。

**共享生命池**：每队只有一条生命池（= 两名队员所选策略 HP 之和），顶栏我方 / 对面各显示一条；队伍同生共死，没有「只剩一名队员」的中间状态。

**狩猎期**：从本局抽到的对抗回合开始，每个普通（非首领）回合在双方休整期结束后进入狩猎期，分两步——

1. **选目标**：每个存活玩家点名自己这一轮要针对的**对面**玩家；队内**先到先得**（队友自动拿到剩下的那一个），于是两队一对一配对，人人既攻打也被攻打。这一步有一个短窗口，全部锁定即提前结束。
2. **定制怪物**：每人用自己的**价值预算**挑选怪，同一轮里**可以跨类型混搭**（只限总价值，不限数量、不限单组），每只怪选**上路 / 下路**，全部怪一起插在本轮波次的**靠前 / 靠中 / 靠后**（即本轮怪物数的 25% / 50% / 75%）三个位置之一。这一步的窗口等于本轮休整期，**全员提交即结束**；超时未提交的会由 **AI 自动投放**（挑放得下的组）。你投放的怪只会出现在**你选定的那个对手**的波次里。

- **怪物分组**：官方 **7 类「特训敌人」**（特异 / 飞行 / 频次 / 元素 / 持续 / 隐匿 / 折射），用官方的中文名与图标；分组只是「口味」，强度由价值预算约束。
- **替换比例**：起步 **5%**，每回合 **+2%**，上限 **15%**；**第 13 回合的「最终狩猎」回合固定 50%**（面板会标明）。比例同时决定预算（本轮波次价值 × 比例 × 倍率，按人计算）与被替换掉的原怪份额。
- **价值表与特性分档**：价值 = 按属性的打分（生命为主，攻击 / 防御 ×2，法抗 ×15，首领加成、每阻挡 60，飞行按 2 阻挡）+ **特性分档**（1 / 2 / 3 档，越「机制化」越贵）；特性部分**恰好占整张价值表的 30%**。
- **赏金**：**击杀对面投放的怪**才有赏金给击杀者——第 1–4 次狩猎期固定 **1 / 1 / 2 / 2 金**（按被清投放怪的比例、向下取整），第 5 次起按 **价值 ÷ 本轮波次价值 × 本轮收入 × `killIncomeShare`** 实时结算、不封顶；**R13「最终狩猎」固定 25 金**（同样按击杀比例，全清 25、杀一半 12）。**没有「每只至少 1 金」**，分母只算**投给这名玩家的投放怪**（普通波次怪不计）。
- **赏金 ≠ 金币（坎诺特）**：赏金**不进金币**，而是记在**商人「坎诺特」**的账上（每人一份、跨回合留存）；**休整期在坎诺特处取钱**是赏金变成金币的**唯一**通道——按回合比率（R8 及以前 **20%**、R9 **30%**、R10 起每回合 **+5%**、R15 **100%**），成本 = 金币 ÷ 比率，**每回合第一次取款向上取整、之后向下取整**，普通回合最多取 **4 金/回合**、R15 不限。官方「悬赏」卡的赏金仍照旧直接进金币。对面投放的怪**漏过去不扣目标生命、也不算破「完美作战」**——只有击杀才有收益。
- **交互**：队列里的怪**默认走下路**，**点一下换门**、**长按拖动排序**；「**沿用上轮**」把上一轮的编队按本轮预算重新装填，「**自动选择**」按价值贪心填满预算、之后仍可手改。
- **看得见来源**：对面投放的怪带**淡红描边**，脚下还有 `P<n>` 的**来源小字**（只作显示，不改归属）。
- **悬赏名单**：狩猎期一结束，会**弹出双方名单**（谁打谁、投放了什么、赏金多少）。

**首领链**：**第 14 回合「最终攻势」→ 第 15 回合「隐秘核心」**，两名队员共享同一片战场、共同削减**同一条领袖血条**。

## 功能一览

- **完整的一局**：确认本局信息 → 策略轮选（40 名策略）→ 14 回合 → 结算称号；险境及以上满足条件时进入第 15 回合「隐秘核心」。
- **4 种难度**：标准 / 险境 / 绝境 / 终极，独立与同盟各一套参数，均取自官方数据；2V2 沿用同盟的难度参数，差异由代码叠加。
- **狩猎模拟（2V2）与狩猎期**：两支双人小队、每队共享生命池、按轮进入狩猎期给对面派怪、击杀得赏金、悬赏名单公示；R14 / R15 两人共享战场。细节见上。
- **最终狩猎（第 13 回合）**：第 13 回合的狩猎期是一次**总攻**——替换比例固定 **50%**，赏金固定 **25 金**（按击杀比例折算，全清 25、杀一半 12），全场的投放都要在这一轮打出价值。
- **商人「坎诺特」（赏金 → 金币）**：击杀对面投放的怪拿到的**赏金不进金币**，而是记在坎诺特的账上（每人一份、跨回合保留）。休整期在**金币卡上方的坎诺特头像**处取钱是唯一的兑换通道：比率随回合变高（R8 及以前 **20%**、R9 **30%**、R10 起每回合 **+5%**、R15 **100%**），成本 = 金币 ÷ 比率（每回合第一次向上取整、之后向下取整），普通回合每回合最多取 **4 金**、R15 不限；面板给 1 / 2 / 4 / 全部四档，每档都写着要花多少赏金。
- **事件期（狩猎词条）**：一局 **3 次**，与狩猎期对齐（E1 = 本局首个狩猎期轮次 R4/5/6，E2 = E1+4，E3 = R13 最终狩猎）；每次**四选一**（对面 A / 对面 B / 队友 / 自己），**同一个目标一局只能用一次**；我方类型概率随次序递进（**E1 15 / 45 / 40、E2 30 / 40 / 30、E3 45 / 30 / 25**，减 / 中 / 增；给自己幅度 ×2），每次抽 **2 条**——24 条我方词条（局内不重复）和 12 条怪物词条（E1 35/40/25、E2 25/40/35、E3 20/35/45，只改敌人，不进入玩家属性与赏金）。每次另给该次序比例（10~15% / 15~20% / 20~25%）的普通怪与**赏金怪**附加一种**强力属性**；赏金怪的 `bounty.coins` 与击杀总额不变。
- **对面视角**：对手在 **R13「最终狩猎」之后（R14 最终攻势起）** 公开——对方成员的行、等级与上场数、他们的战场都能查看，之前只有一张共享生命池。
- **观众席看得见所有人**：每个房间另有 **2 个观战席**，**从第一回合起就能看任何人的阵地与战场**，不受「对手在 R14 前不可见」的限制；观战只读，不能购买、部署或准备。
- **快速匹配**：房主在房间里「开放匹配」后，其他博士可在大厅点「快速匹配」一键加入**同难度、未开局、有空座**的房间（人多优先 → 占座多 → 等最久；合作与 2V2 房都支持，单人房不能开放）。
- **局内文字聊天**：左下角聊天框，**Enter 发送**（2 秒冷却、单条上限 80 字，服务端清洗与截断）；观战只读；聊天气泡、未读红点、常驻展开。
- **违禁词过滤**：服务端权威，命中后替换为等长 `*`；词库从服务端配置读取，本仓库只带**示例占位词表**。
- **对局记录落盘**：每局一份，含参与者与结果，默认保留 **7 天**，记录带「游戏」标识。
- **全服通知横幅**：顶部一条醒目横幅，**20 秒自清**、可点击关闭。
- **伤害 / 治疗统计板**：显示本场战斗累计的伤害（黄）与治疗（蓝），**回血按来源速率归给提供者**。
- **队友概览**：观战 / 查看阵地时显示该干员的**生命 / 等级 / 上场**。
- **干员素材预取**：抓到干员的当下就预取头像与战斗模型，减少战斗首帧加载。
- **画面自动调节**：设置 →「画面质量」里默认开启；关掉后可分别选 **2D 棋盘（简化平面）/ 3D 棋盘**与**加载 / 不加载角色模型**，立即生效。
- **按 GPU 自动降档**：核显 / 软件渲染的机器默认「中」画质 + 2D，玩家显式选择优先。
- **过场延迟可调**：回合间等过场停顿可用环境变量调整，默认比上游更短（例如回合间由 2000 ms 降到 1000 ms）。
- **休整期**：招募、刷新、冻结、升级调度中心；整备区与临时整备区；从整备区拖到棋盘部署，用**方向轮盘**选择朝向。合作与 2V2 的卡池共用。
- **晋升精锐**：3 名同名干员自动合成精锐，并获得一次高一阶的免费招募。
- **干员与调配**：112 名可招募干员（+ 精锐）及其技能、天赋和特质；开局前可以为每名干员选择携带的技能（283 个技能全部手工实现）和精锐的模组。
- **盟约与层数**：23 个盟约（8 个势力核心盟约 + 附加盟约），层数整局保留，每个盟约最多 999 层。
- **装备与机变**：装备与法术，同名装备合成、特定组合赋予盟约效果；已配发的装备锁定在干员身上。部分回合开始前有机变选卡（装备、资金、干员、层数、悬赏等）。
- **自动作战**：技能按官方「技能策略」自动释放；按接触半径阻挡，阻挡者倒下时由接触的干员接替；元素损伤与元素爆发；召唤物由玩家手动摆放；推开 / 拉拽按力度与重量计算；被击倒的干员留在原地显示再部署倒计时。
- **地形与敌人**：阻隔工事、射击台、源石流吹风机、沼泽、排气格栅、涨潮等地形装置；空中与近地悬浮敌人、悬赏敌人。
- **联防**：有人漏怪、又有人完美作战时，完美作战的队友带着阵容帮忙拦截漏掉的敌人。
- **最终攻势与隐秘核心**：全队共享一个战场，共同削减同一条领袖血条；10 个敌方领袖，巨型领袖约 5×3 格的受击范围，以及官方的限伤规则。
- **结算称号**：卫戍之星、不朽盟约、坚若磐石等 6 个称号。
- **断线重连**：断线后座位保留，合作与 2V2 在 10 分钟内、独立狩猎在 24 小时内重新打开页面即可回到原座位；掉线期间作战按原编队由服务器接管，中途退出或「暂离」才交给 AI 托管（同一个浏览器，独立狩猎）。
- **交互细节**：漏怪时顶栏用红字 + 「−N」标记待扣的目标生命值（结算时才扣除）；点选、拖放和配发装备都按地上的方格；购买、升级和机变选卡都需要点两次确认；只有一名玩家时除作战外不计时。
- **画面与声音**：真实 Spine 小人、官方 BGM 与音效、表情（6 套 × 6 个）、作战特效；可选的官方 3D 棋盘（需要从本机客户端提取贴图）。
- **手机与电脑**：触摸拖拽、长按查看详情，推荐横屏；设置里可以调低画质。

## 快速开始

### 方式一：整合包（推荐）

[Releases](../../releases/latest) 里有几种整合包，代码和运行依赖完全相同，按需二选一；已经装好旧版本的，升级时只下载更新包即可：

- **完整包** `…-v<版本>.zip`（约 560 MB，解压后约 790 MB）：附带全部美术 / 音频（含中文、日文两套干员语音、官方 3D 棋盘贴图和各战场的官方场景），解压就能玩，不需要再下载任何东西。**推荐。**
- **精简包** `…-v<版本>-lite.zip`（约 22 MB）：不带素材，第一次启动时自动从公开镜像下载美术、Spine 模型、音频、字体、表情和「玩法说明」教程图（约 550 MB，可中断，再次启动会续传）；官方 3D 棋盘等本地客户端素材不在其中（见下面的「本地客户端素材」；各战场的官方场景可以用 `node tools/setup.mjs --scenes` 在本机下载并提取）。适合下载大文件不方便的情况。
- **更新包** `…-v<版本>-update.zip`（大小看改动多少，通常只有几 MB）：只含比之前的版本改动过的文件，用来把已经装好的旧版本升级到新版本，不用重新下载整个包。用法：先停止服务器（关掉窗口；装了开机自启的运行 `scripts\install-service-windows.ps1 -Stop`），把 zip 里程序文件夹的全部内容合并到安装文件夹、覆盖同名文件（Windows 资源管理器里复制粘贴即可；macOS 不要用访达拖放，它会整个替换文件夹，请用 `unzip -o`，见 [docs/DEPLOY.md](docs/DEPLOY.md) 第 1.5 节），再照常启动。启动时会先核对全部程序文件、删除新版本不再用的旧文件，然后正常运行；如果这个文件夹不是更新包对应的版本（或者程序文件被改过），会提示下载完整包，服务器不启动。全新安装请用完整包或精简包。

两种包都只含运行和部署需要的文件（服务器、客户端、数据、启动脚本、setup / doctor / 素材下载工具、许可证与说明、[docs/PLAYING.md](docs/PLAYING.md) 和 [docs/DEPLOY.md](docs/DEPLOY.md)）；测试、开发工具和设计文档只在源码仓库里。

1. **安装 Node.js 22 或 24（LTS）**
   - Windows：在 PowerShell 里运行 `winget install OpenJS.NodeJS.LTS`，或到 <https://nodejs.org/zh-cn/download> 下载安装包。
   - macOS：`brew install node@22`，或到官网下载安装包。
   - Linux：发行版的包管理器、nvm 或 fnm。
2. **下载**：在 [Releases](../../releases/latest) 页面下载最新版本的完整包（或精简包），解压到一个路径较短的文件夹（Windows 上建议不要放在 OneDrive 同步的目录里）。
3. **启动**
   - Windows：双击 **`scripts\start-windows.bat`**。如果弹出「安全警告」，点「运行」；Windows 防火墙弹窗请勾选「专用网络」并允许。
   - macOS / Linux：在解压出的文件夹里运行 `./scripts/start.sh`（或 `bash scripts/start.sh`）。
4. 浏览器会自动打开 `http://localhost:3000`。窗口里列出的局域网地址可以直接发给同一网络的朋友。关闭窗口（或按 `Ctrl+C`）即停止服务器。

### 方式二：从源码运行

```bash
git clone https://github.com/T1113047/Stronghold-Protocol-Hunt-Simulation.git
cd Stronghold-Protocol-Hunt-Simulation
npm install        # 安装依赖（postinstall 会把 pixi / preact / three 复制到 public/vendor）
npm run setup      # 检查环境，并从公开镜像下载约 550 MB 美术 / 音频（可中断，再次运行会续传）
npm start          # 启动服务器：http://localhost:3000
```

也可以直接运行启动脚本（Windows `scripts\start-windows.bat`，macOS / Linux `scripts/start.sh`）：首次会自动安装依赖、下载素材，然后启动服务器并打开浏览器。

- **本地客户端素材（可选）**：官方 3D 棋盘、部分官方界面图标（交流按钮与表情面板的边框、模组类型图标等）、灼热 / 炽焰源石虫和 39 个召唤物（多数自选召唤物）的官方模型需要从本机的《明日方舟》PC 客户端提取（Windows 原生客户端、macOS 的 CrossOver 或 PlayCover）。`npm run setup` 检测到客户端时会询问是否提取（需要 Python 3.8+，依赖装在项目内的 `.venv-extract`，不影响系统）；之后可以用 `node tools/setup.mjs --local` 重新提取，或用 `--game "<…/StreamingAssets/AB/Windows>"` 指定路径。没有客户端时游戏照常运行，这几样换成替代样式：2D 棋盘、样式相近的图标、染色的普通源石虫、召唤物头像。表情和「玩法说明」的教程图随上面的素材一起从公开镜像下载，不需要客户端。没有客户端的服务器（例如 Linux VPS）也可以从**同一版本**的整合包（完整包；精简包没有）里复制 `public/assets/local/` 和 `data/local-assets.json`，见 [docs/DEPLOY.md](docs/DEPLOY.md) 的「本地客户端素材」。
- 素材下载优先使用 GitHub，失败时自动改用 jsDelivr 镜像。
- `npm run doctor`（即 `node tools/doctor.mjs`）可以随时诊断：Node 版本、素材是否完整、端口占用、局域网地址和防火墙。

### 系统要求

| 项目 | 要求 |
|---|---|
| 开服的电脑 | Windows / macOS / Linux，Node.js 22 或 24（LTS）；磁盘约 700–850 MB（素材、依赖与本地提取贴图：完整包解压后约 790 MB）；内存空闲约 100 MB，每局再加几 MB |
| 玩家 | 支持 WebGL 的现代浏览器（Chrome / Edge / Firefox / Safari 最新版），电脑、手机或平板（横屏） |
| 网络 | 首次进入游戏时，每位玩家要从开服的电脑下载几十 MB 素材（之后走浏览器缓存）；对局中流量很小 |

显卡较弱时可以在「设置 → 画面质量」里调低画质（含「画面自动调节」开关），或在网址后加 `?board=2d|3d`（强制 2D / 3D 棋盘）/ `?render=fallback|engine`（强制使用 / 不使用简化的 DOM 画面）。3D 棋盘起不来时会**自动回落 2D 并提示**。

### 端口与配置

默认监听 **TCP 3000**。换端口：启动脚本加 `--port 3001`，或设置环境变量 `PORT`。

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口 |
| `HOST` | `::` | 监听地址。默认 `::` 是双栈：同一个端口同时接受 IPv6 和 IPv4；`0.0.0.0` = 只 IPv4；`127.0.0.1` = 只允许本机，放在反向代理后面时使用 |
| `SP_COMBAT` | `client` | `client`：各玩家浏览器模拟自己的战斗（服务器负载极低）；`server`：由服务器模拟并推流 |
| `SP_VERIFY` | `off` | 服务器复算客户端上报的战斗结果：`off` / `sample`（约 1/8 抽查）/ `all`（全部复算，更耗 CPU） |
| `TRUST_PROXY` | `auto` | 是否信任 `X-Forwarded-For` 等转发头：`auto` 只信任来自本机 / 内网的代理；`1` 总是；`0` 从不 |
| `DEBUG` | 空 | 设为任意值输出详细日志 |
| `SP_NO_BROWSER` | 空 | 设为 `1` 时启动脚本不自动打开浏览器 |
| `SP_BOT_EMOTES` | 空 | AI 队友的对局表情回应（战斗、整备、合成、联防、收礼时即刻的 `m.emote` 广播）；设为 `0` 时整体关闭 |
| `SP_ASSET_INDEX` | 空 | 素材地址带内容哈希、浏览器长期缓存（默认开启，哈希存在 `.cache/asset-hashes.json`）；设为 `0` 时关闭，素材清单原样下发 |
| `SP_DELAY_*` | 见下 | 过场停顿（毫秒）可调：`SP_DELAY_ROUND_START`（默认 1000，上游为 2000）、`SP_DELAY_COMBAT_END`、`SP_DELAY_SETTLE`、`SP_DELAY_BOT_ACTION`、`SP_DELAY_BOT_STAGGER`、`SP_DELAY_PUBLIC_THROTTLE` |

设置方式：macOS / Linux `PORT=8080 npm start`；PowerShell `$env:PORT=8080; npm start`；cmd `set "PORT=8080" && npm start`。健康检查：`GET /healthz`。

### 和朋友一起玩（局域网）

1. 打开页面 → 输入昵称 → 选择 **狩猎模拟（2V2）** 或 **同盟狩猎** → 创建房间。房主选择难度，可以添加 / 移除 AI 队友；开始前也可以把其他博士移出房间（对方可凭密钥重新加入）。想让陌生人一键加入，房主可以打开「**开放匹配**」。
2. 把 4 位字母的**房间密钥**，或「复制链接」得到的 `http://<地址>:3000/?room=密钥` 发给朋友；也可以让对方在大厅点「快速匹配」。
3. 所有人点「准备就绪」后房主开始。
4. 同一 Wi-Fi / 路由器下的朋友打开启动窗口里列出的地址（形如 `http://192.168.x.x:3000`）即可。打不开时多半是防火墙：Windows 首次启动时在弹窗中允许「专用网络」，或运行 `npm run doctor` 查看具体命令；访客 Wi-Fi 常开启「AP 隔离」，也会导致连不上。

刷新页面或断线后，合作与 2V2 在 10 分钟内、独立狩猎在 24 小时内重新打开即可回到原座位。服务器把房间和对局都保存在内存里，**重启服务器会结束所有对局**。

## 联机方式

朋友不在同一个局域网时，下面是几类常见做法，按自己的情况选一种即可。这里只做简单介绍，提到的工具和服务只是举例，本项目与它们没有任何关系，也不做推荐；具体的安装、费用和使用规则请以各自的官方说明为准。部署细节（防火墙、开机自启、反向代理与 HTTPS、Docker）见 **[docs/DEPLOY.md](docs/DEPLOY.md)**。

| 方式 | 怎么做 | 适合 |
|---|---|---|
| **同一局域网直连** | 把启动窗口里的局域网地址发给朋友 | 同一个家、宿舍或网吧 |
| **组网工具（虚拟局域网）** | 例如 Tailscale、ZeroTier、EasyTier、蒲公英：开服的人和朋友都安装同一个工具并加入同一个网络，朋友用开服电脑的虚拟 IP 访问 `http://<虚拟 IP>:3000` | 固定的几个熟人；不暴露到公网。朋友也要装客户端，部分工具需要注册账号；跨地区时可能走中继而变慢 |
| **内网穿透 / 隧道** | 只有开服的人运行客户端，朋友直接打开网址。例如自建的 frp（需要一台有公网 IP 的服务器）、Cloudflare 的 `cloudflared tunnel --url http://localhost:3000`（临时地址，每次启动都会变；国内访问延迟可能较高）、国内的樱花 frp 一类公共穿透服务（通常需要实名，大陆节点承载网页可能有备案要求） | 不想改路由器、没有公网 IP；免费线路带宽小时，首次加载素材会慢一些 |
| **云服务器 / VPS 直接部署** | 在 VPS 上运行整合包，或用仓库自带的 `Dockerfile`；用 Caddy / Nginx 加上 HTTPS。选离玩家近、线路好的地区（面向大陆玩家时，境外机房要关注回程线路，否则晚高峰延迟可能很高；大陆服务器绑定域名需要 ICP 备案） | 想长期开服、玩家分布在不同地区 |

通用注意事项：

- 游戏是**单个常驻 Node.js 进程 + WebSocket**（路径 `/ws`），只能跑一个实例，必须部署在域名根路径；Vercel 之类的 Serverless 平台和 GitHub Pages 之类的静态托管都不适用。反向代理要转发 WebSocket 升级。
- 从 CDN 节点打开时，游戏 WebSocket 会**直连源站**，绕开「玩家 → CDN → 源站」的中转（页面由源站直接打开时仍走同源）。
- 游戏没有账号系统（账号体系仍在开发中），**知道地址的人都能进来**。请只把地址发给朋友，不要公开发布，也不要搭建公开大厅；这同时能降低素材版权方面的风险。
- 有公网 IPv4 时也可以在路由器上做端口转发，但这会把家里的电脑直接暴露在公网上，优先考虑上面的方式。

## 操作

| 操作 | 方法 |
|---|---|
| 购买 / 升级调度中心 / 机变选卡 | 点一次选中，再点一次确认（`D` 升级） |
| 部署 / 移动干员 | 从整备区拖到棋盘格 → 出现方向轮盘 → 往上 / 右 / 下 / 左滑动选择朝向后松手；松在中心或点「✕ 点击取消」取消。拖动时指针 / 手指所在的格子就是落点，能放下时模型直接站在这一格上（不能放下时跟在指针下） |
| 调整朝向 | 把干员拖回它自己的格子，再选方向 |
| 出售 / 撤退 / 销毁装备 | 点击单位所在的格子 → 底部按钮「出售 +1」「撤退」；也可以把棋盘上的干员拖回整备区撤退。整备区里的装备与法术只能「销毁」，已配发的装备锁定在干员身上（干员出售或合成精锐时退回整备区） |
| 装备 | 把装备拖到干员所在的格子上（每人 2 件；满了会弹出替换窗口，被替换的一件会被销毁）；法术拖到地块上并选方向 |
| 查看详情 | 右键或长按单位 / 卡牌（属性为实时数值，高于基础值为绿色、低于为红色） |
| 快捷键 | `R` 刷新 · `F` 冻结 · `D` 升级 · `Q` 撤退 / `X` 出售选中的干员 · `Space` 准备就绪 · `Esc` 取消 / 关闭；除 `Esc` 外都可以在「设置 → 快捷键」里改成别的键（[玩法指南 §11](docs/PLAYING.md#11-快捷键)） |
| 方向轮盘键盘操作 | 方向键预览 · `Enter` 确认 · `Esc` 取消 |
| 局内聊天 | 左下角聊天框输入文字，按 **`Enter` 发送**（2 秒冷却、单条最多 80 字；观战只读）；点左上角图标可收起 / 展开，收起时有未读红点 |
| 快速匹配 / 开放匹配 | 大厅点「快速匹配」加入同难度、未开局、有空座且已**开放匹配**的房间；房主在房间里用「开放匹配」开关（单人房不能开放） |
| 查看队友概览 | 观战或准备期查看队友阵地时，底部条显示该干员的**生命 / 等级 / 上场** |
| 画面自动调节 | 设置 →「画面质量」：默认开启；关掉后可分别选 **2D 棋盘（简化平面）/ 3D 棋盘**与**加载 / 不加载角色模型**，立即生效（也可用网址参数 `?board=2d\|3d`、`?render=fallback\|engine`） |
| 暂停（独立狩猎） | 作战中（含最终攻势 / 隐秘核心）点顶栏的「暂停」或按 `Space`，再点「继续作战」（或 `Space`）继续；合作与 2V2 的作战不能暂停 |
| 表情 | 左下角「交流」，左右滑动（或方向键）换主题，冷却 1 秒 |
| 观战 | 自己的作战结束后（或休整期）点左侧队友头像 →「前往查看」；不参战的朋友可以在大厅输入房间密钥点「观战」（每个房间最多 2 名观战者，本作新增） |
| 统计（本机） | 标题画面右上角、大厅、等待室的「统计」：胜率、策略通过率、称号、战斗累计和对局记录（点一行回看结算页）；只存在本机浏览器里，可以导出 / 导入，没清完第一个回合就退出的对局不计入统计（[玩法指南 §12](docs/PLAYING.md#13-统计本机)） |

完整的规则、数值和小技巧见 **[docs/PLAYING.md](docs/PLAYING.md)**（游戏内左下角也有「玩法说明」）。

## 文档

| 文档 | 内容 |
|---|---|
| [CHANGELOG.md](CHANGELOG.md) | 更新记录：每个版本修复了什么、哪些反馈经核实不是问题 |
| [docs/PLAYING.md](docs/PLAYING.md) | 玩法指南：流程、经济、招募与晋升、摆阵、联防、盟约、最终攻势、结算称号 |
| [docs/DEPLOY.md](docs/DEPLOY.md) | 部署指南：Windows 开服与开机自启、防火墙、组网 / 隧道、反向代理与 HTTPS、Docker、systemd、排错 |
| [docs/WINDOWS.md](docs/WINDOWS.md) | Windows 便携包：怎么打一份「零安装」包（`scripts/make-windows-bundle.mjs`）、包里放了什么、授权注意事项 |
| [docs/DESIGN.md](docs/DESIGN.md) | 架构与契约（英文）：索引，按章节号找到文件；现行规则在 `docs/design/`（范围与目录分工、坐标与时间、战斗引擎、对局、网络协议、渲染与 UI），各次试玩和各版本的规则修订与依据在 `docs/history/` |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 代码地图（英文）：服务器、联机协议和前后端共用的战斗模拟，0.2.0 重构后的目录，数据流，黄金结果与导入边界，常见改动从哪里入手 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 参与贡献：准备环境、运行测试、忠实原则、提交与 PR 约定、怎样添加自选干员（中文，末尾附英文摘要） |
| [docs/SIM.md](docs/SIM.md) | 战斗模拟引擎参考（英文）：钩子、技能描述格式、职业默认行为 |
| [docs/META.md](docs/META.md) | 对局与经济引擎（英文）：回合流程、商店、联防、最终攻势的实现细节 |
| [docs/DATA.md](docs/DATA.md) | 由官方数据表生成的游戏数据（英文） |
| [docs/ASSETS.md](docs/ASSETS.md) | 素材来源、目录结构与清单（英文） |
| [docs/I18N.md](docs/I18N.md) | 界面语言（英文）：界面文字、游戏文本与服务器消息怎样翻译，覆盖范围；**添加一种语言只需在 `public/i18n/` 放一个语言文件**（社区翻译步骤见「Adding a language」，内容包格式见 [docs/PACKS.md](docs/PACKS.md)） |
| [docs/BALANCE.md](docs/BALANCE.md) | 难度模型与测量（英文） |
| [docs/research/](docs/research/00-INDEX.md) | 官方规则、数据与界面的调研记录 |

## 开发与测试

```bash
npm run dev                 # node --watch：改动服务器代码后自动重启
node --test                 # 单元 + 集成测试（约 3170 项；缺少素材 / 浏览器的用例会自动跳过）
SP_E2E=1 node --test test/ui/mock.e2e.test.js        # 浏览器端到端测试，需要本机 Chrome（CHROME_PATH 可指定路径）
SP_REAL_E2E=1 node --test test/ui/real.e2e.test.js   # 需要 Chrome + 已下载的素材
RENDER_E2E=1 node --test 'test/render/*.browser.test.js'   # 渲染测试，部分需要本地提取的棋盘贴图
GOLDEN_FULL=1 node --test test/golden.test.js           # 黄金结果：固定种子的整套战斗与人机对局摘要（默认只跑快速子集）
node tools/perfbench.mjs --cpu 1,4,6 --profile             # 真实战斗的帧耗时基准（Chrome 降速 CPU 近似中低端手机），需要 Chrome + 已下载的素材
```

- 游戏数据由 `npm run build-data`（`tools/build-data.mjs`）从官方数据表生成，不要手工修改 `data/*.json`。
- 性能测试：`/dev/battle-perf.html` 在浏览器里跑一场真实战斗（对局用的战斗运行器、模拟和渲染），实时显示帧率与逐帧耗时；在手机上打开后点击「开始测量（10 秒）」，生成的报告可以复制后附在反馈中。用到的战斗来自 `node tools/capture-specs.mjs` 从固定种子的机器人对局里截取的数据（`public/dev/perf/`）。
- 「设置」里的问题反馈会附带实时性能读数（帧率、逐帧耗时、GPU 与设备信息），方便排查卡顿。
- 只重构、不改玩法的提交不能改变 `test/golden/*.json`；有意改变玩法时运行 `npm run golden:update`，检查差异后随改动一起提交（见 [test/golden/README.md](test/golden/README.md)）。
- GitHub Actions（[.github/workflows/ci.yml](.github/workflows/ci.yml)）在 Ubuntu 与 Windows、Node 22 / 24 上运行 `npm ci`、`node --test` 和服务器冒烟测试。
- 代码怎么分层、改某个规则该从哪个文件入手，见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 项目结构

| 路径 | 内容 |
|---|---|
| `server/` | 入口 `index.js`；Node HTTP 静态服务 + WebSocket（`/ws`，代码在 `http/`）、大厅、对局引擎（`match/`）、战斗模拟（`sim/`，浏览器与服务器共用） |
| `shared/` | 前后端共用的常量与网络协议 |
| `public/` | 浏览器客户端（原生 ES 模块，PixiJS + pixi-spine、three.js 3D 棋盘、Preact + htm UI） |
| `data/` | 由官方数据表生成的游戏数据与素材清单 `assets.json` |
| `tools/` | `setup.mjs` / `doctor.mjs`、素材下载 `fetch-assets.mjs`、数据构建、本地提取 `local-extract/` |
| `scripts/` | 启动脚本（Windows / macOS / Linux）、Windows 开机自启 |
| `docs/` | 文档与调研 |
| `test/` | `node:test` 测试 |

## 许可证

- **代码**：本项目自己编写的代码以 **GPL-3.0-or-later** 发布，全文见 [LICENSE](LICENSE)；另附一条 GPL 第 7 条的附加许可，允许与 pixi-spine 中的 Spine Runtimes 组合分发（见 [NOTICE.md](NOTICE.md)）。
- **游戏素材不在许可范围内**：《明日方舟》相关的美术、音乐、音效、文本与数据等版权归原权利人所有，不适用 GPL，使用限制见上方的[声明](#声明)和 [NOTICE.md](NOTICE.md)。
- **第三方组件**各自遵循其许可证：通过 npm 安装的库（整合包的 `node_modules` 中附带各自的许可证文件）、`tools/local-extract/aklz4.py` 的算法（BSD-3-Clause），以及字体等，清单与许可证全文见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

## 致谢与数据来源

- 游戏数据：[Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData)。
- 素材来源：[yuanyan3060/ArknightsGameResource](https://github.com/yuanyan3060/ArknightsGameResource)、[fexli/ArknightsResource](https://github.com/fexli/ArknightsResource)、[isHarryh/Ark-Models](https://github.com/isHarryh/Ark-Models)、[ArknightsAssets/ArknightsAssets2](https://github.com/ArknightsAssets/ArknightsAssets2)；字体来自 [TimWangZi/The-font-of-Arknights](https://github.com/TimWangZi/The-font-of-Arknights) 与 Google Fonts（Noto Sans SC）。详见 [docs/ASSETS.md](docs/ASSETS.md)。
- 规则核对参考：[PRTS 明日方舟中文 Wiki](https://prts.wiki/)。
- LZ4AK 解包：`tools/local-extract/aklz4.py` 的算法来自 [isHarryh/Ark-Unpacker](https://github.com/isHarryh/Ark-Unpacker)（BSD-3-Clause，经 MooncellWiki/UnityPy）；解析 Unity 资源使用 [UnityPy](https://github.com/K0lb3/UnityPy)（MIT）。
- 库：[PixiJS](https://pixijs.com/)（MIT）、[pixi-spine](https://github.com/pixijs/spine)（MIT；其中包含的 Spine Runtime 另受 [Spine Runtimes License](https://esotericsoftware.com/spine-runtimes-license) 约束）、[three.js](https://threejs.org/)（MIT）、[Preact](https://preactjs.com/) + [htm](https://github.com/developit/htm)（MIT）、[ws](https://github.com/websockets/ws)（MIT）。

感谢以上项目的作者与维护者，以及鹰角网络带来的这款游戏。

## 贡献

欢迎提 Issue 反馈 bug、与官方规则不一致的地方或改进建议，也欢迎提交 Pull Request：

- 准备环境、运行测试、忠实原则和提交约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。
- 提交前请运行 `node --test`，并同步更新相关文档；文档使用简体中文，代码与注释使用英文。
- 提交的代码将以 GPL-3.0-or-later 发布。
- 请不要提交任何游戏素材文件（`public/assets/` 等目录已被 `.gitignore` 排除）。
- 本项目坚持非商业：请不要提交广告、付费、打赏等任何形式的变现功能。

---

## English

An **unofficial, non-commercial fan remake** of Arknights' seasonal auto-chess tower-defense **mode *Stronghold Protocol: Alliance***, played in the browser. This fork — **Stronghold Protocol: Hunt Simulation** (`V0.0.1`, built on upstream 0.2.6) — keeps the 1–4 player co-op and adds a **2V2 mode**: the four seats form **two duos** (seats 0/1 vs 2/3) that share one HP pool per team, and after each prep a **Bounty Phase** lets both sides loose monsters, drawn from the official 特训敌人 (training-enemy) groups, into the other team's wave. The monsters you place **leak for free** (no target HP lost, no broken perfect-clear), but killing the ones the opponent placed pays a **bounty** scaled from the value table (`killIncomeShare`); when the phase closes, both teams' lists — and the bounties — are revealed. Each team also fights a shared boss chain, Final Assault (R14) → Hidden Core (R15), on one battlefield against one leader HP bar.

- **Also built in**: in-match text chat with **server-side banned-word filtering**, per-match chat logs on disk (7-day retention), a **server-wide notice banner**, a **damage / healing board** (healing credited to whoever granted it), a **teammate overview** (HP / level / deployed), **operator asset prefetch**, and a **graphics auto-adjust** setting (2D/3D board + a character-model toggle, with GPU-based auto-downgrade).
- **Run:** download the full bundle `…-v<version>.zip` (~560 MB, all the art inside, the Chinese and Japanese operator voices and the official battlefield scenes included) from [Releases](../../releases/latest) — or the lite one, `…-v<version>-lite.zip` (~22 MB), which downloads the art (~550 MB) on its first start; the update bundle `…-v<version>-update.zip` holds only the files changed since the earlier releases: stop the server, extract it over an existing install and start again — install Node.js 22 or 24, then double-click `scripts\start-windows.bat` (Windows) or run `./scripts/start.sh` (macOS / Linux) and open <http://localhost:3000>. From source: `git clone https://github.com/T1113047/Stronghold-Protocol-Hunt-Simulation.git`, then `npm install && npm run setup && npm start` (setup downloads ~550 MB of art from public mirrors; the official 3D board and some HUD art come from a local Arknights client — without one the game uses the 2D board and look-alike stand-ins).
- **Languages:** Chinese (the default), English, 日本語, 한국어 and 繁體中文 — switch on the title screen or in Settings. Game texts come from the official clients; the Japanese, Korean and Traditional Chinese interface strings are machine translations (corrections welcome: [docs/I18N.md](docs/I18N.md)).
- **Play with friends:** create a room and share the 4-letter key or the `?room=KEY` link, or open the room to **quick match** so anyone can join a same-difficulty room in one click. On a LAN, use the address printed at start; otherwise use a virtual-LAN tool, a tunnel or a VPS — see [docs/DEPLOY.md](docs/DEPLOY.md).
- **Accounts:** a QQ-bound account system (cloud saves, end-to-end encryption) is being added; the current build still plays fully anonymously.
- **Disclaimer:** not affiliated with or endorsed by Hypergryph or Yostar. All Arknights names, art, audio, text and data are © their respective owners and are **not** covered by this project's GPL licence. For study and personal non-commercial use only — no selling, paid distribution, paid servers or monetisation of any kind. Content will be removed on request of the rights holders. Provided "as is", without warranty.
- **License:** code GPL-3.0-or-later ([LICENSE](LICENSE)); game assets excluded.
- **Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md) (an English summary at its end); the code map is [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
