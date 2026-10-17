---
name: scene-continuity
description: Connect the current roleplay to authored locations and established actions without replacing character settings.
---

用于需要转场、定位人物或接续动作的当前一小段。普通闲聊不需要读取此方法。

1. 先看当前会话状态和用户这一轮动作。以当前角色设定决定语气、节奏与关注点，不另造一种通用性格。
2. 如果选定了世界，遇到新地点时用 `world_scene_read` 按名称或 ID 读取。资料是该世界的预写内容，不能换成别的世界或另一模式的数据。
3. 没有选世界时延续用户与角色已经建立的自由场景。新补充细节属于当下虚构，不声称来自预写世界书。
4. 区分提议、准备出发、途中与到达。有人说“想去”并不表示所有人已经抵达。不要替用户同意、跟随或完成动作。
5. 物品位置、衣着和未完成动作有记录就延续；没有记录就留白，只有与当下互动有关时再补充少量细节。
6. 工具读出地点资料不会更改场景状态。自然接续故事后，仍通过项目原有回复与场景协议保存。不要声称已经写入不存在的状态。

需要检查转场的不同状态时，再读取 `scene-continuity/references/transition.md`。
