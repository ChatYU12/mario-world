# Third-party assets

## Three.js r147

本地 Three.js 来自 [three.js r147](https://github.com/mrdoob/three.js/tree/r147)，按 MIT 许可分发。完整许可原文已随站点保存在 [THREE-LICENSE.txt](assets/THREE-LICENSE.txt)，来源为 [r147 官方 LICENSE](https://raw.githubusercontent.com/mrdoob/three.js/r147/LICENSE)。本项目保留原有压缩文件的版权标记。

## KayKit 3D assets

本项目新增的 12 款建筑与道具来自 **KayKit – Medieval Hexagon Pack 1.0**，作者 **Kay Lousberg**。这些是实际下载并转换的原始模型，不是从截图重画或运行时引用的外部链接。

- 官方产品页：[KayKit Medieval Hexagon](https://kaylousberg.itch.io/kaykit-medieval-hexagon)
- 官方开源仓库：[KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0](https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0)
- 原包下载：[official main ZIP](https://codeload.github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0/zip/refs/heads/main)
- 原包 SHA-256：`abe5b0c00456ab66a82883a6b16e860c419d822db5597596efccb09e57820c42`
- 原包大小：8,354,303 bytes。整包仅保存在工作区 `.asset-work/asset-source/`，不应打入站点发布包。
- 许可：**CC0 1.0 Universal**。发布者声明允许 personal / educational / commercial use，署名不是强制要求；本项目保留作者信息以方便溯源。
- 许可原文副本：[LICENSE-KayKit-Medieval-Hexagon.txt](assets/models/LICENSE-KayKit-Medieval-Hexagon.txt)
- 官方许可原文：[LICENSE.txt](https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0/main/LICENSE.txt)
- CC0 许可说明：[Creative Commons](https://creativecommons.org/publicdomain/zero/1.0/)

运行时库为 [imported-models.js](assets/imported-models.js)，详细来源文件、源 glTF/buffer 哈希、三角形数、缓冲字节和归一化尺寸见 [kaykit-model-manifest.json](assets/models/kaykit-model-manifest.json)。库不请求网络，不使用动态 loader、ES module、Image 或外部纹理，可由 classic script 在 `file://` 下加载。

## 模型名册

| API name | 来源 glTF basename | 用途 | 三角形 |
|---|---|---|---:|
| `houseA` | `building_home_A_blue.gltf` | 民居 A，可由场景模块增加邮局标识 | 1,011 |
| `houseB` | `building_home_B_blue.gltf` | 民居 B，可由场景模块增加图书馆标识 | 1,393 |
| `tavern` | `building_tavern_blue.gltf` | 旅店/商铺 | 2,992 |
| `blacksmith` | `building_blacksmith_blue.gltf` | 铁匠工坊 | 2,410 |
| `market` | `building_market_blue.gltf` | 市集摊铺 | 3,125 |
| `lumbermill` | `building_lumbermill_blue.gltf` | 木作坊 | 3,170 |
| `windmill` | `building_windmill_blue.gltf` | 风车磨坊 | 2,653 |
| `watermill` | `building_watermill_blue.gltf` | 水车磨坊 | 1,921 |
| `watchtower` | `building_tower_A_blue.gltf` | 瞭望塔 | 2,138 |
| `well` | `building_well_blue.gltf` | 水井 | 726 |
| `bridge` | `building_bridge_A.gltf` | 桥梁 | 604 |
| `barrel` | `barrel.gltf` | 木桶道具 | 240 |
| **合计** | **12 款** | | **22,383** |

每款输出为一个 indexed `BufferGeometry` / 一个 `Mesh`，最大单款 3,170 triangles。源 glTF 中风车、水车、塔楼等刚性子节点按原始静止姿态应用变换后合并，没有删除它们的组成部分。原包本次选择不含 NPC；人物由项目的新增场景模块自行构建。

## 转换与二次调色

1. 从官方原包读取原始 glTF、对应二进制 buffer 和 1024×1024 RGBA gradient atlas。
2. 保留原始三角形索引顺序、Float32 法线和 UV。保留硬边的重复顶点，不按位置强行焊接，也没有重新计算平滑法线。
3. 应用 glTF 节点层级变换；法线使用逆转置矩阵处理。多部件建筑在静止姿态合成一个可批处理的网格。
4. 将源 atlas 的颜色采样并映射到奶油石墙、暖木、珊瑚粉屋面和薄荷草绿；转换为 linear RGB 顶点色。顶点色存为 normalized Uint16，单通道量化误差不超过 1/65535；所有模型的原始面数保持不变。
5. 统一坐标为 +Y 向上、+Z 前向，XZ 包围盒居中，底部 y=0；按最大宽深归一化为 1。高度保持原建筑比例，见每款 `dimensions`。
6. 将索引和属性编码为内嵌 base64 typed arrays。Geometry 在 `create()` 返回的 kit 内按名字懒解码、复用；默认所有款复用一个顶点色标准材质。不同 `create()` 调用保持独立的 Geometry/Material 缓存。

此处的颜色与尺寸转换是本项目的修改，原模型作者仍为 Kay Lousberg。风车/水车为静态造型，不提供源动画控制器。

## 可用 API

```js
// Load assets/imported-models.js after Three.js r147 and before world builders.
const kit = window.MarioImportedModels.create(THREE);
const house = kit.build('houseA');
const tintedHouse = kit.build('houseA', {
  color: '#f8f1df', // optional overall multiply tint, not an individual roof color
  roughness: 0.82,
  opacity: 1
});
scene.add(house);
house.scale.setScalar(6);
house.position.set(x, sampledTerrainHeight, z);

kit.names;                    // the 12 stable API names above
kit.metadata.models.houseA;   // source, counts, hashes, dimensions, modifications
house.userData.dimensions;    // { width, height, depth }, maximum footprint = 1
house.userData.source;        // original author / license / source filename
kit.has('houseA');             // true
house.clone(true);            // new scene nodes, shared geometry and material
kit.dispose();                // only after all objects from this kit are no longer used
```

`build(name, style)` 每次返回独立 `THREE.Group` 和 `Mesh`。`style` 可选字段为 `color` 或 `tint`、`roughness`、`opacity`，未指定时使用已经烘焙的项目配色；相同 style 复用材质。未知模型名会明确抛错。

合批时读取颜色应使用 `attribute.getX/getY/getZ`，以正确处理 normalized Uint16；不要把底层 0–65535 的整数数组直接当成 0–1 浮点颜色。UV 和法线维持标准 Float32 attributes。

## 2026-11-02 屋面颜色复核与修正

`kaykit-1.0-pastel-2` 修复了初版转换器对 glTF atlas 使用 `1-v` 的方向错误。glTF 的 V 从 PNG 顶行取样；初版翻转后，蓝色屋面被采到极暗颜色，灰白檐口也会落到棕/红区域。修正后的采样直接使用 `v`。

蓝色先进入珊瑚粉映射，并设置亮度下限；建筑高度超过 42%、现有法线朝上的灰色斜面也映射为珊瑚粉。竖直灰墙保留奶油石色，木色仍为暖木。桥与木桶不进入灰屋面规则。该判断只控制顶点颜色，没有增加或修改顶点、三角面、法线、UV 或索引。

按现有三角面面积统计，高处斜屋面中 `houseA` 的珊瑚粉占 81.5%，`houseB` 占 83.0%，`blacksmith` 占 89.2%；`tavern` 为 37.0% 珊瑚粉与 63.0% 暖木。上述四款的极暗屋面面积均为 0。48 个 position / normal / UV / index 缓冲的 SHA-256 与初版逐一一致，面数与尺寸保持不变。

审计结果见 [kaykit-palette-audit.json](assets/models/kaykit-palette-audit.json)。这是离线属性与面积核对，最终场景光照下的视觉复核由 Lead 完成。

## 验证范围

使用实际 Three.js r147 在 Node 中检查了 12 款模型的索引范围、有限属性、法线长度、UV/颜色属性、三角数、包围盒、y=0 落地、最大宽深=1，以及同 kit 共享和跨 kit 独立缓存。住宅 CPU raycast 能命中实际索引几何。测试在无 DOM、无网络全局下运行；本资产接入任务没有启动或操作用户浏览器。

转换器和 CPU 校验脚本位于工作区 `.asset-work/`，它们是构建材料，不是运行时依赖。实际场景的渲染、布局和交互验收由项目 Lead 与 world-builder 负责。
