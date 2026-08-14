# 露天音乐广场拆分素材

本目录保存从用户提供的露天音乐广场参考图定向整理的候选素材。当前仅供美术选型与后续接入，不属于游戏运行时资源，也没有在 Phaser `preload` 中注册；确定采用后，应把选中的透明 PNG 移入 `public/assets/images/environment/`，再按资源规范完成加载与实机验收。

## 总表

- `festival-props-sprite-sheet-magenta.png`：洋红底浏览总表，版式与既有云层／飞鸟素材表一致。
- `festival-props-sprite-sheet-alpha.png`：透明底完整总表，方便批量预览或二次排版。

## 独立透明 PNG

| 文件 | 内容 | 像素尺寸 |
|---|---|---:|
| `concert-audio-display.png` | 中央音乐屏与四组音箱 | 398 × 220 |
| `festival-string-lights.png` | 双杆双层节庆灯串 | 350 × 246 |
| `patchwork-counter.png` | 木质拼色长摊桌 | 393 × 139 |
| `music-signpost.png` | 奶油色音符指示牌 | 144 × 399 |
| `purple-equipment-tower.png` | 紫粉色手作设备塔 | 244 × 484 |
| `speaker-equipment-crate.png` | 灰紫双音箱设备箱 | 281 × 223 |
| `mosaic-stone-lantern.png` | 青珊瑚嵌饰石灯座 | 181 × 309 |
| `white-round-mascot.png` | 白色圆形小生物 | 225 × 204 |
| `teal-round-mascot.png` | 青绿色圆形小生物 | 195 × 205 |

## 生成与去背

- 内容参考：用户提供的露天音乐广场全景图。
- 风格参考：既有洋红底云层、飞鸟、流星素材表。
- 生成方式：OpenAI 内置图像生成；要求 3 × 3 独立排布、低分辨率马赛克像素质感、薄白色剪纸描边与纯洋红 `#FF00FF` 背景。
- 去背方式：先生成洋红底总表，再以边缘取样软遮罩去背；为了保留粉紫设备本色，没有对主体执行全局洋红去色，而是仅清理外缘高饱和键色像素。
- 发布提示：素材由参考图定向生成，正式公开或商业使用前仍需由项目方复核参考图与生成结果的权属。
