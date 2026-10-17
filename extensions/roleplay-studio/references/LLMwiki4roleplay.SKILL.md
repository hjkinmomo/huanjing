---
name: LLMwiki4roleplay
description: 把小说 .txt 增量构建为 Obsidian 知识图谱，并以此驱动角色扮演对话。适用于用户想为一本小说建立可浏览的人物/地点/事件百科，或想以书中角色身份对话的场景。
---

# LLM Wiki Skill

把小说逐章增量构建为 Obsidian 知识图谱，并以此驱动角色扮演。**Agent 是大脑，工具是手**：Agent 决策每章创建/更新哪些实体、如何写叙事、如何拼接上下文；工具只做无副作用的文件 IO。

Skill 目录布局：

```
.claude/skills/LLMwiki4roleplay/
├── SKILL.md              # 本文件
├── scripts/
│   └── llmwiki_tool.py   # 所有工具的 CLI 入口
├── reference/
│   └── prompts.md        # 三个 prompt 模板（按需读）
└── llmwiki/              # Python 包（脚本内部 import）
```

## 语言约定

- 本 skill 内置提示词与叙事正文一律使用**中文**。
- Roleplay 时回复语言跟随**用户当前对话语种**。

## 工具调用（CLI）

统一入口 `python .claude/skills/LLMwiki4roleplay/scripts/llmwiki_tool.py <command>`。所有命令都返回 JSON。跑 `--help` 看完整参数。

## 预处理

| 命令 | 作用 |
|------|------|
| `split-book --file X.txt [--plan]` | 切章；`--plan` 返回分批计划 |

## 核心实体工具

| 命令 | 作用 |
|------|------|
| `create-entity --id ID --name N --type T --summary S --content-file F --vault V [--alias A ...] [--parent P] [--age A] [--birth B] [--death D] [--era E] [--start S] [--end E]` | 新建实体 .md；有 parent 则写入团队索引 |
| `update-entity --id ID [--section '## X'] --content-file F --vault V [--replace] [--summary S] [--age/birth/death/era/start/end]` | 更新实体：追加到 section / `--replace` 替换全文 / 可选更新 frontmatter |
| `search-entities --query Q --vault V [--recency] [--limit N] [--parent-scope P]` | 搜索实体（index-based）；`--parent-scope` 限团队范围 |
| `get-entity --id ID --vault V` | 读实体完整内容 |
| `get-linked --id ID --vault V` | 解析正文 wikilink 反查 id（保底工具） |
| `rename-entity --id OLD --new-id NEW [--new-name N] --vault V` | 重命名实体，旧名自动入 aliases |
| `append-log --operation OP --description D --vault V` | 追加 log.md |

## Roleplay 专用

| 命令 | 作用 |
|------|------|
| `roleplay-context --character-id ID --book-vault V [--memory-vault M]` | 起点拼接：返回 entity + team_index + memory 全貌 + death_context |
| `entity-context --id ID --vault V [--reader R]` | 带知识边界读取 entity；外团队 character 只返 reader 叙事中的相关段落 |

## 记忆与辅助

| 命令 | 作用 |
|------|------|
| `append-history --content C --vault V` | 追加对话行 + 时间戳，返回行数 + 是否达阈值 |
| `read-progress --vault V` / `write-progress --vault V --data JSON` | .progress 文件读写 |
| `cleanup-memories --vault V` | LRU 淘汰最旧实体（保留 200 个，protected 跳过） |

**长内容传参**：`create-entity` / `update-entity` 的 `--content-file` 从文件读取，避免 shell 转义。先用 Write 把 markdown 正文写到临时文件，再传路径。

**类型枚举**：`--type` ∈ `{character, location, item, event}`。

**id 规则**：kebab-case（如 `harry-potter`），全小写、连字符分词。跨系统文件名兼容。

## Ingest 工作流

用户目标：把小说 txt 变成 vault。

### 模式判断

```
1. split-book --file <novel.txt> --plan 拿到分批计划。
2. 检查 vault 是否存在且含 index.md：
   ├── 否 → 首次 ingest（从 batch 0 开始）
   └── 是 → 续跑模式
         读 vault/.progress → 从 last_chapter+1 章继续
         读 index.md 了解现有实体
3. 每轮处理一个 batch。batch 结束 → 更新 .progress → 告知用户进度。
   下次说"继续" → 从断点续跑。
```

> 续集（同世界观追加新书）和断点续跑是同一个流程——section 建议按书组织（"## 第二部"），时间字段新书更精确时覆盖旧值。

### 逐章处理

每章的实体抽取/创建/更新逻辑不变：

1. 读章节原文（按 `body_len` 决定用 `Read` 一次读完还是分段读）。
2. 按 `reference/prompts.md` 的"实体抽取 prompt"识别本章的新实体和更新点——prompt 中已包含 index.md 的现有实体列表，Agent 在识别阶段直接判断每个候选是新实体还是已有实体的补充。
4. **新实体** → `create-entity`
   - `--type` 决定可选时间字段：character → `--age`/`--birth`/`--death`/`--era`；event → `--start`/`--end`；location/item 无时间字段。
   - `--alias` 收集所有称呼（可重复传）。
   - `--summary` ≤ 80 字，一句话简介。
   - `--content` 或 `--content-file` 传写好的叙事段落，含 `[[wikilink]]`。
5. **已有实体新信息** → 先 `get-entity` 读全页，再决定：
   - **简单追加**：新信息可归入已有 section → `update-entity --section "## 废墟死城"`
   - **重构 section**：多次更新后 section 杂乱，或新信息改变了叙事结构 → Agent 重写整个正文（含合理 section 划分），用 `update-entity --replace --content-file ...`
   - 发现更精确的时间信息时，可用 `--age`/`--birth`/`--death`/`--era`/`--start`/`--end` 覆盖旧值。
6. 全章结束 → `append-log --operation ingest --description "Ch{n}: 新增 X, Y | 更新 Z"`。
7. **身份揭示**：若本章揭示了一个已有实体的真名，调 `rename-entity`。
8. **超长检查**：`update-entity` 返回 `needs_split: true` 时，在下一章之前将该实体的正文当作一章来 ingest，流程和逐章处理一致，仅两点不同：

   - **去重看 `_index-{主id}.md`**：实体抽取 prompt 不变，但 `{existing_entities_summary}` 填入团队索引内容而非全局 index.md，Agent 从团队现有衍生列表中判断新/旧
   - **新实体写入团队索引**：`create-entity --parent {主id}` 自动写入 `_index-{主id}.md`，不碰全局 index.md
   - 衍生 id 命名：`{主id}-{主题}`，如 `qi-xia-lie-game`

   处理完后用 `update-entity --replace --summary "新摘要"` 把主文档正文改为精炼叙事 + wikilink。压缩时尽可能保留原文档中的交叉引用，避免丢失导航路径。`--replace` 只有在让正文变短时才豁免超长检查（避免压缩后立刻被重新标记、陷入死循环）；正文不变或变长的 `--replace`（如一般 section 重组）仍会触发检查。清空 `.pending-splits.json`。

### 分批结束与断点续跑

每轮会话达到目标章数后：

1. 调 `write-progress --vault ... --data '{"last_chapter":140,"total_entities":487}'`。
2. 告知用户："已完成 Ch{n1}-{n2}/{total}，共 {total_entities} 个实体。下次说'继续'从 Ch{n2+1} 开始。"
3. 下次用户说"继续" → 调 `read-progress` → 从 `last_chapter+1` 章继续。

## Roleplay 工作流

用户目标：以某个角色的身份回答问题。

角色扮演有两套记忆，物理隔离：

```
roleplay/vaults/{name}/          →  书 vault：角色的"长期记忆"（原作事实，只读）
roleplay/memories/{name}/{角色id}/ →  记忆 vault：角色的"交往记忆"（对话历史）
```

记忆 vault 每角色独立子目录。容量上限 200 个 `.md`，超限时 LRU 淘汰（`protected: true` 跳过）。

---

### 1. 查记忆，判断首聊还是续聊

检查 `roleplay/memories/{vault名}/{角色id}/` 是否存在 → 分支 A（续聊）/ 分支 B（首聊）。

---

### 2. 书籍记忆查找（wikilink 图遍历）

**起点**：`roleplay-context` 返回的角色主 `.md` + `_index-{角色id}.md`。

从起点文档中收集 `[[wikilink]]`，根据用户对话逐轮选择最有希望的继续读。使用 `entity-context --reader {角色id}` 读取——工具自动执行知识边界：
- 同一团队 → 全文，wikilink 保留
- 外团队非 character → 全文，wikilink 转纯文本（不能往下追）
- 外团队 character → 只返回本角色叙事中涉及该人的段落

**配额**：最多 3 轮，总共最多 5 个 `.md`（跨轮累计）。

---

### 3. 对话记忆查找（wikilink 图遍历）

**起点**：`roleplay-context` 返回的 memory `index.md`。同样 wikilink 遍历，独立计算配额（最多 3 轮 / 5 个 `.md`）。记忆 vault 无知识边界限制。

---

### 4. 配额耗尽

| 判断 | 角色回应 |
|------|------|
| 线索还在 | "让我再想想……" |
| 无线索 | "我不太清楚" |

不可 OOC。

---

### 分支 A：续聊

```
A1. roleplay-context --character-id {id} --book-vault ... --memory-vault ...
A2. 以上述 wikilink 遍历规则进一步阅读
A3. 按 prompts.md 模板组装上下文 → 角色口吻回复
A4. append-history
```

### 分支 B：首聊

```
B1. roleplay-context --character-id {id} --book-vault ... --memory-vault ""
B2. 以上述 wikilink 遍历规则进一步阅读
B3. 死亡检查 → 选扮演时间点
B4. 按 prompts.md 模板组装上下文 → 角色口吻回复
B5. 写记忆（首次初始化）：建目录 + 已死角色建设定实体 + 首次 append-history
```

首次选定的扮演时间点持久化后，下次进来就是分支 A。

---

### 写记忆（每次回复后必须执行）

1. `append-history --content "..." --vault roleplay/memories/{vault名}/{角色id}/`
2. 若返回 `should_ingest: true` → memory ingest（识别主题 → create-entity/update-entity → **确保 user-self.md 存在** → 清空 history.txt）
3. `cleanup-memories --vault ...`（超 200 个自动淘汰）

## /who 命令

用户输入 `/who` 时：

1. 用当前角色 id `get-entity` 拿 frontmatter + 正文。
2. 按 `reference/prompts.md` 的 "/who prompt" 输出一句话简介，格式：

   ```
   {name}
   {aliases 中最常用称号}
   {一句话身份 / 所属 / 关键关系}
   详见: {vault}/{id}.md
   ```

   若角色已死，标注死亡和在用的扮演时段（从记忆 vault 中读取，而非每次重新推断）：

   ```
   † 已故（{death}）| 扮演时段: {chosen_time}
   ```
## 叙事写作规范

实体页面正文采用连贯叙事风格，不是百科条目。**新实体从第一次创建就按 section 组织**——不要写一整段平铺的总结，后面再用 update 补 section。

- 好：`## 说谎者游戏\n\n李尚武自称内蒙古刑警……\n\n## 废墟死城\n\n逃出密室后，李尚武选择留在[[便利店]]……`
- 坏：一整段不分 section 的总结

- 好：`Harry 在霍格沃茨特快列车上第一次遇到 [[Ron Weasley]]。两人很快成为最好的朋友。`
- 坏：`好友: Ron Weasley, Hermione Granger`

不抽显式关系类型（朋友/敌人/父子）。关系含义由 `[[wikilink]]` 周围的叙述自然承载。

## 实体去重指南

同一实体的不同称呼合并到已有实体（不新建）：

- 全名与简称：`Albus Dumbledore` = `Dumbledore`
- 称号：`Harry Potter` = `The Boy Who Lived`
- 化名：`Lord Voldemort` = `Tom Riddle` = `You-Know-Who`

判定为已有实体时，正文优先用 `[[id|显示名]]` 格式，id 直接定位；中文名则靠 `search-entities` 匹配 frontmatter 的 name/aliases。

