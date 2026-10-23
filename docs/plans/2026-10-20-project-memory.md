# 项目记忆：Project 侧绑定的共享知识空间

> 状态：设计已定稿，待实现。2026-10-20 由 ADA 整理自三轮外部咨询（opus×2、astra×1）与 Sir 的最终决策。
> 基线：[2026-10-09-context-and-memory.md](2026-10-09-context-and-memory.md) 的「记忆」节；本文只扩展，不推翻。

## 为什么

现有记忆只有两级：`bots/<botId>/`（私人）与 `team/`（全队共享）。真实事故：项目组 Bot（PM）的自动回顾把 10 条项目决策写进 team，后加入的无关 Bot 一出生读到全部项目内容——**记忆污染**。根因是没有「项目」维度，写入只能 own|team 二选一。

两条硬约束（Sir 定）：

1. **可上游合并**：贴合 ds-bot 零配置哲学，改动面小，对普通用户通用，不是个人 hack。
2. **零人工持续维护**：建 Bot/建项目时人工设置一次，之后由系统可靠自维护；人只处理例外。

设计立场（AI-native）：人需要「成员关系」是因为上下文装在脑子里、交接昂贵；Bot 的上下文随任务到达。所以**知识归属项目，出处随工作流；Bot 不「属于」项目，项目持有对 Bot 的引用**（依赖方向 project → bot）。这就是 Codex Desktop workspace 挂多目录的思路，但去掉主次——多项目引用同一个 Bot 是平等的能力作用域，每个会话只携带一个出处。

三轮咨询收敛的核心共识（opus 与 astra 独立得出）：

- **边界不由 agent 选择，由宿主代码按出处计算**；回顾 agent 只做二选一判断（「这条是项目内的还是私人的？」），二选一才可靠。
- **team 从「可自动写」收紧为「显式发布」**，自动回顾不再有写 team 的路径。
- **所有不变量由宿主代码执行**（幂等、查重、预算、引用校验），不靠 prompt 劝导；失败一律降级 own——宁可漏记，不可污染。

## 已定的行为

### Project 对象

- 每个项目有**不可变 `projectId`**（名称只是展示名）。
- 存储 `memory/projects/<id>/`：`MEMORY.md` + 主题文件，沿用现有格式与限额（条 300、主文件 4,000、主题 16,000、主题数 ≤40）。
- `project.json` 元数据：`{ id, name, desc(≤120), status: active|archived, createdAt, lastWriteAt, lastHitAt }`。
- **名册**：project → bot 引用列表。一个 Bot 可被任意多个项目引用，无上限、无主次；Bot 身上没有 `contexts` 之类的字段。
- 创建：仅 Main Bot 的 `project_create` 工具，且只在建队/建群的一次显式操作中发生（满足「初始化设置一次」）。新 Bot 不自行创建项目。
- 关闭：仅显式 `project_close` 才归档（不做活跃度自动归档，冷知识≠失效）。归档后不注入但仍可 recall；重新绑定自动恢复。

### 绑定与出处

- 群（room）创建/更新时可绑定 `projectId`；任务继承来源群的项目；Main Bot 派发可显式标注项目。普通聊天群不自动成为项目。
- **每次执行（会话）至多一个有效 projectId**，由出处链（task → room）解析后不可变。
- **无出处对话不猜项目**：只写 own。
- Bot 删除不删项目知识；项目重命名不改归属。

### 存储与注入

- 会话冻结的记忆段 = own `MEMORY.md` + team `MEMORY.md` + **当前出处项目的** `MEMORY.md`。总预算维持 ~8,000 字符（own 4,000 不变；team 与 project 共分另一半，具体拆分实现时定）。
- 无出处时注入与 0.1.7 完全一致（own+team），未使用项目功能的用户零感知。

### 权限矩阵（扩展后）

| | 自己的记忆 | 团队记忆 | 名册内/出处项目记忆 | 其他项目记忆 |
|---|---|---|---|---|
| 普通 Bot | 读写 | 读 | 读写（经 `remember`，按出处） | 不能读写 |
| 群管理员 | 读写 | 读写（沿用现行） | 读写 | 不能读写 |
| Main Bot | 读写 | 读写 | 读写 | 读写（用户要求时） |
| 用户（记忆面板） | 全部 | 全部 | 全部 | 全部 |

recall 检索范围 = own ∪ team ∪（名册内项目 ∪ 当前出处项目）。`remember`/`forget`/`recall` 仍是唯一读写 API。

### 回顾（记忆整理）循环

- 宿主按出处**填入 projectId，模型无权覆盖**。回顾输出固定 JSON：`{ target: own|project|skip, text, topic?, replaces? }`——**没有 team 选项**。
- 判断标准一句话：「一个新建的、做同样工作的 Bot 需要知道这条吗？」
- 解析失败、取值越界、出处缺失 → 一律落 own。宁可漏记，不可污染。
- 幂等：写入键 = 回合 ID + 候选序号，重复提交不重复落盘。
- 查重：写前 n-gram 相似度比对，>0.6 拒绝并返回旧条目，要求 `replaces:<id>` 改写。
- team 的唯一写入路径 = 用户明确要求时经 Main Bot 显式发布（`remember scope=team`，Main Bot 专属）。

### 整理（consolidation）

- 触发：项目 `MEMORY.md` 用量 ≥80%，或该项目累计 20 次写入；在下一次回顾时顺带触发，不新建定时器。
- 执行者：宿主派给该项目最近活跃的名册成员。
- 约束：产物每一行必须引用源条目 id；宿主校验所有 id 存在、总量 ≤60%、无凭空新增；整理前自动快照，校验通过后原子替换。整理只能合并与删除。
- 失败：重试一次，再失败才报告用户。

### 文件系统边界（新增硬要求）

- Bot 具备通用文件/shell 工具，理论上可绕过 remember/forget 直接读写 `memory/`。**scope 校验必须与文件访问边界同时落实**，否则一切机制形同虚设。
- dsh 部署侧：memory 根目录移出 Bot 工作可达范围或加 ACL；上游文档将此写为部署要求。

## 不变量清单（代码校验，逐条对应验收）

- I1 每次执行至多一个有效 projectId，出处解析后不可变。
- I2 回顾写 project 当且仅当出处=该 project；无出处 → own。
- I3 自动回顾产物中 `team` 为非法值，写入路径直接拒绝（Main Bot 也不能经回顾绕过）。
- I4 写入幂等：同回合 ID+序号重复提交不重复落盘。
- I5 MEMORY.md 超限拒绝写入，不静默截断。
- I6 整理产物行行引用存在的源 id，总量 ≤60%，快照 + 原子替换。
- I7 recall 的项目范围 = 名册内项目 ∪ 当前出处项目，越权拒绝。
- I8 归档项目不注入、可 recall；重新绑定自动恢复。
- I9 文件层：Bot 文件工具不可达 memory 根目录（dsh 侧 ACL；上游作为部署要求声明）。

## 验收

- 新 Bot 出生只读 own+team，不读任何项目记忆。
- 无出处对话的回顾产物落在 own；写 project 被拒。
- 越权 recall（非名册、无出处）被拒。
- 重试/重复提交不产生重复条目。
- 群绑定项目后，群内工作的回顾自动进项目记忆，名册成员下一个会话可见。
- 旧用户升级后（不建项目）：行为与 0.1.7 完全一致。
- 存量污染场景已由 Sir 侧一次性人工清理（2026-10-20 完成），升级路径无需再处理旧数据。

## 上游 story

> **「给项目一个共享记忆；同事自动继承，其他项目不受打扰。」**

- 修的是通用 bug：用户只要开第二个项目，就一定遇到跨项目记忆污染。
- 零配置：建队时 Main Bot 顺手建项目，用户不用学新概念。
- 贴合既有抽象：Main Bot 更像真正的管理者（守 team、开项目）；回顾依然全自动，只是从「写哪都行」变成「代码划好格子」。
- 不引入成员管理界面：对用户叫「项目」，代码里是 `projectId` + 名册引用。

## 实现落点

- `ds-bot/src/host/memory.js`：`dirOf`/`scopeKey` 加 projects 分支；`reviewEntries`、注入拼装、回顾 prompt 规则加第三段。
- `ds-bot/src/host/tools.js`：remember/forget/recall 的 scope 解析与权限校验。
- `ds-bot/src/host/constants.js`：新增 Main Bot 专属工具名 `project_create`/`project_close`。
- `ds-bot/src/host/store.js`：`state.projects` 表 + 迁移（无项目时为空 → 旧行为不变）。
- `ds-bot/src/host/groups.js` / `roster.js`：`room.projectId` 字段与校验；名册派生规则。
- `ds-bot/src/host/channel.js`：create-room/update-room 接受 projectId；project endpoints。
- 回顾调用处：输出改为固定 JSON schema。
- `ds-bot/client.js`：记忆面板第三段；建群/建 Bot 时的项目选择（新建/已有/不绑定）。

## 已知限制 / 未决

- team/project 的注入预算拆分（如 2,000+2,000）实现时定。
- `propose_team`（普通 Bot 建议发布 team）v1 不做，Main Bot 可代劳。
- 多群绑同一项目：只有记忆沉淀共享，群聊日志仍按群隔离；跨群上下文需求另议。
- 名册 v1 = 绑定该项目的群成员并集 + Main Bot 手动增删；独立名册字段可后置。

## 变更

- 2026-10-20 初版。设计来源：opus 两轮 + astra 一轮外部咨询；「project 侧绑定」转向由 Sir 提出（类比 Codex Desktop workspace 多目录挂载，去掉主次），三位顾问意见已收敛。
