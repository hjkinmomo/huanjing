# 星音琴房 · 音源与图片署名

本目录包含 67 个本地无损 WAV，约 42.65 MiB。钢琴、竖琴、木吉他、长笛、木琴为 44,100 Hz、16 bit、单声道；大提琴为 Iowa 原始录音的 44,100 Hz、24 bit、立体声。使用时通过 Web Audio 输出，并生成少量立体声空间余响。没有把低码率 MP3 转码后称作高清音源。

## 音频来源与许可

- 整理与处理：Nicholaus P. Brosowsky / tonejs-instruments。
- 仓库：https://github.com/nbrosowsky/tonejs-instruments
- 固定提交：`622c2f1c32c8cfce4158ddc3eb26e518ddef37e5`
- 该仓库使用的 52 个采样许可：Creative Commons Attribution 3.0 Unported（CC BY 3.0）。https://creativecommons.org/licenses/by/3.0/
- 另 15 个大提琴采样直接来自 University of Iowa MIS。原作者在主页允许下载并用于任何项目，不设置用途限制。本项目保留作者、演奏者、工程人员及原始来源署名；不把该授权自行标成 CC0。
- 完整上游许可、来源说明和逐文件下载地址、SHA-256、格式、时长分别保存在 `upstream-LICENSE.md`、`upstream-sample-source-info.txt`、`sample-manifest.json`。
- 本项目自行实现音频引擎，未引入 Tone.js 或上游的加载器代码。

| 乐器 | 上游注明的原始来源 | 本地采样数 |
| --- | --- | --- |
| 钢琴 | Versilian Studios / VSCO 2 Community Edition；Sam Gossner、Simon Dalzell 等，按原来源说明署名 | 15 |
| 竖琴 | Versilian Studios / VSCO 2 Community Edition | 9 |
| 木吉他 | University of Iowa Musical Instrument Samples / Lawrence Fritts | 15 |
| 长笛 | Versilian Studios / VSCO 2 Community Edition | 7 |
| 大提琴 | University of Iowa MIS / Lawrence Fritts；Charles Quenoil (1923) cello，Yoo-Jung Chang 演奏；Shane Hoose、Brian Penkrot、Zach Zubow 录音 | 15 |
| 木琴 | Versilian Studios / VSCO 2 Community Edition | 6 |

Versilian Studios 原库：https://versilian-studios.com/vsco-community/
University of Iowa 原库：https://theremin.music.uiowa.edu/MIS.html
大提琴录音页：https://theremin.music.uiowa.edu/MIS-Pitches-2012/MISCello2012.html

Tonejs-instruments 上游已经做过修剪、音量匹配等处理；本项目保留这 52 个下载的 WAV 原字节。Iowa 大提琴从两个原始 AIFF 压缩包中提取，保持 24 bit 立体声 PCM，仅做 AIFF/WAV 字节序转换和有保护边界的首尾静音修剪，不重新采样、不使用有损编码。旧 Freesound 大提琴版本已经被替换，不作为本项目当前大提琴音源。

播放时做音量平衡、渐入渐出、长笛/大提琴循环区交叉淡化、轻混响和动态压缩；根据稳定录音片段的实测音高校准少量播放速率偏差，使不同乐器更容易一起演奏。该校准不改变原始 WAV 文件。派生演奏声与原始采样不同。

## 乐器配图

六张乐器插画由本项目使用内置 image_gen 生成，用作带图的乐器切换按钮。图片位于 `art/`；完整提示词和工具记录位于 `art/generation-prompts.json`。WebP 为生成图的尺寸与格式优化版本。

## 音色边界

这是适合陪伴应用、自由弹奏和轻游戏的真实采样乐器，不是专业演奏级多力度乐器库。当前无力度分层、真实踏板共振和 MIDI 输入。长笛与大提琴保留原录音的气息、弓弦纹理；钢琴、竖琴、木吉他、木琴按真实物理衰减，不通过反复重触发伪造无限长音。
