# 希拉点缀素材 v2

仅在 `data-character-theme="shira-nocturne"` 生效。不是整张背景，也不改变布局。

## 已接入

- divider.png：输入栏顶部的小分割线，使用 alpha 蒙版着色。
- corner.png：聊天面板右下角卷纹，使用 alpha 蒙版着色；位于消息下层。
- petals-horizontal.png：日夜切换上方的静态小花瓣。
- petals-diagonal.png：聊天右边缘的缓慢飘动花瓣；不拦截点击，尊重减少动态偏好。

颜色与浓度在 `shira-layout.css` 的 Modular accents v2 段调整：
`--shira-ornament-color`、`--shira-ornament-opacity`、`--shira-corner-opacity`、
`--shira-flower-opacity`、`--shira-flower-filter`。花瓣保留原始配色，可以通过 filter 调整。
四张原始 PNG 均确认有 alpha 通道，最小 alpha 为 0。未覆盖旧素材。

## 来源与生成方向

使用内置 imagegen；不是外部 API 或 CLI。源图目录：
`C:/Users/Lenovo/.codex/generated_images/01a009ad-a452-7be3-941f-92a7738f2fa5/`

| 文件 | 源文件 | 提示方向 |
| --- | --- | --- |
| divider.png | exec-f5c3431a-eed1-45ca-a8b1-56e5ed541248.png | 单色哑光紫、空心心形尾线、水平细线，无立体光泽 |
| corner.png | exec-2e55ede3-b1c3-46a3-95a4-7c7671ab74b4.png | 单色平面 L 形卷曲边角、透明底、留白 |
| petals-horizontal.png | exec-ca59e74f-4959-4ab4-acb0-c190757dbdf5.png | 五片独立淡紫与梅色花瓣、横向微风、透明底 |
| petals-diagonal.png | exec-4f98bbbb-7601-4ec5-a943-144412ce2348.png | 五片独立花瓣、左上至右下飘落、透明底 |

魅魔印 `exec-fe1ebe74-3903-4b8e-a352-ed167906eab7.png` 没有 alpha，棋盘底纹已经写入像素，未接入。
