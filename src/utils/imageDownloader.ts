import { GridDownloadOptions } from '../types/downloadTypes';
import { MappedPixel, PaletteColor } from './pixelation';
import { getDisplayColorKey, getColorKeyByHex, ColorSystem } from './colorSystemUtils';

// 用于获取对比色的工具函数 - 从page.tsx复制
function getContrastColor(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#000000'; // Default to black
  // Simple brightness check (Luma formula Y = 0.2126 R + 0.7152 G + 0.0722 B)
  const luma = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luma > 0.5 ? '#000000' : '#FFFFFF'; // Dark background -> white text, Light background -> black text
}

// 辅助函数：将十六进制颜色转换为RGB
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  const formattedHex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(formattedHex);
  return result
    ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
    }
    : null;
}

// 用于排序颜色键的函数 - 从page.tsx复制
function sortColorKeys(a: string, b: string): number {
  const regex = /^([A-Z]+)(\d+)$/;
  const matchA = a.match(regex);
  const matchB = b.match(regex);

  if (matchA && matchB) {
    const prefixA = matchA[1];
    const numA = parseInt(matchA[2], 10);
    const prefixB = matchB[1];
    const numB = parseInt(matchB[2], 10);

    if (prefixA !== prefixB) {
      return prefixA.localeCompare(prefixB); // Sort by prefix first (A, B, C...)
    }
    return numA - numB; // Then sort by number (1, 2, 10...)
  }
  // Fallback for keys that don't match the standard pattern (e.g., T1, ZG1)
  return a.localeCompare(b);
}

// 导出CSV hex数据的函数
export function exportCsvData({
  mappedPixelData,
  gridDimensions,
  selectedColorSystem
}: {
  mappedPixelData: MappedPixel[][] | null;
  gridDimensions: { N: number; M: number } | null;
  selectedColorSystem: ColorSystem;
}): void {
  if (!mappedPixelData || !gridDimensions) {
    console.error("导出失败: 映射数据或尺寸无效。");
    alert("无法导出CSV，数据未生成或无效。");
    return;
  }

  const { N, M } = gridDimensions;

  // 生成CSV内容，每行代表图纸的一行
  const csvLines: string[] = [];

  for (let row = 0; row < M; row++) {
    const rowData: string[] = [];
    for (let col = 0; col < N; col++) {
      const cellData = mappedPixelData[row][col];
      if (cellData && !cellData.isExternal) {
        // 内部单元格，记录hex颜色值
        rowData.push(cellData.color);
      } else {
        // 外部单元格或空白，使用特殊标记
        rowData.push('TRANSPARENT');
      }
    }
    csvLines.push(rowData.join(','));
  }

  // 创建CSV内容
  const csvContent = csvLines.join('\n');

  // 创建并下载CSV文件
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', `bead-pattern-${N}x${M}-${selectedColorSystem}.csv`);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // 释放URL对象
  URL.revokeObjectURL(url);

  console.log("CSV数据导出完成");
}

// 导入CSV hex数据的函数
export function importCsvData(file: File): Promise<{
  mappedPixelData: MappedPixel[][];
  gridDimensions: { N: number; M: number };
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        if (!text) {
          reject(new Error('无法读取文件内容'));
          return;
        }

        // 解析CSV内容
        const lines = text.trim().split('\n');
        const M = lines.length; // 行数

        if (M === 0) {
          reject(new Error('CSV文件为空'));
          return;
        }

        // 解析第一行获取列数
        const firstRowData = lines[0].split(',');
        const N = firstRowData.length; // 列数

        if (N === 0) {
          reject(new Error('CSV文件格式无效'));
          return;
        }

        // 创建映射数据
        const mappedPixelData: MappedPixel[][] = [];

        for (let row = 0; row < M; row++) {
          const rowData = lines[row].split(',');
          const mappedRow: MappedPixel[] = [];

          // 确保每行都有正确的列数
          if (rowData.length !== N) {
            reject(new Error(`第${row + 1}行的列数不匹配，期望${N}列，实际${rowData.length}列`));
            return;
          }

          for (let col = 0; col < N; col++) {
            const cellValue = rowData[col].trim();

            if (cellValue === 'TRANSPARENT' || cellValue === '') {
              // 外部/透明单元格
              mappedRow.push({
                key: 'TRANSPARENT',
                color: '#FFFFFF',
                isExternal: true
              });
            } else {
              // 验证hex颜色格式
              const hexPattern = /^#[0-9A-Fa-f]{6}$/;
              if (!hexPattern.test(cellValue)) {
                reject(new Error(`第${row + 1}行第${col + 1}列的颜色值无效：${cellValue}`));
                return;
              }

              // 内部单元格
              mappedRow.push({
                key: cellValue.toUpperCase(),
                color: cellValue.toUpperCase(),
                isExternal: false
              });
            }
          }

          mappedPixelData.push(mappedRow);
        }

        // 返回解析结果
        resolve({
          mappedPixelData,
          gridDimensions: { N, M }
        });

      } catch (error) {
        reject(new Error(`解析CSV文件失败：${error}`));
      }
    };

    reader.onerror = () => {
      reject(new Error('读取文件失败'));
    };

    reader.readAsText(file, 'utf-8');
  });
}

// 下载图片的主函数
export async function downloadImage({
  mappedPixelData,
  gridDimensions,
  colorCounts,
  totalBeadCount,
  options,
  activeBeadPalette,
  selectedColorSystem
}: {
  mappedPixelData: MappedPixel[][] | null;
  gridDimensions: { N: number; M: number } | null;
  colorCounts: { [key: string]: { count: number; color: string } } | null;
  totalBeadCount: number;
  options: GridDownloadOptions;
  activeBeadPalette: PaletteColor[];
  selectedColorSystem: ColorSystem;
}): Promise<void> {
  if (!mappedPixelData || !gridDimensions || gridDimensions.N === 0 || gridDimensions.M === 0 || activeBeadPalette.length === 0) {
    console.error("下载失败: 映射数据或尺寸无效。");
    alert("无法下载图纸，数据未生成或无效。");
    return;
  }
  if (!colorCounts) {
    console.error("下载失败: 色号统计数据无效。");
    alert("无法下载图纸，色号统计数据未生成或无效。");
    return;
  }

  // 主要下载处理函数
  const processDownload = () => {
    const { N, M } = gridDimensions; // 此时已确保gridDimensions不为null
    const downloadCellSize = 30;

    // 从下载选项中获取设置
    const { showGrid, gridInterval, showCoordinates, gridLineColor, includeStats } = options;

    // 设置边距空间用于坐标轴标注（如果需要）
    const axisLabelSize = showCoordinates ? Math.max(30, Math.floor(downloadCellSize)) : 0;

    // 定义统计区域的基本参数
    const statsPadding = 20;
    let statsHeight = 0;

    // 预先计算用于字体大小的变量
    const preCalcWidth = N * downloadCellSize + axisLabelSize;
    const preCalcAvailableWidth = preCalcWidth - (statsPadding * 2);

    // 计算字体大小 - 与颜色统计区域保持一致
    const baseStatsFontSize = 13;
    const widthFactor = Math.max(0, preCalcAvailableWidth - 350) / 600;
    const statsFontSize = Math.floor(baseStatsFontSize + (widthFactor * 10));

    // 计算额外边距，确保坐标数字完全显示（四边都需要）
    const extraLeftMargin = showCoordinates ? Math.max(20, statsFontSize * 2) : 0; // 左侧额外边距
    const extraRightMargin = showCoordinates ? Math.max(20, statsFontSize * 2) : 0; // 右侧额外边距
    const extraTopMargin = showCoordinates ? Math.max(15, statsFontSize) : 0; // 顶部额外边距
    const extraBottomMargin = showCoordinates ? Math.max(15, statsFontSize) : 0; // 底部额外边距

    // 计算网格尺寸
    const gridWidth = N * downloadCellSize;
    const gridHeight = M * downloadCellSize;

    // 计算标题栏高度（根据图片大小自动调整）
    const baseTitleBarHeight = 80; // 增大基础高度

    // 先计算一个初始下载宽度来确定缩放比例
    const initialWidth = gridWidth + axisLabelSize + extraLeftMargin;
    // 使用总宽度而不是单元格大小来计算比例，确保字体在大尺寸图片上也足够大
    const titleBarScale = Math.max(1.0, Math.min(2.0, initialWidth / 1000)); // 更激进的缩放策略
    const titleBarHeight = Math.floor(baseTitleBarHeight * titleBarScale);

    // 计算标题文字大小 - 与总体宽度相关而不是单元格大小
    const titleFontSize = Math.max(28, Math.floor(28 * titleBarScale)); // 最小28px，确保可读性

    // 计算统计区域的大小
    if (includeStats && colorCounts) {
      const colorKeys = Object.keys(colorCounts);

      // 统计区域顶部额外间距
      const statsTopMargin = 24; // 与下方渲染时保持一致

      // 根据可用宽度动态计算列数
      const numColumns = Math.max(1, Math.min(4, Math.floor(preCalcAvailableWidth / 250)));

      // 根据可用宽度动态计算样式参数，使用更积极的线性缩放
      const baseSwatchSize = 18; // 略微增大基础大小
      // baseStatsFontSize 和 statsFontSize 在前面已经计算了，这里不需要重复
      // const baseItemPadding = 10;

      // 调整缩放公式，使大宽度更明显增大
      // widthFactor 在前面已经计算了，这里不需要重复
      const swatchSize = Math.floor(baseSwatchSize + (widthFactor * 20)); // 增大最大增量幅度
      // statsFontSize 在前面已经计算了，这里不需要重复
      // const itemPadding = Math.floor(baseItemPadding + (widthFactor * 12)); // 增大最大增量幅度 // 移除未使用的 itemPadding

      // 计算实际需要的行数
      const numRows = Math.ceil(colorKeys.length / numColumns);

      // 计算单行高度 - 根据色块大小和内边距动态调整
      const statsRowHeight = Math.max(swatchSize + 8, 25);

      // 标题和页脚高度
      const titleHeight = 40; // 标题和分隔线的总高度
      const footerHeight = 40; // 总计部分的高度

      // 计算统计区域的总高度 - 需要包含顶部间距
      statsHeight = titleHeight + (numRows * statsRowHeight) + footerHeight + (statsPadding * 2) + statsTopMargin;
    }

    // 调整画布大小，包含标题栏、坐标轴和统计区域（四边都有坐标）
    const downloadWidth = gridWidth + (axisLabelSize * 2) + extraLeftMargin + extraRightMargin;
    let downloadHeight = titleBarHeight + gridHeight + (axisLabelSize * 2) + statsHeight + extraTopMargin + extraBottomMargin;

    let downloadCanvas = document.createElement('canvas');
    downloadCanvas.width = downloadWidth;
    downloadCanvas.height = downloadHeight;
    const context = downloadCanvas.getContext('2d');
    if (!context) {
      console.error("下载失败: 无法创建临时 Canvas Context。");
      alert("无法下载图纸。");
      return;
    }

    // 使用非空的context变量
    let ctx = context;
    ctx.imageSmoothingEnabled = false;

    // 设置背景色
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, downloadWidth, downloadHeight);

    // 重新设计的现代简洁标题栏
    // 1. 主背景 - 纯净的深色，专业感
    ctx.fillStyle = '#1F2937'; // 深灰色，既有专业感又不抢夺主要内容
    ctx.fillRect(0, 0, downloadWidth, titleBarHeight);

    // 2. 左侧品牌色块 - 作为Logo载体
    const brandBlockWidth = titleBarHeight * 0.8;
    const brandGradient = ctx.createLinearGradient(0, 0, brandBlockWidth, titleBarHeight);
    brandGradient.addColorStop(0, '#6366F1'); // 现代蓝色
    brandGradient.addColorStop(1, '#8B5CF6'); // 现代紫色

    ctx.fillStyle = brandGradient;
    ctx.fillRect(0, 0, brandBlockWidth, titleBarHeight);

    // 3. 绘制现代Logo - 几何图形组合
    const logoSize = titleBarHeight * 0.4;
    const logoX = brandBlockWidth / 2;
    const logoY = titleBarHeight / 2;

    // Logo: 拼豆的抽象表示 - 圆角方块阵列
    ctx.fillStyle = '#FFFFFF';
    const beadSize = logoSize / 4;
    const beadSpacing = beadSize * 1.2;

    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const beadX = logoX - logoSize / 2 + col * beadSpacing;
        const beadY = logoY - logoSize / 2 + row * beadSpacing;

        // 绘制圆角方块，模拟拼豆
        ctx.beginPath();
        ctx.roundRect(beadX, beadY, beadSize, beadSize, beadSize * 0.2);
        ctx.fill();

        // 添加中心小圆点，增加拼豆特征
        ctx.fillStyle = 'rgba(99, 102, 241, 0.3)';
        ctx.beginPath();
        ctx.arc(beadX + beadSize / 2, beadY + beadSize / 2, beadSize * 0.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
      }
    }

    // 4. 主标题 - 现代字体，清晰层次
    const mainTitleFontSize = Math.max(20, Math.floor(titleFontSize * 0.8));
    const subTitleFontSize = Math.max(12, Math.floor(titleFontSize * 0.45));

    ctx.fillStyle = '#FFFFFF';
    ctx.font = `600 ${mainTitleFontSize}px system-ui, -apple-system, sans-serif`; // 现代字体栈
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    // 主标题位置
    const titleStartX = brandBlockWidth + titleBarHeight * 0.3;
    const mainTitleY = titleBarHeight * 0.4;

    ctx.fillText('PerlerCraft', titleStartX, mainTitleY);

    // 5. 副标题 - 功能说明
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.font = `400 ${subTitleFontSize}px system-ui, -apple-system, sans-serif`;
    const subTitleY = titleBarHeight * 0.65;

    ctx.fillText('拼豆图纸生成工具', titleStartX, subTitleY);

    // 使用提示：在标题栏右侧显示简短说明，与副标题保持在同一行，右对齐并留出内边距
    const usageFontSize = Math.max(12, Math.floor(subTitleFontSize * 0.6));
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.font = `400 ${usageFontSize}px system-ui, -apple-system, sans-serif`;
    // 与副标题同一行，右侧对齐，保留 20px 的右侧内边距
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const usageX = downloadWidth - 20;
    const usageY = subTitleY;
    ctx.fillText('提示：长按图纸保存到本地或照片库', usageX, usageY);

    // 恢复默认文本对齐和基线，供后续绘制使用
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';



    // 7. 优雅的分割线
    const separatorY = titleBarHeight - 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, separatorY);
    ctx.lineTo(downloadWidth, separatorY);
    ctx.stroke();

    console.log(`Generating download grid image: ${downloadWidth}x${downloadHeight}`);
    const fontSize = Math.max(8, Math.floor(downloadCellSize * 0.4));

    // 如果需要，先绘制坐标轴和网格背景
    if (showCoordinates) {
      // 绘制坐标轴背景
      ctx.fillStyle = '#F5F5F5'; // 浅灰色背景
      // 横轴背景 (顶部)
      ctx.fillRect(extraLeftMargin + axisLabelSize, titleBarHeight + extraTopMargin, gridWidth, axisLabelSize);
      // 横轴背景 (底部)
      ctx.fillRect(extraLeftMargin + axisLabelSize, titleBarHeight + extraTopMargin + axisLabelSize + gridHeight, gridWidth, axisLabelSize);
      // 纵轴背景 (左侧)
      ctx.fillRect(extraLeftMargin, titleBarHeight + extraTopMargin + axisLabelSize, axisLabelSize, gridHeight);
      // 纵轴背景 (右侧)
      ctx.fillRect(extraLeftMargin + axisLabelSize + gridWidth, titleBarHeight + extraTopMargin + axisLabelSize, axisLabelSize, gridHeight);

      // 绘制坐标轴数字
      ctx.fillStyle = '#333333'; // 坐标数字颜色
      // 使用固定的字体大小，不进行缩放
      const axisFontSize = 14;
      ctx.font = `${axisFontSize}px sans-serif`;

      // X轴（顶部）数字
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < N; i++) {
        if ((i + 1) % gridInterval === 0 || i === 0 || i === N - 1) { // 在间隔处、起始处和结束处标注
          // 将数字放在轴线之上，考虑额外边距
          const numX = extraLeftMargin + axisLabelSize + (i * downloadCellSize) + (downloadCellSize / 2);
          const numY = titleBarHeight + extraTopMargin + (axisLabelSize / 2);
          ctx.fillText((i + 1).toString(), numX, numY);
        }
      }

      // X轴（底部）数字
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < N; i++) {
        if ((i + 1) % gridInterval === 0 || i === 0 || i === N - 1) { // 在间隔处、起始处和结束处标注
          // 将数字放在底部轴线上
          const numX = extraLeftMargin + axisLabelSize + (i * downloadCellSize) + (downloadCellSize / 2);
          const numY = titleBarHeight + extraTopMargin + axisLabelSize + gridHeight + (axisLabelSize / 2);
          ctx.fillText((i + 1).toString(), numX, numY);
        }
      }

      // Y轴（左侧）数字
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let j = 0; j < M; j++) {
        if ((j + 1) % gridInterval === 0 || j === 0 || j === M - 1) { // 在间隔处、起始处和结束处标注
          // 将数字放在轴线之左
          const numX = extraLeftMargin + (axisLabelSize / 2);
          const numY = titleBarHeight + extraTopMargin + axisLabelSize + (j * downloadCellSize) + (downloadCellSize / 2);
          ctx.fillText((j + 1).toString(), numX, numY);
        }
      }

      // Y轴（右侧）数字
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let j = 0; j < M; j++) {
        if ((j + 1) % gridInterval === 0 || j === 0 || j === M - 1) { // 在间隔处、起始处和结束处标注
          // 将数字放在右侧轴线上
          const numX = extraLeftMargin + axisLabelSize + gridWidth + (axisLabelSize / 2);
          const numY = titleBarHeight + extraTopMargin + axisLabelSize + (j * downloadCellSize) + (downloadCellSize / 2);
          ctx.fillText((j + 1).toString(), numX, numY);
        }
      }

      // 绘制坐标轴边框
      ctx.strokeStyle = '#AAAAAA';
      ctx.lineWidth = 1;
      // 顶部横轴底边
      ctx.beginPath();
      ctx.moveTo(extraLeftMargin + axisLabelSize, titleBarHeight + extraTopMargin + axisLabelSize);
      ctx.lineTo(extraLeftMargin + axisLabelSize + gridWidth, titleBarHeight + extraTopMargin + axisLabelSize);
      ctx.stroke();
      // 底部横轴顶边
      ctx.beginPath();
      ctx.moveTo(extraLeftMargin + axisLabelSize, titleBarHeight + extraTopMargin + axisLabelSize + gridHeight);
      ctx.lineTo(extraLeftMargin + axisLabelSize + gridWidth, titleBarHeight + extraTopMargin + axisLabelSize + gridHeight);
      ctx.stroke();
      // 左侧纵轴右边
      ctx.beginPath();
      ctx.moveTo(extraLeftMargin + axisLabelSize, titleBarHeight + extraTopMargin + axisLabelSize);
      ctx.lineTo(extraLeftMargin + axisLabelSize, titleBarHeight + extraTopMargin + axisLabelSize + gridHeight);
      ctx.stroke();
      // 右侧纵轴左边
      ctx.beginPath();
      ctx.moveTo(extraLeftMargin + axisLabelSize + gridWidth, titleBarHeight + extraTopMargin + axisLabelSize);
      ctx.lineTo(extraLeftMargin + axisLabelSize + gridWidth, titleBarHeight + extraTopMargin + axisLabelSize + gridHeight);
      ctx.stroke();
    }

    // 恢复默认文本对齐和基线，为后续绘制做准备
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 设置用于绘制单元格内容的字体
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 绘制所有单元格
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < N; i++) {
        const cellData = mappedPixelData[j][i];
        // 计算绘制位置，考虑额外边距和标题栏高度
        const drawX = extraLeftMargin + i * downloadCellSize + axisLabelSize;
        const drawY = titleBarHeight + extraTopMargin + j * downloadCellSize + axisLabelSize;

        // 根据是否是外部背景确定填充颜色
        if (cellData && !cellData.isExternal) {
          // 内部单元格：使用珠子颜色填充并绘制文本
          const cellColor = cellData.color || '#FFFFFF';
          const cellKey = getDisplayColorKey(cellData.color || '#FFFFFF', selectedColorSystem);

          ctx.fillStyle = cellColor;
          ctx.fillRect(drawX, drawY, downloadCellSize, downloadCellSize);

          ctx.fillStyle = getContrastColor(cellColor);
          ctx.fillText(cellKey, drawX + downloadCellSize / 2, drawY + downloadCellSize / 2);
        } else {
          // 外部背景：填充白色
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(drawX, drawY, downloadCellSize, downloadCellSize);
        }

        // 绘制所有单元格的边框
        ctx.strokeStyle = '#DDDDDD'; // 浅色线条作为基础网格
        ctx.lineWidth = 0.5;
        ctx.strokeRect(drawX + 0.5, drawY + 0.5, downloadCellSize, downloadCellSize);
      }
    }

    // 如果需要，绘制分隔网格线
    if (showGrid) {
      ctx.strokeStyle = gridLineColor; // 使用用户选择的颜色
      ctx.lineWidth = 1.5;

      // 绘制垂直分隔线 - 在单元格之间而不是边框上
      for (let i = gridInterval; i < N; i += gridInterval) {
        const lineX = extraLeftMargin + i * downloadCellSize + axisLabelSize;
        ctx.beginPath();
        ctx.moveTo(lineX, titleBarHeight + extraTopMargin + axisLabelSize);
        ctx.lineTo(lineX, titleBarHeight + extraTopMargin + axisLabelSize + M * downloadCellSize);
        ctx.stroke();
      }

      // 绘制水平分隔线 - 在单元格之间而不是边框上
      for (let j = gridInterval; j < M; j += gridInterval) {
        const lineY = titleBarHeight + extraTopMargin + j * downloadCellSize + axisLabelSize;
        ctx.beginPath();
        ctx.moveTo(extraLeftMargin + axisLabelSize, lineY);
        ctx.lineTo(extraLeftMargin + axisLabelSize + N * downloadCellSize, lineY);
        ctx.stroke();
      }
    }

    // 绘制整个网格区域的主边框
    ctx.strokeStyle = '#000000'; // 黑色边框
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      extraLeftMargin + axisLabelSize + 0.5,
      titleBarHeight + extraTopMargin + axisLabelSize + 0.5,
      N * downloadCellSize,
      M * downloadCellSize
    );

    // 绘制统计信息
    if (includeStats && colorCounts) {
      const colorKeys = Object.keys(colorCounts).sort(sortColorKeys);

      // 增加额外的间距，防止标题文字侵入画布
      const statsTopMargin = 24; // 增加间距，防止文字侵入画布
      const statsY = titleBarHeight + extraTopMargin + M * downloadCellSize + (axisLabelSize * 2) + statsPadding + statsTopMargin;

      // 计算统计区域的可用宽度
      const availableStatsWidth = downloadWidth - (statsPadding * 2);

      // 根据可用宽度动态计算列数 - 这里使用实际渲染时的宽度
      const renderNumColumns = Math.max(1, Math.min(4, Math.floor(availableStatsWidth / 250)));

      // 根据可用宽度动态计算样式参数，使用更积极的线性缩放
      const baseSwatchSize = 18; // 略微增大基础大小
      // baseStatsFontSize 和 statsFontSize 在前面已经计算了，这里不需要重复
      // const baseItemPadding = 10;

      // 调整缩放公式，使大宽度更明显增大
      // widthFactor 在前面已经计算了，这里不需要重复
      const swatchSize = Math.floor(baseSwatchSize + (widthFactor * 20)); // 增大最大增量幅度
      // statsFontSize 在前面已经计算了，这里不需要重复
      // const itemPadding = Math.floor(baseItemPadding + (widthFactor * 12)); // 增大最大增量幅度 // 移除未使用的 itemPadding

      // 计算每个项目所占的宽度
      const itemWidth = Math.floor(availableStatsWidth / renderNumColumns);

      // 绘制统计区域标题
      ctx.fillStyle = '#333333';
      ctx.font = `bold ${Math.max(16, statsFontSize)}px sans-serif`;
      ctx.textAlign = 'left';

      // 绘制分隔线
      ctx.strokeStyle = '#DDDDDD';
      ctx.beginPath();
      ctx.moveTo(statsPadding, statsY + 20);
      ctx.lineTo(downloadWidth - statsPadding, statsY + 20);
      ctx.stroke();

      const titleHeight = 30; // 标题和分隔线的总高度
      // 根据色块大小动态调整行高
      const statsRowHeight = Math.max(swatchSize + 8, 25); // 确保行高足够放下色块和文字

      // 设置表格字体
      ctx.font = `${statsFontSize}px sans-serif`;

      // 绘制每行统计信息
      colorKeys.forEach((key, index) => {
        // 计算当前项目应该在哪一行和哪一列
        const rowIndex = Math.floor(index / renderNumColumns);
        const colIndex = index % renderNumColumns;

        // 计算当前项目的X起始位置
        const itemX = statsPadding + (colIndex * itemWidth);

        // 计算当前行的Y位置
        const rowY = statsY + titleHeight + (rowIndex * statsRowHeight) + (swatchSize / 2);

        const cellData = colorCounts[key];

        // 绘制色块
        ctx.fillStyle = cellData.color;
        ctx.strokeStyle = '#CCCCCC';
        ctx.fillRect(itemX, rowY - (swatchSize / 2), swatchSize, swatchSize);
        ctx.strokeRect(itemX + 0.5, rowY - (swatchSize / 2) + 0.5, swatchSize - 1, swatchSize - 1);

        // 绘制色号
        ctx.fillStyle = '#333333';
        ctx.textAlign = 'left';
        ctx.fillText(getColorKeyByHex(key, selectedColorSystem), itemX + swatchSize + 5, rowY);

        // 绘制数量 - 在每个项目的右侧
        const countText = `${cellData.count} 颗`;
        ctx.textAlign = 'right';

        // 根据列数计算数字的位置
        // 如果只有一列，就靠右绘制
        if (renderNumColumns === 1) {
          ctx.fillText(countText, downloadWidth - statsPadding, rowY);
        } else {
          // 多列时，在每个单元格右侧偏内绘制
          ctx.fillText(countText, itemX + itemWidth - 10, rowY);
        }
      });

      // 计算实际需要的行数
      const numRows = Math.ceil(colorKeys.length / renderNumColumns);

      // 绘制总量
      const totalY = statsY + titleHeight + (numRows * statsRowHeight) + 10;
      ctx.font = `bold ${statsFontSize}px sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText(`总计: ${totalBeadCount} 颗`, downloadWidth - statsPadding, totalY);

      // 更新统计区域高度的计算 - 需要包含新增的顶部间距
      const footerHeight = 30; // 总计部分高度
      statsHeight = titleHeight + (numRows * statsRowHeight) + footerHeight + (statsPadding * 2) + statsTopMargin;
    }

    // 重新计算画布高度并调整
    if (includeStats && colorCounts) {
      // 调整画布大小，包含计算后的统计区域
      const newDownloadHeight = titleBarHeight + extraTopMargin + M * downloadCellSize + (axisLabelSize * 2) + statsHeight + extraBottomMargin;

      if (downloadHeight !== newDownloadHeight) {
        // 如果高度变化了，需要创建新的画布并复制当前内容
        const newCanvas = document.createElement('canvas');
        newCanvas.width = downloadWidth;
        newCanvas.height = newDownloadHeight;
        const newContext = newCanvas.getContext('2d');

        if (newContext) {
          // 复制原画布内容
          newContext.drawImage(downloadCanvas, 0, 0);

          // 更新画布和上下文引用
          downloadCanvas = newCanvas;
          ctx = newContext;
          ctx.imageSmoothingEnabled = false;

          // 更新高度
          downloadHeight = newDownloadHeight;
        }
      }
    }

    // iOS Safari 对 Blob URL 跨窗口有严格限制，改用 Data URL 方式
    // Data URL 直接内嵌图片数据，无需跨窗口传递 Blob 引用

    // 先检测是否是 iOS Safari
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    const isIOSSafari = isIOS || isSafari;

    try {
      // 使用 toDataURL 生成内嵌数据的 URL（兼容性更好）
      const dataUrl = downloadCanvas.toDataURL('image/png');

      if (!dataUrl || dataUrl === 'data:,') {
        alert('无法生成图纸，请尝试减小图纸尺寸。');
        return;
      }

      // 构建预览 HTML
      const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <title>PerlerCraft 图纸</title>
        <style>
          html,body{height:100%;margin:0;font-family:system-ui,-apple-system,sans-serif;background:#f5f5f5}
          .wrap{display:flex;flex-direction:column;align-items:center;padding:20px;box-sizing:border-box;min-height:100%}
          img{max-width:100%;height:auto;box-shadow:0 4px 18px rgba(0,0,0,0.1);border-radius:8px;background:#fff}
          .tip{color:#666;margin-top:16px;font-size:14px;text-align:center}
          .btn{display:inline-block;margin-top:12px;padding:12px 24px;background:#3b82f6;color:#fff;border-radius:8px;text-decoration:none;font-size:14px}
          .btn:active{background:#2563eb}
        </style>
        <div class="wrap">
          <img src="${dataUrl}" alt="PerlerCraft 图纸" />
          <p class="tip">📱 长按图片可保存到相册</p>
          <a class="btn" href="${dataUrl}" download="bead-grid-${N}x${M}-${selectedColorSystem}.png">点击下载图片</a>
        </div>`;

      if (isIOSSafari) {
        // iOS Safari: 直接替换当前页面内容会导致用户迷失
        // 使用 window.open 打开新标签页，写入完整 HTML
        const newWin = window.open('', '_blank');
        if (newWin && newWin.document) {
          newWin.document.open();
          newWin.document.write(html);
          newWin.document.close();
        } else {
          // 如果弹窗被阻止，使用下载链接方式
          const link = document.createElement('a');
          link.href = dataUrl;
          link.download = `bead-grid-${N}x${M}-${selectedColorSystem}.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          alert('图纸已开始下载，请在下载列表或文件中查看。');
        }
      } else {
        // 非 iOS: 打开新窗口显示预览
        const newWin = window.open('', '_blank');
        if (newWin && newWin.document) {
          newWin.document.open();
          newWin.document.write(html);
          newWin.document.close();
        } else {
          // 弹窗被阻止，直接下载
          const link = document.createElement('a');
          link.href = dataUrl;
          link.download = `bead-grid-${N}x${M}-${selectedColorSystem}.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      }

      console.log('Grid image generated successfully.');
    } catch (e) {
      console.error('生成图纸失败:', e);
      alert('无法生成图纸，请尝试减小图纸尺寸或刷新页面重试。');
    }
  };

  processDownload();
}
