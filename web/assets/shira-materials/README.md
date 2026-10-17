# 希拉可组合素材 v2

大背景由 CSS 纯色/渐变提供，不使用整幅背景插画。三份素材各自独立，可单独替换。

- `petal-curled.webp`：卷曲花瓣，256×256，真实 alpha 透明。
- `petal-flat.webp`：舒展花瓣，256×256，真实 alpha 透明。
- `velvet-tile.webp`：256×256 细织物纹理，以小尺寸 repeat 平铺；无缝性仍需在高强度使用时重新目视核对。

花瓣不捕获鼠标，不做全屏飘落；目前只在聊天框边缘小面积使用。纹理目前只用于侧栏和背包的低强度材质层。可通过 `shira-layout.css` 中 `--shira-petal-a/b`、`--shira-petal-opacity`、`--shira-textile`、`--shira-textile-size` 修改资源及强度，不影响主背景、排版或角色数据。

生成方式：内置 image_gen；检查 alpha 后用 Sharp 缩小并转 WebP，保留透明通道。先前生成的整幅酒红背景没有接入本项目。

## 生成提示词

Curled: One single curled dark burgundy rose petal, isolated on a genuinely transparent alpha background. Photorealistic macro botanical cutout, soft natural side lighting, delicate veins, thin translucent wine-red edges, velvet surface, mature understated elegant aesthetic. Centered with generous transparent padding, no cast shadow on any background, no other petals, no floor, no text, no grid, no frame. A reusable small desktop UI decorative asset. Square image.

Flat: One single flatter broad rose petal, dark muted wine red and dusty burgundy, gently folded tip, isolated on a genuinely transparent alpha background. Photorealistic macro botanical cutout with soft diffuse lighting, fine real veins, delicate irregular edges, subdued satin quality. Centered with transparent padding, no surface or background shadow, no other objects, no text or grid. Different silhouette from a curled petal. Reusable UI decorative asset, square image.

Tile: A seamless tileable microtexture swatch of matte fine silk velvet in very dark warm aubergine gray #241e27. Flat evenly lit orthographic macro, tiny subtle irregular fibers only. Uniform color and luminance all across, borders must tile invisibly in both axes. No petals, no folds, no objects, no vignette, no directional lighting, no large visible weave grid. Low contrast, intended as a small repeating texture over a solid application background. Square bitmap material swatch.
