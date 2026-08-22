<p align="center">
  <img src="docs/media/madi-hero.svg" alt="MADI — 面向 Web 的开放工程平台" width="100%" />
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.ja.md">日本語</a> ·
  <strong>简体中文</strong>
</p>

<p align="center">
  <a href="LICENSE"><img alt="Apache License 2.0" src="https://img.shields.io/badge/license-Apache--2.0-5B8DEF?style=flat-square"></a>
  <img alt="架构与原型阶段" src="https://img.shields.io/badge/status-architecture%20%26%20prototype-F5A623?style=flat-square">
  <img alt="WebGPU renderer" src="https://img.shields.io/badge/renderer-WebGPU-7C6CFF?style=flat-square">
  <a href="CONTRIBUTING.md"><img alt="欢迎贡献" src="https://img.shields.io/badge/contributions-welcome-20B486?style=flat-square"></a>
</p>

<p align="center">
  <strong>无需替换现有工具，让工程模型进入 Web。</strong>
  <br />
  面向大型 CAD、BIM 与工程场景的开源工作室、编译器和 WebGPU 运行时。
</p>

> [!IMPORTANT]
> MADI 目前处于架构设计与原型验证阶段。本仓库定义产品方向、系统边界、
> 基准测试和实现路径；目前尚不包含可安装的生产级查看器。

> 本文是英文 [`README.md`](README.md) 的翻译。如内容存在差异，以英文版为准。
> 欢迎帮助审校术语和表达。

## 工程模型也需要一个开放的 Web 平台

工程团队已经在 SolidWorks、CATIA、NX、Creo、Fusion、Onshape、Revit
以及众多专业系统中创建权威数据。真正困难的并不是发明另一种 CAD 文件格式，
而是在不丢失装配身份和工程语义的前提下，让这些数据能够在浏览器中快速打开、
检查、自动化，并嵌入其他产品。

MADI 在源工具和 Web 应用之间提供一个开放层。它的长期愿景在精神上类似
Blender：由社区共同构建一个拥有强大核心和广泛扩展生态的工程工作空间。
近期目标则更加聚焦——把大型工程场景的交付与交互做好。

<table>
  <tr>
    <td width="33%" valign="top">
      <h3>保留权威数据源</h3>
      原生 CAD/BIM 和中性交换文件始终是 source of truth。MADI 工作空间保存
      引用、视图、批注和插件状态，而不是成为一种替代 CAD 格式。
    </td>
    <td width="33%" valign="top">
      <h3>为规模而编译</h3>
      离线管线在保留 occurrence 与源引用的同时，完成实例化、分区、量化、
      压缩和渐进式 LOD 构建。
    </td>
    <td width="33%" valign="top">
      <h3>以 WebGPU 原生运行</h3>
      通过紧凑数据、受控内存、Worker、GPU 可见状态与直接 WebGPU 渲染，
      使每帧 hot path 不依赖庞大的 JavaScript scene graph。
    </td>
  </tr>
</table>

## 一条开放的管线

```mermaid
flowchart LR
    S["源工具与文件<br/>CAD · BIM · STEP · IFC · glTF"]
    A["适配器<br/>OCCT · IFC · SDK 桥接"]
    I["Engineering Scene IR<br/>身份 · 层级 · 语义"]
    C["编译器<br/>实例 · 边线 · 分块 · LOD"]
    R["WebGPU 运行时<br/>流送 · 解码 · 剔除 · 渲染 · 拾取"]
    U["Studio · 嵌入式应用 · 插件"]

    S --> A --> I --> C --> R --> U
```

Engineering Scene IR 是逻辑系统边界，而不是新的交换格式。交付层优先采用
适用的既有标准；只有公开基准测试证明存在实质差距时，才引入优化后的编译缓存。

## 我们正在构建什么

| 层 | 职责 | 首个垂直切片 |
|---|---|---|
| **MADI Studio** | 参考工程工作空间 | 装配树、搜索、属性、选择、隐藏/隔离、剖切、测量 |
| **MADI Runtime** | Headless 浏览器与 GPU 引擎 | 渐进式流送、Worker 解码、实例化、剔除、拾取、GPU 内存预算 |
| **MADI Compiler** | 可复现的 source-to-Web 构建管线 | 通过 OCCT 读取 STEP AP242，保留层级与边线，生成 LOD 与分块 |
| **MADI SDK** | 稳定的嵌入与扩展接口 | 框架无关的 TypeScript API、命令、面板、分析 Worker、能力授权插件 |

### 为工程工作而设计

- 保留装配、prototype、occurrence、源对象、名称、颜色、单位和变换关系
- 渲染显式 CAD 边线，而不是从三角形中猜测所有有意义的边界
- 在完整目标精度几何到达前，先显示可操作的粗略场景
- 基于稳定对象身份进行选择、隐藏、隔离、裁剪、测量和批注
- 即使面对超大场景，也遵守声明的 CPU 与 GPU 内存预算
- 自托管 Studio，或将运行时嵌入其他产品

## 项目状态

路线图以可验证的成果为门槛，而不是以日期驱动。

| 阶段 | 成果 | 状态 |
|---|---|---|
| **0 — 可行性验证** | 将 OCCT 身份与边线连接到直接 WebGPU 原型 | **当前** |
| **1 — 垂直切片** | 具备核心工程交互的公开 STEP-to-browser 演示 | 计划中 |
| **2 — 大场景 alpha** | 10 万以上 occurrence、流送、LOD、缓存和内存预算 | 计划中 |
| **3 — 开放平台 beta** | 插件、IFC、嵌入示例与自托管部署 | 计划中 |

请查看完整[路线图](docs/ROADMAP.md)与
[基准测试约定](docs/BENCHMARKS.md)。性能数据将与可再分发模型、准确的硬件和
浏览器信息、cold/warm 状态及可复现命令一同发布。

## 从设计文档开始

| 你想了解… | 请阅读… |
|---|---|
| 产品切入点和目标工作流 | [产品规划](docs/PRODUCT.md) |
| 系统边界与数据流 | [系统架构](docs/ARCHITECTURE.md) |
| 中立场景数据模型 | [Engineering Scene IR](docs/SCENE_IR.md) |
| STEP/OCCT 导入与编译 | [编译器设计](docs/COMPILER.md) |
| 浏览器调度与 WebGPU 渲染 | [运行时设计](docs/RUNTIME.md) |
| 扩展或嵌入式产品 | [插件架构](docs/PLUGINS.md) |
| 基础技术决策 | [Architecture Decision Records](docs/adr/README.md) |

所有设计文档均索引于 [`docs/README.md`](docs/README.md)。

## 原则

1. **源工具保持权威。** MADI 补充现有工程系统，而不是强制迁移格式。
2. **语义与渲染几何分离。** 即使最高精度几何尚未驻留，也能发现和查询对象。
3. **不是简单转换，而是编译。** 在离线阶段减少浏览器启动时间、内存、带宽与
   draw overhead。
4. **从第一个字节开始渐进显示。** 首次可用交互时间是一等指标。
5. **Hot path 采用 data-oriented 设计。** 每帧工作优先使用紧凑数组、批次和
   GPU 可见状态。
6. **标准优先，以证据决策。** 自定义交付结构必须有测量依据与明确的兼容策略。
7. **运行时不依赖几何内核。** OCCT 与商业转换 SDK 位于适配器之后，不泄漏到
   浏览器公共 API。
8. **开放且可嵌入。** 即使没有 Studio UI，核心组件仍然有用。

## 常见问题

<details>
<summary><strong>MADI 是一种新的 CAD 文件格式吗？</strong></summary>
<br />
不是。现有 CAD/BIM 文档仍是 source of truth。MADI 定义中立的内存边界，
并可生成针对浏览器交付优化、可丢弃重建且带版本的缓存。
</details>

<details>
<summary><strong>MADI 想取代 Fusion、Onshape 或桌面 CAD 吗？</strong></summary>
<br />
不在初始范围内。首个产品是大型场景工程工作空间和可嵌入运行时。将来可以用
独立工作台加入精确参数化创作，但这并不是核心平台产生价值的前提。
</details>

<details>
<summary><strong>为什么选择 OCCT 加直接 WebGPU 运行时？</strong></summary>
<br />
Open CASCADE 为读取精确几何、装配和源边线提供成熟的离线路径。浏览器运行时
负责高效流送和交互编译后的场景数据。分离这两个边界，可以避免把几何内核放入
渲染 hot path。
</details>

<details>
<summary><strong>为什么不完全基于 Three.js 构建查看器？</strong></summary>
<br />
Three.js 在生态工具与实验中仍然很有价值。MADI 的大型场景渲染器使用直接
WebGPU 数据结构，使批处理、residency、拾取和内存策略都能被明确控制。
这是架构重点的选择，并不是说通用 scene graph 是错误的。
</details>

<details>
<summary><strong>glTF 在哪里使用？</strong></summary>
<br />
glTF 是重要的标准化交付与互操作选项。在满足工程身份、边线、流送和精度要求
时，MADI 会复用 glTF、meshopt、KTX2、3D Tiles 概念与元数据标准。
</details>

## 参与贡献

MADI 尚处于可以通过证据改变架构的早期阶段。目前特别有价值的贡献包括：

- 记录边界情况、允许再分发的 STEP 或 IFC 测试模型
- OCCT 提取和 WebGPU 渲染技术验证
- 基准测试框架和透明的基线结果
- 对身份、精度、缓存和插件决策的审查
- 来自真实工程团队的产品工作流
- 文档与翻译审校

请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，浏览
[未解决的 Issue](https://github.com/1n01raymond/madi/issues)，或帮助改进
[翻译](docs/TRANSLATIONS.md)。大型变更应先创建设计 Issue，以便在实现前公开
假设和方向。

## 许可证

MADI 采用 [Apache License 2.0](LICENSE)。计划中的第三方依赖可能采用其他
兼容许可证，详见 [THIRD_PARTY.md](THIRD_PARTY.md)。

<p align="center">
  <sub>面向 Web 的开放工程平台。</sub>
</p>
