# 独立前景素材

四张 atlas 由内置 imagegen 生成，真正 RGBA 透明底；分别参考希拉酒红晚装、可卡粉色格裙、书韵蓝色旗袍、希拉婚纱。产出八个独立飘带 PNG：酒红金边、粉色蕾丝、银枝刺绣、婚纱蕾丝，每组两条。

atlas 按两个独立物体的区域裁切并去除空白边缘；保留原始像素颜色与 Alpha，没有重新绘制人物或改动原画。源 atlas 与裁切记录保留于 `E:/hi-hermes/maintenance/project5-foreground-card-20261007/evidence` 和 `asset-slices.json`。生成源文件名、参考图和完整提示词见 [PROMPTS.md](PROMPTS.md)。

当前 12 套卡片复用与服装匹配的一组素材，并各自配置位置、尺寸、角度和深度。不是为每张立绘生成全新的角色或服装。素材为额外前景装饰，在不同视角产生真实透明度遮挡与揭露；原画保持完整。

## 2026-10-07 anchored side layout

The same eight generated RGBA assets are retained. All twelve poses have individually measured left/right clasps and outward diagonal paths. A 12 by 36 segmented grid keeps clasp depth at 0.065 and raises the free end to 1.02 / 1.24; this is a curved 2.5D ornament, not a wardrobe repaint or body rig. Upholstery-side attachments are used where exposing the complete legs makes a dress attachment unsuitable. Shadows fall on the print rather than a second floating duplicate. The raised name uses restrained depth and matching finish glints.
