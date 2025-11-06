# PerlerCraft 拼豆底稿生成器 (Perler Beads Generator)

PerlerCraft 是面向创作者和商用场景的拼豆图纸生成工具。通过上传图片并调整参数，即可获得优化后的像素化图纸、颜色统计和采购清单，帮助团队高效完成设计和生产。

🎯 产品目标：
1. 提供准确的颜色识别与映射，减少手工调色成本。
2. 自动平滑边缘并减少噪点，输出更干净的底稿。
3. 支持智能合并近似颜色和自定义调色板，提升成品可控性。
4. 生成详细的颜色统计数据，方便备料与报价。

✨ 核心亮点：
1. 支持多种像素化风格与阈值调节，兼顾细节与效率。
2. 内置多套拼豆色号系统，可根据需求快速切换。
3. 提供手动调色、放大镜等工具，实现精细化修改。
4. 图纸与统计数据一键导出，便于团队协作与交付。

🤝 反馈与定制：
- 欢迎根据自身业务需求扩展或二次开发。
- 可在项目中提交 Issue/PR 协作改进。
- 针对商业化部署，可根据品牌策略自定义界面与流程。

## 功能特点

*   **图片上传**: 支持拖放或点击选择 JPG/PNG 图片。
*   **智能像素化**:
    *   **可调粒度**: 通过滑块控制像素画的横向格子数量。
    *   **颜色合并**: 通过滑块调整相似颜色的合并阈值，平滑色块区域。
*   **多色板支持**:
    *   提供多种预设拼豆色板 (如 168色, 144色, 96色等) 可供选择。
    *   根据所选色板进行颜色映射。
*   **颜色排除与管理**:
    *   在颜色统计列表中点击可**排除/恢复**特定颜色。
    *   排除颜色后，原使用该颜色的区域将智能重映射到邻近的可用颜色。
    *   提供一键恢复所有排除颜色的功能。
*   **实时预览**:
    *   即时显示处理后的像素画预览。
    *   **悬停/长按交互**: 在预览图上悬停（桌面）或长按（移动）可查看对应单元格的颜色编码 (Key) 和颜色。
    *   自动识别并标记外部背景区域（预览时显示为浅灰色）。
*   **下载成品**:
    *   **带 Key 图纸**: 下载带有清晰颜色编码 (Key) 和网格线的 PNG 图纸，忽略外部背景。
    *   **颜色统计图**: 下载包含各颜色 Key、色块、所需数量的 PNG 统计图。
    *   **授权计次**: 通过授权链接（`?code=<SHA-256 哈希>`）控制图纸导出次数，每个授权码默认可使用 10 次，访问链接即可自动激活。

## 技术实现

*   **框架**: [Next.js](https://nextjs.org/) (React) 与 TypeScript
*   **样式**: [Tailwind CSS](https://tailwindcss.com/) 用于响应式布局和样式。
*   **核心逻辑**: 浏览器端 [Canvas API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API) 用于图像处理、颜色分析和绘制。
*   **状态管理**: React Hooks (`useState`, `useRef`, `useEffect`, `useMemo`)。

### 核心算法：像素化、颜色映射与优化

应用程序的核心是将图像转换为像素网格，并将颜色精确映射到有限的拼豆调色板，同时进行平滑和背景处理。

1.  **图像加载与网格划分**:
    *   加载用户上传的图片。
    *   根据用户选择的"粒度"(`granularity`, N) 和原图宽高比确定 `N x M` 的网格尺寸。

2.  **初始颜色映射 (基于主导色)**:
    *   遍历 `N x M` 网格。
    *   对每个单元格，在原图对应区域内找出出现频率最高的**像素 RGB 值 (Dominant Color)**（忽略透明/半透明像素）。
    *   使用**欧氏距离**在 RGB 空间中，将该主导色映射到**当前选定且未被排除**的调色板 (`activeBeadPalette`) 中最接近的颜色。
    *   记录每个单元格的初始映射色号和颜色 (`initialMappedData`)。

3.  **区域颜色合并 (基于相似度)**:
    *   使用**广度优先搜索 (BFS)** 遍历 `initialMappedData`。
    *   识别颜色相似（欧氏距离小于 `similarityThreshold`）的**连通区域**。
    *   找出每个区域内出现次数最多的**珠子色号**。
    *   将该区域内所有单元格统一设置为这个主导色号对应的颜色，得到初步平滑结果 (`mergedData`)。

4.  **背景移除 (基于边界填充)**:
    *   定义一组背景色号 (`BACKGROUND_COLOR_KEYS`, 如 T1, H1)。
    *   从 `mergedData` 的**所有边界单元格**开始，使用**洪水填充 (Flood Fill)** 算法。
    *   标记所有从边界开始、颜色属于 `BACKGROUND_COLOR_KEYS` 且相互连通的单元格为"外部背景" (`isExternal = true`)。

5.  **颜色排除与重映射**:
    *   当用户排除某个颜色 `key` 时：
        *   确定一个**重映射目标调色板**：包含网格中**最初存在**的、且**当前未被排除**的所有颜色。
        *   如果目标调色板为空（表示排除此颜色会导致没有有效颜色可用），则阻止排除。
        *   否则，将 `mappedPixelData` 中所有使用 `key` 的非外部单元格，重新映射到目标调色板中的**最近似**颜色。
    *   当用户恢复颜色时，触发完整的图像重新处理流程（步骤 1-4）。

6.  **生成预览图与下载文件**:
    *   **预览图**: 在 Canvas 上绘制 `mergedData`，根据 `isExternal` 状态区分内部颜色和外部背景（浅灰），并添加网格线。支持悬停/长按显示色号。
    *   **带 Key 图纸下载**: 创建临时 Canvas，绘制 `mergedData` 中非外部背景的单元格，填充颜色、绘制边框，并在中央标注颜色 Key。
    *   **统计图下载**: 统计 `mergedData` 中非外部背景单元格的各色号数量，生成包含色块、色号、数量的列表式 PNG 图片。

### 调色板数据

预设的拼豆调色板数据定义在 `src/app/colorSystemMapping.json` 文件中，该文件包含了所有颜色的hex值到各个色号系统（MARD、COCO、漫漫、盼盼、咪小窝）的映射关系。不同的色板组合 (如 168色、96色等) 在 `src/app/page.tsx` 的 `paletteOptions` 中定义。

## 本地开发

1.  克隆项目:
    ```bash
    git clone https://github.com/your-org/perlercraft.git
    cd perlercraft
    ```
2.  安装依赖:
    ```bash
    npm install
    # or yarn install or pnpm install
    ```
3.  启动开发服务器:
    ```bash
    npm run dev
    # or yarn dev or pnpm dev
    ```
4.  在浏览器中打开 `http://localhost:3000`。

## 下载授权与计次

项目内置了基于授权码的下载次数限制，可满足简单的收费或按次使用场景需求：

*   通过包含 `?code=<授权哈希>` 的链接访问页面即可自动激活授权，无需手动输入。
*   每个授权码默认可下载图纸 10 次，使用次数保存在浏览器 `localStorage` 中。
*   授权码处于同一批次时，可批量生成并分发，适合同一活动或商品的售卖。

### 生成批量授权码

1. 设置生产环境访问地址（可选）：
    ```bash
    export PERLERCRAFT_BASE_URL="https://your-domain.example/perlercraft"
    ```
2. 批量生成授权码及其哈希：
    ```bash
    npm run generate:tokens -- --count=5000
    ```
   输出文件保存于 `scripts/output/`，包含：
   * `<timestamp>.csv`：原始 UUID、哈希、完整授权链接；
   * `<timestamp>-hashes.json`：对应的 SHA-256 哈希；
   * `<timestamp>-hashes.ts`：可直接复制到项目的 TypeScript 数组。
3. 将生成的哈希数组粘贴到 `src/data/tokenHashes.ts`，重新部署即可启用该批次授权码。

### 使用与限制说明

*   授权码验证完全在前端完成，可快速部署；若用户更换设备或清除浏览器数据，需要再次通过授权链接激活。
*   若需要跨设备或更严格的防篡改策略，建议在后续迭代中接入后端服务或第三方计费平台。

## 部署到 Cloudflare Pages

项目已内置 Cloudflare Pages 所需脚本，可直接通过 GitHub 仓库连接部署：

1. 安装依赖（Cloudflare 构建时也会自动执行）：
   ```bash
   npm install
   ```
2. 本地构建并检查：
   ```bash
   npm run cf:build
   ```
   构建结果生成在 `.vercel/output/static/`。
3. （可选）本地预览 Cloudflare Pages 行为：
   ```bash
   npm run cf:preview
   ```
4. GitHub 提交代码后，在 Cloudflare Pages 控制台创建站点，选择 GitHub 仓库，设置：
   - Build command：`npm run cf:build`
   - Output directory：`.vercel/output/static`
   - Node compatibility date：`2024-11-06`
5. 如需在命令行部署或做 CI/CD，可使用：
   ```bash
   npm run cf:deploy -- --project-name <cloudflare-project-name>
   ```
6. 绑定域名后，使用 `https://<域名>/?code=<授权哈希>` 即可激活下载次数。

## 未来可能的改进

*   **颜色映射算法**: 探索如 K-Means 聚类或使用 CIEDE2000 (Delta E) 颜色距离进行映射，可能获得更优的视觉效果（但计算成本更高）。
*   **抖动 (Dithering)**: 添加抖动选项（如 Floyd-Steinberg），在有限调色板下模拟更丰富的颜色过渡。
*   **性能优化**: 对非常大的图片或高粒度设置，考虑使用 Web Workers 进行后台计算。
*   **用户自定义调色板**: 允许用户上传或创建自己的调色板。
*   **UI/UX 增强**: 如更直观的区域选择、颜色替换工具等。

## 许可证

Apache 2.0
