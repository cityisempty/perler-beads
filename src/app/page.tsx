'use client';

import React, { useState, useRef, ChangeEvent, DragEvent, useEffect, useMemo, useCallback } from 'react';
import InstallPWA from '../components/InstallPWA';

// 导入像素化工具和类型
import {
  PixelationMode,
  calculatePixelGrid,
  RgbColor,
  PaletteColor,
  MappedPixel,
  hexToRgb,
  colorDistance,
} from '../utils/pixelation';

// 导入新的类型和组件
import { GridDownloadOptions } from '../types/downloadTypes';
import DownloadSettingsModal, { gridLineColorOptions } from '../components/DownloadSettingsModal';
import { downloadImage, importCsvData } from '../utils/imageDownloader';
import tokenHashes from '../data/tokenHashes';
import {
  DEFAULT_PHONE_MAX_USES,
  isValidPhoneHash,
  isValidPhoneNumber,
  normalizePhoneNumber,
  type PhoneAccessSnapshot,
} from '../lib/phoneAccess';

import {
  colorSystemOptions,
  convertPaletteToColorSystem,
  getColorKeyByHex,
  getMardToHexMapping,
  sortColorsByHue,
  ColorSystem
} from '../utils/colorSystemUtils';

// 添加自定义动画样式
const floatAnimation = `
  @keyframes float {
    0% { transform: translateY(0px); }
    50% { transform: translateY(-5px); }
    100% { transform: translateY(0px); }
  }
  .animate-float {
    animation: float 3s ease-in-out infinite;
  }
`;

const MAX_TOKEN_USES = DEFAULT_PHONE_MAX_USES;
const ACTIVE_TOKEN_KEY = 'perlercraft:activeCodeHash';
const USAGE_STORAGE_PREFIX = 'perlercraft:tokenUsage:';
const IS_TOKEN_GATING_ENABLED = tokenHashes.length > 0;
const IS_PHONE_GATING_ENABLED = true;
const IS_ACCESS_CONTROL_ENABLED = IS_TOKEN_GATING_ENABLED || IS_PHONE_GATING_ENABLED;
const SHOW_INSTALL_PROMPT = false;
const SHOW_FLOATING_TOOLBAR = false;

// 拼豆尺寸常量
const BEAD_SIZE_MM = 2.6; // 豆子直径 (mm)
const BOARD_PEGS = 52;    // 标准豆板每边格数 (52×52)
const BOARD_SIZE_CM = +(BOARD_PEGS * BEAD_SIZE_MM / 10).toFixed(1); // ≈13.5cm

// 手机号验证相关常量
const PHONE_HASH_KEY = 'perlercraft:phoneHash';

const getUsageStorageKey = (tokenHash: string) =>
  `${USAGE_STORAGE_PREFIX}${tokenHash}`;

// Helper function for sorting color keys - 保留原有实现，因为未在utils中导出
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

// --- Define available palette key sets ---
// 从colorSystemMapping.json获取所有MARD色号
const mardToHexMapping = getMardToHexMapping();

// Pre-process the FULL palette data once - 使用colorSystemMapping而不是beadPaletteData
const fullBeadPalette: PaletteColor[] = Object.entries(mardToHexMapping)
  .map(([mardKey, hex]) => {
    const rgb = hexToRgb(hex);
    if (!rgb) {
      console.warn(`Invalid hex code "${hex}" for MARD key "${mardKey}". Skipping.`);
      return null;
    }
    // 使用hex值作为key，符合新的架构设计
    return { key: hex, hex, rgb };
  })
  .filter((color): color is PaletteColor => color !== null);

// ++ Add definition for background color keys ++

// 1. 导入新组件
import PixelatedPreviewCanvas from '../components/PixelatedPreviewCanvas';
import GridTooltip from '../components/GridTooltip';
import CustomPaletteEditor from '../components/CustomPaletteEditor';
import FloatingColorPalette from '../components/FloatingColorPalette';
import FloatingToolbar from '../components/FloatingToolbar';
import MagnifierTool from '../components/MagnifierTool';
import MagnifierSelectionOverlay from '../components/MagnifierSelectionOverlay';
import { loadPaletteSelections, savePaletteSelections, presetToSelections, PaletteSelections } from '../utils/localStorageUtils';
import { TRANSPARENT_KEY, transparentColorData } from '../utils/pixelEditingUtils';

import FocusModePreDownloadModal from '../components/FocusModePreDownloadModal';

export default function Home() {
  const [originalImageSrc, setOriginalImageSrc] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<number>(BOARD_PEGS);
  const [granularityInput, setGranularityInput] = useState<string>(String(BOARD_PEGS));
  const [similarityThreshold, setSimilarityThreshold] = useState<number>(30);
  const [similarityThresholdInput, setSimilarityThresholdInput] = useState<string>("30");
  // 成品尺寸输入状态（cm）— 与格数双向联动
  const [desiredWidthCm, setDesiredWidthCm] = useState<string>((BOARD_PEGS * BEAD_SIZE_MM / 10).toFixed(1));
  // 处理中状态指示
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  // 添加像素化模式状态
  const [pixelationMode, setPixelationMode] = useState<PixelationMode>(PixelationMode.Dominant); // 默认为卡通模式

  // 新增：色号系统选择状态
  const [selectedColorSystem, setSelectedColorSystem] = useState<ColorSystem>('MARD');

  const [activeBeadPalette, setActiveBeadPalette] = useState<PaletteColor[]>(() => {
    return fullBeadPalette; // 默认使用全部颜色
  });
  // 状态变量：存储被排除的颜色（hex值）
  const [excludedColorKeys, setExcludedColorKeys] = useState<Set<string>>(new Set());
  const [showExcludedColors, setShowExcludedColors] = useState<boolean>(false);
  // 用于记录初始网格颜色（hex值），用于显示排除功能
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [initialGridColorKeys, setInitialGridColorKeys] = useState<Set<string>>(new Set());
  const [mappedPixelData, setMappedPixelData] = useState<MappedPixel[][] | null>(null);
  const [gridDimensions, setGridDimensions] = useState<{ N: number; M: number } | null>(null);
  const [colorCounts, setColorCounts] = useState<{ [key: string]: { count: number; color: string } } | null>(null);
  const [totalBeadCount, setTotalBeadCount] = useState<number>(0);
  const [tooltipData, setTooltipData] = useState<{ x: number, y: number, key: string, color: string } | null>(null);
  const [remapTrigger, setRemapTrigger] = useState<number>(0);
  const [isManualColoringMode, setIsManualColoringMode] = useState<boolean>(false);
  const [selectedColor, setSelectedColor] = useState<MappedPixel | null>(null);
  // 手动编辑模式进入前的快照（用于“不保存退出”）
  const manualModeSnapshotRef = useRef<{
    pixelData: MappedPixel[][] | null;
    colorCounts: { [key: string]: { count: number; color: string } } | null;
    totalBeadCount: number;
  } | null>(null);
  // 新增：一键擦除模式状态
  const [isEraseMode, setIsEraseMode] = useState<boolean>(false);
  const [customPaletteSelections, setCustomPaletteSelections] = useState<PaletteSelections>({});
  const [isCustomPaletteEditorOpen, setIsCustomPaletteEditorOpen] = useState<boolean>(false);
  const [isCustomPalette, setIsCustomPalette] = useState<boolean>(false);

  // ++ 新增：下载设置相关状态 ++
  const [isDownloadSettingsOpen, setIsDownloadSettingsOpen] = useState<boolean>(false);
  const [downloadOptions, setDownloadOptions] = useState<GridDownloadOptions>({
    showGrid: true,
    gridInterval: 10,
    showCoordinates: true,
    gridLineColor: gridLineColorOptions[0].value,
    includeStats: true // 默认包含统计信息
  });

  // 新增：高亮相关状态
  const [highlightColorKey, setHighlightColorKey] = useState<string | null>(null);

  // 新增：完整色板切换状态
  const [showFullPalette, setShowFullPalette] = useState<boolean>(false);

  // 新增：颜色替换相关状态
  const [colorReplaceState, setColorReplaceState] = useState<{
    isActive: boolean;
    step: 'select-source' | 'select-target';
    sourceColor?: { key: string; color: string };
  }>({
    isActive: false,
    step: 'select-source'
  });

  // 新增：组件挂载状态
  const [isMounted, setIsMounted] = useState<boolean>(false);

  // 新增：悬浮调色盘状态
  const [isFloatingPaletteOpen, setIsFloatingPaletteOpen] = useState<boolean>(true);

  // 新增：放大镜状态
  const [isMagnifierActive, setIsMagnifierActive] = useState<boolean>(false);
  const [magnifierSelectionArea, setMagnifierSelectionArea] = useState<{
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
  } | null>(null);

  // 新增：活跃工具层级管理
  const [activeFloatingTool, setActiveFloatingTool] = useState<'palette' | 'magnifier' | null>(null);

  // 新增：专心拼豆模式进入前下载提醒弹窗
  const [isFocusModePreDownloadModalOpen, setIsFocusModePreDownloadModalOpen] = useState<boolean>(false);

  // 下载授权码状态
  const tokenHashSet = useMemo(() => new Set(tokenHashes.map((hash) => hash.toLowerCase())), []);

  const [accessControl, setAccessControl] = useState<{
    codeHash: string | null;
    usageCount: number;
    maxUses: number;
  }>({
    codeHash: null,
    usageCount: 0,
    maxUses: MAX_TOKEN_USES
  });
  const [tokenError, setTokenError] = useState<string | null>(null);
  const remainingUses = Math.max(0, accessControl.maxUses - accessControl.usageCount);
  const isTokenActive = Boolean(accessControl.codeHash);
  const maskedToken = accessControl.codeHash
    ? `${accessControl.codeHash.slice(0, 6)}...${accessControl.codeHash.slice(-6)}`
    : '';

  // 手机号验证状态
  const [isPhoneModalOpen, setIsPhoneModalOpen] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [isPhoneSubmitting, setIsPhoneSubmitting] = useState(false);
  const [phoneAccessControl, setPhoneAccessControl] = useState<{
    phoneHash: string | null;
    usageCount: number;
    maxUses: number;
  }>({ phoneHash: null, usageCount: 0, maxUses: MAX_TOKEN_USES });

  const phoneRemainingUses = Math.max(0, phoneAccessControl.maxUses - phoneAccessControl.usageCount);
  const isPhoneActive = Boolean(phoneAccessControl.phoneHash);

  // 综合验证状态：授权码或手机号任一有效即可
  const isAnyAuthActive = isTokenActive || isPhoneActive;
  const totalRemainingUses = isTokenActive ? remainingUses : phoneRemainingUses;
  const totalAvailableUses = isTokenActive ? accessControl.maxUses : phoneAccessControl.maxUses;

  // 放大镜切换处理函数
  const handleToggleMagnifier = () => {
    const newActiveState = !isMagnifierActive;
    setIsMagnifierActive(newActiveState);

    // 如果关闭放大镜，清除选择区域，重新开始
    if (!newActiveState) {
      setMagnifierSelectionArea(null);
    }
  };

  // 激活工具处理函数
  const handleActivatePalette = () => {
    setActiveFloatingTool('palette');
  };

  const handleActivateMagnifier = () => {
    setActiveFloatingTool('magnifier');
  };

  const clearActiveToken = useCallback(() => {
    setAccessControl((prev) => ({
      codeHash: null,
      usageCount: 0,
      maxUses: prev.maxUses,
    }));
    setTokenError(null);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(ACTIVE_TOKEN_KEY);
    }
  }, []);

  const activateCodeHash = useCallback(
    (
      rawCodeHash: string,
      options: { persist?: boolean; showFeedback?: boolean } = {}
    ): boolean => {
      const { persist = true, showFeedback = true } = options;

      if (!IS_TOKEN_GATING_ENABLED) {
        setTokenError('尚未配置授权码批次，请先导入授权哈希。');
        return false;
      }

      const normalized = rawCodeHash.trim().toLowerCase();
      const isSha256String = /^[a-f0-9]{64}$/.test(normalized);

      if (!isSha256String || !tokenHashSet.has(normalized)) {
        if (showFeedback) {
          alert('授权码无效或已停用，请与客服联系。');
          setTokenError('授权码无效或已停用，请与客服联系。');
        }
        return false;
      }

      let usageCount = 0;
      if (typeof window !== 'undefined') {
        const storedUsage = window.localStorage.getItem(
          getUsageStorageKey(normalized)
        );
        if (storedUsage) {
          const parsed = Number(storedUsage);
          usageCount = Number.isFinite(parsed)
            ? Math.min(MAX_TOKEN_USES, Math.max(0, parsed))
            : 0;
        }
        if (persist) {
          window.localStorage.setItem(ACTIVE_TOKEN_KEY, normalized);
        }
      }

      setAccessControl({
        codeHash: normalized,
        usageCount,
        maxUses: MAX_TOKEN_USES,
      });
      setTokenError(null);
      if (showFeedback) {
        alert('授权已激活，可下载图纸。');
      }
      return true;
    },
    [tokenHashSet]
  );

  // 清除手机号验证（用于切换手机号场景）
  const clearPhoneAuth = useCallback(() => {
    setPhoneAccessControl({
      phoneHash: null,
      usageCount: 0,
      maxUses: MAX_TOKEN_USES,
    });
    setPhoneError(null);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(PHONE_HASH_KEY);
    }
  }, []);

  const applyPhoneSnapshot = useCallback((snapshot: PhoneAccessSnapshot) => {
    setPhoneAccessControl({
      phoneHash: snapshot.phoneHash,
      usageCount: snapshot.usageCount,
      maxUses: snapshot.maxUses,
    });
  }, []);

  // 激活手机号验证
  const activatePhone = useCallback(async (phone: string): Promise<boolean> => {
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!isValidPhoneNumber(normalizedPhone)) {
      setPhoneError('请输入正确的手机号格式（11位数字，以1开头）');
      return false;
    }

    setIsPhoneSubmitting(true);
    try {
      const response = await fetch('/api/phone-access/activate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phone: normalizedPhone,
        }),
      });

      const payload = await response.json().catch(() => null) as
        | { data?: PhoneAccessSnapshot; error?: string }
        | null;

      if (!response.ok || !payload?.data) {
        throw new Error(payload?.error ?? '验证失败，请稍后重试');
      }

      if (typeof window !== 'undefined') {
        window.localStorage.setItem(PHONE_HASH_KEY, payload.data.phoneHash);
      }

      applyPhoneSnapshot(payload.data);
      setPhoneError(null);
      setPhoneNumber(normalizedPhone);
      setIsPhoneModalOpen(false);
      return true;
    } catch (error) {
      console.error('手机号验证失败:', error);
      setPhoneError(error instanceof Error ? error.message : '验证失败，请重试');
      return false;
    } finally {
      setIsPhoneSubmitting(false);
    }
  }, [applyPhoneSnapshot]);

  // 恢复手机号验证状态
  const restorePhoneAuth = useCallback(async (hash: string): Promise<boolean> => {
    const normalizedHash = hash.trim().toLowerCase();
    if (!isValidPhoneHash(normalizedHash)) {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(PHONE_HASH_KEY);
      }
      return false;
    }

    try {
      const response = await fetch(
        `/api/phone-access/status?phoneHash=${encodeURIComponent(normalizedHash)}`,
        {
          cache: 'no-store',
        }
      );

      const payload = await response.json().catch(() => null) as
        | { data?: PhoneAccessSnapshot; error?: string }
        | null;

      if (!response.ok || !payload?.data) {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem(PHONE_HASH_KEY);
        }
        return false;
      }

      applyPhoneSnapshot(payload.data);
      return true;
    } catch (error) {
      console.error('恢复手机号验证失败:', error);
      return false;
    }
  }, [applyPhoneSnapshot]);

  // 放大镜像素编辑处理函数
  const handleMagnifierPixelEdit = (row: number, col: number, colorData: { key: string; color: string }) => {
    if (!mappedPixelData) return;

    // 创建新的像素数据
    const newMappedPixelData = mappedPixelData.map((rowData, r) =>
      rowData.map((pixel, c) => {
        if (r === row && c === col) {
          return {
            key: colorData.key,
            color: colorData.color
          } as MappedPixel;
        }
        return pixel;
      })
    );

    setMappedPixelData(newMappedPixelData);

    // 更新颜色统计
    if (colorCounts) {
      const newColorCounts = { ...colorCounts };

      // 减少原颜色的计数
      const oldPixel = mappedPixelData[row][col];
      if (newColorCounts[oldPixel.key]) {
        newColorCounts[oldPixel.key].count--;
        if (newColorCounts[oldPixel.key].count === 0) {
          delete newColorCounts[oldPixel.key];
        }
      }

      // 增加新颜色的计数
      if (newColorCounts[colorData.key]) {
        newColorCounts[colorData.key].count++;
      } else {
        newColorCounts[colorData.key] = {
          count: 1,
          color: colorData.color
        };
      }

      setColorCounts(newColorCounts);

      // 更新总计数
      const newTotal = Object.values(newColorCounts).reduce((sum, item) => sum + item.count, 0);
      setTotalBeadCount(newTotal);
    }
  };

  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const pixelatedCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // ++ 添加: Ref for import file input ++
  const importPaletteInputRef = useRef<HTMLInputElement>(null);
  //const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  // ++ Re-add touch refs needed for tooltip logic ++
  //const touchStartPosRef = useRef<{ x: number; y: number; pageX: number; pageY: number } | null>(null);
  //const touchMovedRef = useRef<boolean>(false);

  // ++ Add a ref for the main element ++
  const mainRef = useRef<HTMLElement>(null);

  // --- Derived State ---

  // Update active palette based on selection and exclusions
  useEffect(() => {
    const newActiveBeadPalette = fullBeadPalette.filter(color => {
      const normalizedHex = color.hex.toUpperCase();
      const isSelectedInCustomPalette = customPaletteSelections[normalizedHex];
      const isNotExcluded = !excludedColorKeys.has(normalizedHex);
      return isSelectedInCustomPalette && isNotExcluded;
    });
    // 根据选择的色号系统转换调色板
    const convertedPalette = convertPaletteToColorSystem(newActiveBeadPalette, selectedColorSystem);
    setActiveBeadPalette(convertedPalette);
  }, [customPaletteSelections, excludedColorKeys, remapTrigger, selectedColorSystem]);

  // ++ 添加：当状态变化时同步更新输入框的值 ++
  useEffect(() => {
    setGranularityInput(granularity.toString());
    setSimilarityThresholdInput(similarityThreshold.toString());
  }, [granularity, similarityThreshold]);

  // ++ Calculate unique colors currently on the grid for the palette ++
  const currentGridColors = useMemo(() => {
    if (!mappedPixelData) return [];
    // 使用hex值进行去重，避免多个MARD色号对应同一个目标色号系统值时产生重复key
    const uniqueColorsMap = new Map<string, MappedPixel>();
    mappedPixelData.flat().forEach(cell => {
      if (cell && cell.color && !cell.isExternal) {
        const hexKey = cell.color.toUpperCase();
        if (!uniqueColorsMap.has(hexKey)) {
          // 存储hex值作为key，保持颜色信息
          uniqueColorsMap.set(hexKey, { key: cell.key, color: cell.color });
        }
      }
    });

    // 转换为数组并为每个hex值生成对应的色号系统显示
    const originalColors = Array.from(uniqueColorsMap.values());

    const colorData = originalColors.map(color => {
      const displayKey = getColorKeyByHex(color.color.toUpperCase(), selectedColorSystem);
      return {
        key: displayKey,
        color: color.color
      };
    });

    // 使用色相排序而不是色号排序
    return sortColorsByHue(colorData);
  }, [mappedPixelData, selectedColorSystem]);

  // 初始化时从本地存储加载自定义色板选择
  useEffect(() => {
    // 尝试从localStorage加载
    const savedSelections = loadPaletteSelections();
    if (savedSelections && Object.keys(savedSelections).length > 0) {
      console.log('从localStorage加载的数据键数量:', Object.keys(savedSelections).length);
      // 验证加载的数据是否都是有效的hex值
      const allHexValues = fullBeadPalette.map(color => color.hex.toUpperCase());
      const validSelections: PaletteSelections = {};
      let hasValidData = false;
      let validCount = 0;
      let invalidCount = 0;

      Object.entries(savedSelections).forEach(([key, value]) => {
        // 严格验证：键必须是有效的hex格式，并且存在于调色板中
        if (/^#[0-9A-F]{6}$/i.test(key) && allHexValues.includes(key.toUpperCase())) {
          validSelections[key.toUpperCase()] = value;
          hasValidData = true;
          validCount++;
        } else {
          invalidCount++;
        }
      });

      console.log(`验证结果: 有效键 ${validCount} 个, 无效键 ${invalidCount} 个`);

      if (hasValidData) {
        setCustomPaletteSelections(validSelections);
        setIsCustomPalette(true);
      } else {
        console.log('所有数据都无效，清除localStorage并重新初始化');
        // 如果本地数据无效，清除localStorage并默认选择所有颜色
        localStorage.removeItem('customPerlerPaletteSelections');
        const allHexValues = fullBeadPalette.map(color => color.hex.toUpperCase());
        const initialSelections = presetToSelections(allHexValues, allHexValues);
        setCustomPaletteSelections(initialSelections);
        setIsCustomPalette(false);
      }
    } else {
      console.log('没有localStorage数据，默认选择所有颜色');
      // 如果没有保存的选择，默认选择所有颜色
      const allHexValues = fullBeadPalette.map(color => color.hex.toUpperCase());
      const initialSelections = presetToSelections(allHexValues, allHexValues);
      setCustomPaletteSelections(initialSelections);
      setIsCustomPalette(false);
    }
  }, []); // 只在组件首次加载时执行

  // 更新 activeBeadPalette 基于自定义选择和排除列表
  useEffect(() => {
    const newActiveBeadPalette = fullBeadPalette.filter(color => {
      const normalizedHex = color.hex.toUpperCase();
      const isSelectedInCustomPalette = customPaletteSelections[normalizedHex];
      // 使用hex值进行排除检查
      const isNotExcluded = !excludedColorKeys.has(normalizedHex);
      return isSelectedInCustomPalette && isNotExcluded;
    });
    // 不进行色号系统转换，保持原始的MARD色号和hex值
    setActiveBeadPalette(newActiveBeadPalette);
  }, [customPaletteSelections, excludedColorKeys, remapTrigger]);

  // --- Event Handlers ---

  // 专心拼豆模式相关处理函数（按钮已移除，保留 modal 逻辑以备后用）
  const handleProceedToFocusMode = () => {
    // 保存数据到localStorage供专心拼豆模式使用
    localStorage.setItem('focusMode_pixelData', JSON.stringify(mappedPixelData));
    localStorage.setItem('focusMode_gridDimensions', JSON.stringify(gridDimensions));
    localStorage.setItem('focusMode_colorCounts', JSON.stringify(colorCounts));
    localStorage.setItem('focusMode_selectedColorSystem', selectedColorSystem);

    // 跳转到专心拼豆页面
    window.location.href = '/focus';
  };

  // 添加一个安全的文件输入触发函数
  const triggerFileInput = useCallback(() => {
    // 检查组件是否已挂载
    if (!isMounted) {
      console.warn("组件尚未完全挂载，延迟触发文件选择");
      setTimeout(() => triggerFileInput(), 200);
      return;
    }

    // 检查 ref 是否存在
    if (fileInputRef.current) {
      try {
        fileInputRef.current.click();
      } catch (error) {
        console.error("触发文件选择失败:", error);
        // 如果直接点击失败，尝试延迟执行
        setTimeout(() => {
          try {
            fileInputRef.current?.click();
          } catch (retryError) {
            console.error("重试触发文件选择失败:", retryError);
          }
        }, 100);
      }
    } else {
      // 如果 ref 不存在，延迟重试
      console.warn("文件输入引用不存在，将在100ms后重试");
      setTimeout(() => {
        if (fileInputRef.current) {
          try {
            fileInputRef.current.click();
          } catch (error) {
            console.error("延迟触发文件选择失败:", error);
          }
        }
      }, 100);
    }
  }, [isMounted]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // 检查文件类型是否支持
      const fileName = file.name.toLowerCase();
      const fileType = file.type.toLowerCase();

      // 支持的图片类型
      const supportedImageTypes = ['image/jpeg', 'image/jpg', 'image/png'];
      // 支持的CSV MIME类型（不同浏览器可能返回不同的MIME类型）
      const supportedCsvTypes = ['text/csv', 'application/csv', 'text/plain'];

      const isImageFile = supportedImageTypes.includes(fileType) || fileType.startsWith('image/');
      const isCsvFile = supportedCsvTypes.includes(fileType) || fileName.endsWith('.csv');

      if (isImageFile || isCsvFile) {
        setExcludedColorKeys(new Set()); // ++ 重置排除列表 ++
        processFile(file);
      } else {
        alert(`不支持的文件类型: ${file.type || '未知'}。请选择 JPG、PNG 格式的图片文件，或 CSV 数据文件。\n文件名: ${file.name}`);
        console.warn(`Unsupported file type: ${file.type}, file name: ${file.name}`);
      }
    }
    // 重置文件输入框的值，这样用户可以重新选择同一个文件
    if (event.target) {
      event.target.value = '';
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    try {
      if (event.dataTransfer.files && event.dataTransfer.files[0]) {
        const file = event.dataTransfer.files[0];

        // 使用与handleFileChange相同的文件类型检查逻辑
        const fileName = file.name.toLowerCase();
        const fileType = file.type.toLowerCase();

        // 支持的图片类型
        const supportedImageTypes = ['image/jpeg', 'image/jpg', 'image/png'];
        // 支持的CSV MIME类型（不同浏览器可能返回不同的MIME类型）
        const supportedCsvTypes = ['text/csv', 'application/csv', 'text/plain'];

        const isImageFile = supportedImageTypes.includes(fileType) || fileType.startsWith('image/');
        const isCsvFile = supportedCsvTypes.includes(fileType) || fileName.endsWith('.csv');

        if (isImageFile || isCsvFile) {
          setExcludedColorKeys(new Set()); // ++ 重置排除列表 ++
          processFile(file);
        } else {
          alert(`不支持的文件类型: ${file.type || '未知'}。请拖放 JPG、PNG 格式的图片文件，或 CSV 数据文件。\n文件名: ${file.name}`);
          console.warn(`Unsupported file type: ${file.type}, file name: ${file.name}`);
        }
      }
    } catch (error) {
      console.error("处理拖拽文件时发生错误:", error);
      alert("处理文件时发生错误，请重试。");
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  // 根据mappedPixelData生成合成的originalImageSrc
  const generateSyntheticImageFromPixelData = (pixelData: MappedPixel[][], dimensions: { N: number; M: number }): string => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      console.error('无法创建canvas上下文');
      return '';
    }

    // 设置画布尺寸，每个像素用8x8像素来表示以确保清晰度
    const pixelSize = 8;
    canvas.width = dimensions.N * pixelSize;
    canvas.height = dimensions.M * pixelSize;

    // 绘制每个像素
    pixelData.forEach((row, rowIndex) => {
      row.forEach((cell, colIndex) => {
        if (cell) {
          // 使用颜色，外部单元格用白色
          const color = cell.isExternal ? '#FFFFFF' : cell.color;
          ctx.fillStyle = color;
          ctx.fillRect(
            colIndex * pixelSize,
            rowIndex * pixelSize,
            pixelSize,
            pixelSize
          );
        }
      });
    });

    // 转换为dataURL
    return canvas.toDataURL('image/png');
  };

  const processFile = (file: File) => {
    // 检查文件类型
    const fileExtension = file.name.split('.').pop()?.toLowerCase();

    if (fileExtension === 'csv') {
      // 处理CSV文件
      console.log('正在导入CSV文件...');
      importCsvData(file)
        .then(({ mappedPixelData, gridDimensions }) => {
          console.log(`成功导入CSV文件: ${gridDimensions.N}x${gridDimensions.M}`);

          // 设置导入的数据
          setMappedPixelData(mappedPixelData);
          setGridDimensions(gridDimensions);
          setOriginalImageSrc(null); // CSV导入时没有原始图片

          // 计算颜色统计
          const colorCountsMap: { [key: string]: { count: number; color: string } } = {};
          let totalCount = 0;

          mappedPixelData.forEach(row => {
            row.forEach(cell => {
              if (cell && !cell.isExternal) {
                const colorKey = cell.color.toUpperCase();
                if (colorCountsMap[colorKey]) {
                  colorCountsMap[colorKey].count++;
                } else {
                  colorCountsMap[colorKey] = {
                    count: 1,
                    color: cell.color
                  };
                }
                totalCount++;
              }
            });
          });

          setColorCounts(colorCountsMap);
          setTotalBeadCount(totalCount);
          setInitialGridColorKeys(new Set(Object.keys(colorCountsMap)));

          // 根据mappedPixelData生成合成的originalImageSrc
          const syntheticImageSrc = generateSyntheticImageFromPixelData(mappedPixelData, gridDimensions);

          setOriginalImageSrc(syntheticImageSrc);

          // 重置状态
          setIsManualColoringMode(false);
          setSelectedColor(null);
          setIsEraseMode(false);

          // 设置格子数量为导入的尺寸，避免重新映射时尺寸被修改
          setGranularity(gridDimensions.N);
          setGranularityInput(gridDimensions.N.toString());

          alert(`成功导入CSV文件！图纸尺寸：${gridDimensions.N}x${gridDimensions.M}，共使用${Object.keys(colorCountsMap).length}种颜色。`);
        })
        .catch(error => {
          console.error('CSV导入失败:', error);
          alert(`CSV导入失败：${error.message}`);
        });
    } else {
      // 处理图片文件
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        setOriginalImageSrc(result);
        setMappedPixelData(null);
        setGridDimensions(null);
        setColorCounts(null);
        setTotalBeadCount(0);
        setInitialGridColorKeys(new Set()); // ++ 重置初始键 ++
        // ++ 重置横轴格子数量为默认值（一张标准豆板）++
        const defaultGranularity = BOARD_PEGS;
        setGranularity(defaultGranularity);
        setGranularityInput(defaultGranularity.toString());
        setDesiredWidthCm((defaultGranularity * BEAD_SIZE_MM / 10).toFixed(1));
      };
      reader.onerror = () => {
        console.error("文件读取失败");
        alert("无法读取文件。");
        setInitialGridColorKeys(new Set()); // ++ 重置初始键 ++
      }
      reader.readAsDataURL(file);
      // ++ Reset manual coloring mode when a new file is processed ++
      setIsManualColoringMode(false);
      setSelectedColor(null);
      setIsEraseMode(false);
    }
  };

  // 处理一键擦除模式切换
  const handleEraseToggle = () => {
    // 确保在手动上色模式下才能使用擦除功能
    if (!isManualColoringMode) {
      return;
    }

    // 如果当前在颜色替换模式，先退出替换模式
    if (colorReplaceState.isActive) {
      setColorReplaceState({
        isActive: false,
        step: 'select-source'
      });
      setHighlightColorKey(null);
    }

    setIsEraseMode(!isEraseMode);
    // 如果开启擦除模式，取消选中的颜色
    if (!isEraseMode) {
      setSelectedColor(null);
    }
  };

  // ++ 处理图纸宽度格数输入变化（同时更新cm显示）++
  const handleGranularityInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setGranularityInput(value);
    const n = parseInt(value, 10);
    if (!isNaN(n) && n > 0) {
      setDesiredWidthCm((n * BEAD_SIZE_MM / 10).toFixed(1));
    }
  };

  // ++ 处理成品宽度cm输入变化（反向计算格数）++
  const handleDesiredWidthCmChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setDesiredWidthCm(value);
    const cm = parseFloat(value);
    if (!isNaN(cm) && cm > 0) {
      const gridCount = Math.round(cm * 10 / BEAD_SIZE_MM);
      const clamped = Math.max(10, Math.min(300, gridCount));
      setGranularityInput(clamped.toString());
    }
  };

  // ++ 添加：处理相似度输入框变化的函数 ++
  const handleSimilarityThresholdInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSimilarityThresholdInput(event.target.value);
  };

  // 像素化模式切换处理 - 立即应用
  const handlePixelationModeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const newMode = event.target.value as PixelationMode;
    if (Object.values(PixelationMode).includes(newMode)) {
      setPixelationMode(newMode);
      setRemapTrigger(prev => prev + 1); // 触发重新映射
      setIsManualColoringMode(false); // 退出手动模式
      setSelectedColor(null);
    } else {
      console.warn(`无效的像素化模式: ${newMode}`);
    }
  };

  // 修改pixelateImage函数接收模式参数
  const pixelateImage = (imageSrc: string, detailLevel: number, threshold: number, currentPalette: PaletteColor[], mode: PixelationMode) => {
    console.log(`Attempting to pixelate with detail: ${detailLevel}, threshold: ${threshold}, mode: ${mode}`);
    setIsProcessing(true); // 开始处理
    const originalCanvas = originalCanvasRef.current;
    const pixelatedCanvas = pixelatedCanvasRef.current;

    if (!originalCanvas || !pixelatedCanvas) { console.error("Canvas ref(s) not available."); return; }
    const originalCtx = originalCanvas.getContext('2d', { willReadFrequently: true });
    const pixelatedCtx = pixelatedCanvas.getContext('2d');
    if (!originalCtx || !pixelatedCtx) { console.error("Canvas context(s) not found."); return; }
    console.log("Canvas contexts obtained.");

    if (currentPalette.length === 0) {
      console.error("Cannot pixelate: The selected color palette is empty (likely due to exclusions).");
      alert("错误：当前可用颜色板为空（可能所有颜色都被排除了），无法处理图像。请尝试恢复部分颜色。");
      // Clear previous results visually
      pixelatedCtx.clearRect(0, 0, pixelatedCanvas.width, pixelatedCanvas.height);
      setMappedPixelData(null);
      setGridDimensions(null);
      // Keep colorCounts potentially showing the last valid counts? Or clear them too?
      // setColorCounts(null); // Decide if clearing counts is desired when palette is empty
      // setTotalBeadCount(0);
      return; // Stop processing
    }
    const t1FallbackColor = currentPalette.find(p => p.key === 'T1')
      || currentPalette.find(p => p.hex.toUpperCase() === '#FFFFFF')
      || currentPalette[0]; // 使用第一个可用颜色作为备用
    console.log("Using fallback color for empty cells:", t1FallbackColor);

    const img = new window.Image();

    img.onerror = (error: Event | string) => {
      console.error("Image loading failed:", error);
      alert("无法加载图片。");
      setOriginalImageSrc(null);
      setMappedPixelData(null);
      setGridDimensions(null);
      setColorCounts(null);
      setInitialGridColorKeys(new Set());
    };

    img.onload = () => {
      console.log("Image loaded successfully.");
      const aspectRatio = img.height / img.width;
      const N = detailLevel;
      const M = Math.max(1, Math.round(N * aspectRatio));
      if (N <= 0 || M <= 0) { console.error("Invalid grid dimensions:", { N, M }); return; }
      console.log(`Grid size: ${N}x${M}`);

      // 动态调整画布尺寸：当格子数量大于100时，增加画布尺寸以保持每个格子的可见性
      const baseWidth = 500;
      const minCellSize = 4; // 每个格子的最小尺寸（像素）
      const recommendedCellSize = 6; // 推荐的格子尺寸（像素）

      let outputWidth = baseWidth;

      // 如果格子数量大于100，计算需要的画布宽度
      if (N > 100) {
        const requiredWidthForMinSize = N * minCellSize;
        const requiredWidthForRecommendedSize = N * recommendedCellSize;

        // 使用推荐尺寸，但不超过屏幕宽度的90%（最大1200px）
        const maxWidth = Math.min(1200, window.innerWidth * 0.9);
        outputWidth = Math.min(maxWidth, Math.max(baseWidth, requiredWidthForRecommendedSize));

        // 确保不小于最小要求
        outputWidth = Math.max(outputWidth, requiredWidthForMinSize);

        console.log(`Large grid detected (${N} columns). Adjusted canvas width from ${baseWidth} to ${outputWidth}px (cell size: ${Math.round(outputWidth / N)}px)`);
      }

      const outputHeight = Math.round(outputWidth * aspectRatio);

      // 在控制台提示用户画布尺寸变化
      if (N > 100) {
        console.log(`💡 由于格子数量较多 (${N}x${M})，画布已自动放大以保持清晰度。可以使用水平滚动查看完整图像。`);
      }
      originalCanvas.width = img.width; originalCanvas.height = img.height;
      pixelatedCanvas.width = outputWidth; pixelatedCanvas.height = outputHeight;
      console.log(`Canvas dimensions: Original ${img.width}x${img.height}, Output ${outputWidth}x${outputHeight}`);

      originalCtx.drawImage(img, 0, 0, img.width, img.height);
      console.log("Original image drawn.");

      // 1. 使用calculatePixelGrid进行初始颜色映射
      console.log("Starting initial color mapping using calculatePixelGrid...");
      const initialMappedData = calculatePixelGrid(
        originalCtx,
        img.width,
        img.height,
        N,
        M,
        currentPalette,
        mode,
        t1FallbackColor
      );
      console.log(`Initial data mapping complete using mode ${mode}. Starting global color merging...`);

      // --- 新的全局颜色合并逻辑 ---
      const keyToRgbMap = new Map<string, RgbColor>();
      const keyToColorDataMap = new Map<string, PaletteColor>();
      currentPalette.forEach(p => {
        keyToRgbMap.set(p.key, p.rgb);
        keyToColorDataMap.set(p.key, p);
      });

      // 2. 统计初始颜色数量
      const initialColorCounts: { [key: string]: number } = {};
      initialMappedData.flat().forEach(cell => {
        if (cell && cell.key) {
          initialColorCounts[cell.key] = (initialColorCounts[cell.key] || 0) + 1;
        }
      });
      console.log("Initial color counts:", initialColorCounts);

      // 3. 创建一个颜色排序列表，按出现频率从高到低排序
      const colorsByFrequency = Object.entries(initialColorCounts)
        .sort((a, b) => b[1] - a[1])  // 按频率降序排序
        .map(entry => entry[0]);      // 只保留颜色键

      if (colorsByFrequency.length === 0) {
        console.log("No non-background colors found! Skipping merging.");
      }

      console.log("Colors sorted by frequency:", colorsByFrequency);

      // 4. 复制初始数据，准备合并
      const mergedData: MappedPixel[][] = initialMappedData.map(row =>
        row.map(cell => ({ ...cell, isExternal: false }))
      );

      // 5. 处理相似颜色合并
      const similarityThresholdValue = threshold;

      // 已被合并（替换）的颜色集合
      const replacedColors = new Set<string>();

      // 对每个颜色按频率从高到低处理
      for (let i = 0; i < colorsByFrequency.length; i++) {
        const currentKey = colorsByFrequency[i];

        // 如果当前颜色已经被合并到更频繁的颜色中，跳过
        if (replacedColors.has(currentKey)) continue;

        const currentRgb = keyToRgbMap.get(currentKey);
        if (!currentRgb) {
          console.warn(`RGB not found for key ${currentKey}. Skipping.`);
          continue;
        }

        // 检查剩余的低频颜色
        for (let j = i + 1; j < colorsByFrequency.length; j++) {
          const lowerFreqKey = colorsByFrequency[j];

          // 如果低频颜色已被替换，跳过
          if (replacedColors.has(lowerFreqKey)) continue;

          const lowerFreqRgb = keyToRgbMap.get(lowerFreqKey);
          if (!lowerFreqRgb) {
            console.warn(`RGB not found for key ${lowerFreqKey}. Skipping.`);
            continue;
          }

          // 计算颜色距离
          const dist = colorDistance(currentRgb, lowerFreqRgb);

          // 如果距离小于阈值，将低频颜色替换为高频颜色
          if (dist < similarityThresholdValue) {
            console.log(`Merging color ${lowerFreqKey} into ${currentKey} (Distance: ${dist.toFixed(2)})`);

            // 标记这个颜色已被替换
            replacedColors.add(lowerFreqKey);

            // 替换所有使用这个低频颜色的单元格
            for (let r = 0; r < M; r++) {
              for (let c = 0; c < N; c++) {
                if (mergedData[r][c].key === lowerFreqKey) {
                  const colorData = keyToColorDataMap.get(currentKey);
                  if (colorData) {
                    mergedData[r][c] = {
                      key: currentKey,
                      color: colorData.hex,
                      isExternal: false
                    };
                  }
                }
              }
            }
          }
        }
      }

      if (replacedColors.size > 0) {
        console.log(`Merged ${replacedColors.size} less frequent similar colors into more frequent ones.`);
      } else {
        console.log("No colors were similar enough to merge.");
      }
      // --- 结束新的全局颜色合并逻辑 ---

      // --- 绘制和状态更新 ---
      if (pixelatedCanvasRef.current) {
        setMappedPixelData(mergedData);
        setGridDimensions({ N, M });

        const counts: { [key: string]: { count: number; color: string } } = {};
        let totalCount = 0;
        mergedData.flat().forEach(cell => {
          if (cell && cell.key && !cell.isExternal) {
            // 使用hex值作为统计键值，而不是色号
            const hexKey = cell.color;
            if (!counts[hexKey]) {
              counts[hexKey] = { count: 0, color: cell.color };
            }
            counts[hexKey].count++;
            totalCount++;
          }
        });
        setColorCounts(counts);
        setTotalBeadCount(totalCount);
        setInitialGridColorKeys(new Set(Object.keys(counts)));
        console.log("Color counts updated based on merged data (after merging):", counts);
        console.log("Total bead count (total beads):", totalCount);
        console.log("Stored initial grid color keys:", Object.keys(counts));
        setIsProcessing(false); // 处理完成
      } else {
        console.error("Pixelated canvas ref is null, skipping draw call in pixelateImage.");
        setIsProcessing(false); // 处理失败也要重置
      }
    }; // 正确闭合 img.onload 函数

    console.log("Setting image source...");
    img.src = imageSrc;
    setIsManualColoringMode(false);
    setSelectedColor(null);
  }; // 正确闭合 pixelateImage 函数

  // 修改useEffect中的pixelateImage调用，加入模式参数
  useEffect(() => {
    if (originalImageSrc && activeBeadPalette.length > 0) {
      const timeoutId = setTimeout(() => {
        if (originalImageSrc && originalCanvasRef.current && pixelatedCanvasRef.current && activeBeadPalette.length > 0) {
          console.log("useEffect triggered: Processing image due to src, granularity, threshold, palette selection, mode or remap trigger.");
          pixelateImage(originalImageSrc, granularity, similarityThreshold, activeBeadPalette, pixelationMode);
        } else {
          console.warn("useEffect check failed inside timeout: Refs or active palette not ready/empty.");
        }
      }, 50);
      return () => clearTimeout(timeoutId);
    } else if (originalImageSrc && activeBeadPalette.length === 0) {
      console.warn("Image selected, but the active palette is empty after exclusions. Cannot process. Clearing preview.");
      const pixelatedCanvas = pixelatedCanvasRef.current;
      const pixelatedCtx = pixelatedCanvas?.getContext('2d');
      if (pixelatedCtx && pixelatedCanvas) {
        pixelatedCtx.clearRect(0, 0, pixelatedCanvas.width, pixelatedCanvas.height);
        // Draw a message on the canvas?
        pixelatedCtx.fillStyle = '#6b7280'; // gray-500
        pixelatedCtx.font = '16px sans-serif';
        pixelatedCtx.textAlign = 'center';
        pixelatedCtx.fillText('无可用颜色，请恢复部分排除的颜色', pixelatedCanvas.width / 2, pixelatedCanvas.height / 2);
      }
      setMappedPixelData(null);
      setGridDimensions(null);
      // Keep colorCounts to allow user to un-exclude colors
      // setColorCounts(null);
      // setTotalBeadCount(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originalImageSrc, granularity, similarityThreshold, customPaletteSelections, pixelationMode, remapTrigger]);

  // ++ Debounce 自动应用参数：用户修改输入框后 800ms 自动重新渲染 ++
  const granularityRef = useRef(granularity);
  const similarityRef = useRef(similarityThreshold);
  useEffect(() => { granularityRef.current = granularity; }, [granularity]);
  useEffect(() => { similarityRef.current = similarityThreshold; }, [similarityThreshold]);

  useEffect(() => {
    if (!originalImageSrc) return;

    const timer = setTimeout(() => {
      const minGranularity = 10;
      const maxGranularity = 300;
      let newGranularity = parseInt(granularityInput, 10);
      if (isNaN(newGranularity) || newGranularity < minGranularity) newGranularity = minGranularity;
      else if (newGranularity > maxGranularity) newGranularity = maxGranularity;

      const minSimilarity = 0;
      const maxSimilarity = 100;
      let newSimilarity = parseInt(similarityThresholdInput, 10);
      if (isNaN(newSimilarity) || newSimilarity < minSimilarity) newSimilarity = minSimilarity;
      else if (newSimilarity > maxSimilarity) newSimilarity = maxSimilarity;

      const granularityChanged = newGranularity !== granularityRef.current;
      const similarityChanged = newSimilarity !== similarityRef.current;

      if (granularityChanged || similarityChanged) {
        if (granularityChanged) setGranularity(newGranularity);
        if (similarityChanged) setSimilarityThreshold(newSimilarity);
        // granularity/similarityThreshold 变化会自动触发上面的 useEffect -> pixelateImage
        setIsManualColoringMode(false);
        setSelectedColor(null);
      }

      setGranularityInput(newGranularity.toString());
      setSimilarityThresholdInput(newSimilarity.toString());
      // 同步更新cm显示
      setDesiredWidthCm((newGranularity * BEAD_SIZE_MM / 10).toFixed(1));
    }, 800);

    return () => clearTimeout(timer);
  }, [granularityInput, similarityThresholdInput, originalImageSrc]);

  // 确保文件输入框引用在组件挂载后正确设置
  useEffect(() => {
    // 延迟执行，确保DOM完全渲染
    const timer = setTimeout(() => {
      if (!fileInputRef.current) {
        console.warn("文件输入框引用在组件挂载后仍为null，这可能会导致上传功能异常");
      }
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  // 恢复上次使用的授权码
  useEffect(() => {
    if (!IS_TOKEN_GATING_ENABLED || typeof window === 'undefined') {
      return;
    }

    const storedCodeHash = window.localStorage.getItem(ACTIVE_TOKEN_KEY);
    if (storedCodeHash) {
      const restored = activateCodeHash(storedCodeHash, {
        persist: true,
        showFeedback: false,
      });
      if (!restored) {
        window.localStorage.removeItem(ACTIVE_TOKEN_KEY);
      }
    }
  }, [activateCodeHash]);

  // 处理链接中的授权码参数
  useEffect(() => {
    if (!IS_TOKEN_GATING_ENABLED || typeof window === 'undefined') {
      return;
    }

    const url = new URL(window.location.href);
    const codeParam = url.searchParams.get('code');
    if (!codeParam) {
      return;
    }

    const activated = activateCodeHash(codeParam, {
      persist: true,
      showFeedback: false,
    });

    if (activated) {
      url.searchParams.delete('code');
      window.history.replaceState(null, '', url.toString());
      alert('授权已激活，可下载图纸。');
    }
  }, [activateCodeHash]);

  // 恢复手机号验证状态
  useEffect(() => {
    if (!IS_PHONE_GATING_ENABLED || typeof window === 'undefined') {
      return;
    }

    const storedPhoneHash = window.localStorage.getItem(PHONE_HASH_KEY);
    if (storedPhoneHash) {
      restorePhoneAuth(storedPhoneHash).then((restored) => {
        if (!restored && !window.localStorage.getItem(ACTIVE_TOKEN_KEY)) {
          setIsPhoneModalOpen(true);
        }
      });
    }
  }, [restorePhoneAuth]);

  // 如果没有任何验证，弹出手机号输入框
  useEffect(() => {
    if (!IS_ACCESS_CONTROL_ENABLED || typeof window === 'undefined') {
      return;
    }

    // 延迟检查，确保授权码和手机号恢复逻辑都已执行
    const timer = setTimeout(() => {
      const hasTokenAuth = window.localStorage.getItem(ACTIVE_TOKEN_KEY);
      const hasPhoneAuth = window.localStorage.getItem(PHONE_HASH_KEY);

      if (!hasTokenAuth && !hasPhoneAuth) {
        setIsPhoneModalOpen(true);
      }
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  // 设置组件挂载状态
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // --- Download function (ensure filename includes palette) ---
  const handleDownloadRequest = async (options?: GridDownloadOptions) => {
    if (IS_ACCESS_CONTROL_ENABLED) {
      // 检查是否有任何有效验证
      if (!isAnyAuthActive) {
        setTokenError('请通过授权链接或输入手机号后再下载图纸。');
        setIsPhoneModalOpen(true);
        return;
      }
      // 检查剩余次数
      if (totalRemainingUses <= 0) {
        const errorMsg = isTokenActive
          ? '该授权码已用完下载次数，请联系管理员续费。'
          : '该手机号已用完下载次数，请联系管理员续费。';
        setTokenError(errorMsg);
        alert(errorMsg);
        return;
      }
      setTokenError(null);
    }

    try {
      await downloadImage({
        mappedPixelData,
        gridDimensions,
        colorCounts,
        totalBeadCount,
        options: options || downloadOptions,
        activeBeadPalette,
        selectedColorSystem
      });

      if (IS_ACCESS_CONTROL_ENABLED) {
        // 根据当前激活的验证方式更新使用次数
        if (isTokenActive) {
          setAccessControl((prev) => {
            if (!prev.codeHash) {
              return prev;
            }
            const newUsage = Math.min(prev.maxUses, prev.usageCount + 1);
            if (typeof window !== 'undefined') {
              window.localStorage.setItem(
                getUsageStorageKey(prev.codeHash),
                String(newUsage)
              );
            }
            return {
              ...prev,
              usageCount: newUsage,
            };
          });
        } else if (isPhoneActive && phoneAccessControl.phoneHash) {
          const response = await fetch('/api/phone-access/deduct', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              phoneHash: phoneAccessControl.phoneHash,
            }),
          });

          const payload = await response.json().catch(() => null) as
            | { data?: PhoneAccessSnapshot; error?: string }
            | null;

          if (!response.ok || !payload?.data) {
            throw new Error(payload?.error ?? '扣减手机号次数失败，请稍后重试。');
          }

          applyPhoneSnapshot(payload.data);
        }
        setTokenError(null);
      }
    } catch (error) {
      console.error('下载图纸失败:', error);
    }
  };

  // --- Handler to toggle color exclusion (真正删除模式：标记为透明而非重映射) ---
  const handleToggleExcludeColor = (hexKey: string) => {
    const currentExcluded = excludedColorKeys;
    const isExcluding = !currentExcluded.has(hexKey);

    if (isExcluding) {
      console.log(`---------\nExcluding color: ${hexKey} (marking as transparent)`);

      if (!mappedPixelData || !gridDimensions) {
        console.error("Cannot exclude color: Missing pixel data.");
        alert("无法移除颜色，像素数据尚未准备好。");
        return;
      }

      const nextExcludedKeys = new Set(currentExcluded);
      nextExcludedKeys.add(hexKey);

      // 将使用该颜色的像素标记为透明/外部（真正删除，不替换为其他颜色）
      const newMappedData = mappedPixelData.map(row => row.map(cell => ({ ...cell })));
      let removedCount = 0;
      const { N, M } = gridDimensions;

      for (let j = 0; j < M; j++) {
        for (let i = 0; i < N; i++) {
          const cell = newMappedData[j]?.[i];
          if (cell && !cell.isExternal && cell.color.toUpperCase() === hexKey) {
            // 标记为透明/外部 — 真正删除，不重映射
            newMappedData[j][i] = {
              key: TRANSPARENT_KEY,
              color: '#FFFFFF',
              isExternal: true
            };
            removedCount++;
          }
        }
      }
      console.log(`Removed ${removedCount} cells of color ${hexKey} (set to transparent)`);

      // 更新状态
      setExcludedColorKeys(nextExcludedKeys);
      setMappedPixelData(newMappedData);

      // 重新计算计数（排除的颜色不再参与统计）
      const newCounts: { [hexKey: string]: { count: number; color: string } } = {};
      let newTotalCount = 0;
      newMappedData.flat().forEach(cell => {
        if (cell && cell.color && !cell.isExternal && cell.key !== TRANSPARENT_KEY) {
          const cellHex = cell.color.toUpperCase();
          if (!newCounts[cellHex]) {
            newCounts[cellHex] = { count: 0, color: cellHex };
          }
          newCounts[cellHex].count++;
          newTotalCount++;
        }
      });
      setColorCounts(newCounts);
      setTotalBeadCount(newTotalCount);
      console.log("Color removed and stats updated.");
      console.log("---------");

    } else {
      // --- Re-including ---
      console.log(`---------\nAttempting to RE-INCLUDE color: ${hexKey}`);
      console.log(`Re-including color: ${hexKey}. Triggering full remap.`);
      const nextExcludedKeys = new Set(currentExcluded);
      nextExcludedKeys.delete(hexKey);
      setExcludedColorKeys(nextExcludedKeys);
      // 完全重处理图像以恢复颜色
      setRemapTrigger(prev => prev + 1);
      console.log("---------");
    }
    // ++ Exit manual mode if colors are excluded/included ++
    setIsManualColoringMode(false);
    setSelectedColor(null);
  };

  // --- Tooltip Logic ---

  // --- Canvas Interaction ---

  // 洪水填充擦除函数
  const floodFillErase = (startRow: number, startCol: number, targetKey: string) => {
    if (!mappedPixelData || !gridDimensions) return;

    const { N, M } = gridDimensions;
    const newPixelData = mappedPixelData.map(row => row.map(cell => ({ ...cell })));
    const visited = Array(M).fill(null).map(() => Array(N).fill(false));

    // 使用栈实现非递归洪水填充
    const stack = [{ row: startRow, col: startCol }];

    while (stack.length > 0) {
      const { row, col } = stack.pop()!;

      // 检查边界
      if (row < 0 || row >= M || col < 0 || col >= N || visited[row][col]) {
        continue;
      }

      const currentCell = newPixelData[row][col];

      // 检查是否是目标颜色且不是外部区域
      if (!currentCell || currentCell.isExternal || currentCell.key !== targetKey) {
        continue;
      }

      // 标记为已访问
      visited[row][col] = true;

      // 擦除当前像素（设为透明）
      newPixelData[row][col] = { ...transparentColorData };

      // 添加相邻像素到栈中
      stack.push(
        { row: row - 1, col }, // 上
        { row: row + 1, col }, // 下
        { row, col: col - 1 }, // 左
        { row, col: col + 1 }  // 右
      );
    }

    // 更新状态
    setMappedPixelData(newPixelData);

    // 重新计算颜色统计
    if (colorCounts) {
      const newColorCounts: { [hexKey: string]: { count: number; color: string } } = {};
      let newTotalCount = 0;

      newPixelData.flat().forEach(cell => {
        if (cell && !cell.isExternal && cell.key !== TRANSPARENT_KEY) {
          const cellHex = cell.color.toUpperCase();
          if (!newColorCounts[cellHex]) {
            newColorCounts[cellHex] = {
              count: 0,
              color: cellHex
            };
          }
          newColorCounts[cellHex].count++;
          newTotalCount++;
        }
      });

      setColorCounts(newColorCounts);
      setTotalBeadCount(newTotalCount);
    }
  };

  // ++ Re-introduce the combined interaction handler ++
  const handleCanvasInteraction = (
    clientX: number,
    clientY: number,
    pageX: number,
    pageY: number,
    isClick: boolean = false,
    isTouchEnd: boolean = false
  ) => {
    // 如果是触摸结束或鼠标离开事件，隐藏提示
    if (isTouchEnd) {
      setTooltipData(null);
      return;
    }

    const canvas = pixelatedCanvasRef.current;
    if (!canvas || !mappedPixelData || !gridDimensions) {
      setTooltipData(null);
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (clientX - rect.left) * scaleX;
    const canvasY = (clientY - rect.top) * scaleY;

    const { N, M } = gridDimensions;
    const cellWidthOutput = canvas.width / N;
    const cellHeightOutput = canvas.height / M;

    const i = Math.floor(canvasX / cellWidthOutput);
    const j = Math.floor(canvasY / cellHeightOutput);

    if (i >= 0 && i < N && j >= 0 && j < M) {
      const cellData = mappedPixelData[j][i];

      // 颜色替换模式逻辑 - 选择源颜色
      if (isClick && colorReplaceState.isActive && colorReplaceState.step === 'select-source') {
        if (cellData && !cellData.isExternal && cellData.key && cellData.key !== TRANSPARENT_KEY) {
          // 执行选择源颜色
          handleCanvasColorSelect({
            key: cellData.key,
            color: cellData.color
          });
          setTooltipData(null);
        }
        return;
      }

      // 一键擦除模式逻辑
      if (isClick && isEraseMode) {
        if (cellData && !cellData.isExternal && cellData.key && cellData.key !== TRANSPARENT_KEY) {
          // 执行洪水填充擦除
          floodFillErase(j, i, cellData.key);
          setIsEraseMode(false); // 擦除完成后退出擦除模式
          setTooltipData(null);
        }
        return;
      }

      // Manual Coloring Logic - 保持原有的上色逻辑
      if (isClick && isManualColoringMode && selectedColor) {
        // 手动上色模式逻辑保持不变
        // ...现有代码...
        const newPixelData = mappedPixelData.map(row => row.map(cell => ({ ...cell })));
        const currentCell = newPixelData[j]?.[i];

        if (!currentCell) return;

        const previousKey = currentCell.key;
        const wasExternal = currentCell.isExternal;

        let newCellData: MappedPixel;

        if (selectedColor.key === TRANSPARENT_KEY) {
          newCellData = { ...transparentColorData };
        } else {
          newCellData = { ...selectedColor, isExternal: false };
        }

        // Only update if state changes
        if (newCellData.key !== previousKey || newCellData.isExternal !== wasExternal) {
          newPixelData[j][i] = newCellData;
          setMappedPixelData(newPixelData);

          // Update color counts
          if (colorCounts) {
            const newColorCounts = { ...colorCounts };
            let newTotalCount = totalBeadCount;

            // 处理之前颜色的减少（使用hex值）
            if (!wasExternal && previousKey !== TRANSPARENT_KEY) {
              const previousCell = mappedPixelData[j][i];
              const previousHex = previousCell?.color?.toUpperCase();
              if (previousHex && newColorCounts[previousHex]) {
                newColorCounts[previousHex].count--;
                if (newColorCounts[previousHex].count <= 0) {
                  delete newColorCounts[previousHex];
                }
                newTotalCount--;
              }
            }

            // 处理新颜色的增加（使用hex值）
            if (!newCellData.isExternal && newCellData.key !== TRANSPARENT_KEY) {
              const newHex = newCellData.color.toUpperCase();
              if (!newColorCounts[newHex]) {
                newColorCounts[newHex] = {
                  count: 0,
                  color: newHex
                };
              }
              newColorCounts[newHex].count++;
              newTotalCount++;
            }

            setColorCounts(newColorCounts);
            setTotalBeadCount(newTotalCount);
          }
        }

        // 上色操作后隐藏提示
        setTooltipData(null);
      }
      // Tooltip Logic (非手动上色模式点击或悬停)
      else if (!isManualColoringMode) {
        // 只有单元格实际有内容（非背景/外部区域）才会显示提示
        if (cellData && !cellData.isExternal && cellData.key) {
          // 检查是否已经显示了提示框，并且是否点击的是同一个位置
          // 对于移动设备，位置可能有细微偏差，所以我们检查单元格索引而不是具体坐标
          if (tooltipData) {
            // 如果已经有提示框，计算当前提示框对应的格子的索引
            const tooltipRect = canvas.getBoundingClientRect();

            // 还原提示框位置为相对于canvas的坐标
            const prevX = tooltipData.x; // 页面X坐标
            const prevY = tooltipData.y; // 页面Y坐标

            // 转换为相对于canvas的坐标
            const prevCanvasX = (prevX - tooltipRect.left) * scaleX;
            const prevCanvasY = (prevY - tooltipRect.top) * scaleY;

            // 计算之前显示提示框位置对应的网格索引
            const prevCellI = Math.floor(prevCanvasX / cellWidthOutput);
            const prevCellJ = Math.floor(prevCanvasY / cellHeightOutput);

            // 如果点击的是同一个格子，则切换tooltip的显示/隐藏状态
            if (i === prevCellI && j === prevCellJ) {
              setTooltipData(null); // 隐藏提示
              return;
            }
          }

          // 计算相对于main元素的位置
          const mainElement = mainRef.current;
          if (mainElement) {
            const mainRect = mainElement.getBoundingClientRect();
            // 计算相对于main元素的坐标
            const relativeX = pageX - mainRect.left - window.scrollX;
            const relativeY = pageY - mainRect.top - window.scrollY;

            // 如果是移动/悬停到一个新的有效格子，或者点击了不同的格子，则显示提示
            setTooltipData({
              x: relativeX,
              y: relativeY,
              key: cellData.key,
              color: cellData.color,
            });
          } else {
            // 如果没有找到main元素，使用原始坐标
            setTooltipData({
              x: pageX,
              y: pageY,
              key: cellData.key,
              color: cellData.color,
            });
          }
        } else {
          // 如果点击/悬停在外部区域或背景上，隐藏提示
          setTooltipData(null);
        }
      }
    } else {
      // 如果点击/悬停在画布外部，隐藏提示
      setTooltipData(null);
    }
  };

  // 处理自定义色板中单个颜色的选择变化
  const handleSelectionChange = (hexValue: string, isSelected: boolean) => {
    const normalizedHex = hexValue.toUpperCase();
    setCustomPaletteSelections(prev => ({
      ...prev,
      [normalizedHex]: isSelected
    }));
    setIsCustomPalette(true);
  };

  // 保存自定义色板并应用
  const handleSaveCustomPalette = () => {
    savePaletteSelections(customPaletteSelections);
    setIsCustomPalette(true);
    setIsCustomPaletteEditorOpen(false);
    // 触发图像重新处理
    setRemapTrigger(prev => prev + 1);
    // 退出手动上色模式
    setIsManualColoringMode(false);
    setSelectedColor(null);
    setIsEraseMode(false);
  };

  // ++ 新增：导出自定义色板配置 ++
  const handleExportCustomPalette = () => {
    const selectedHexValues = Object.entries(customPaletteSelections)
      .filter(([, isSelected]) => isSelected)
      .map(([hexValue]) => hexValue);

    if (selectedHexValues.length === 0) {
      alert("当前没有选中的颜色，无法导出。");
      return;
    }

    // 导出格式：仅基于hex值
    const exportData = {
      version: "3.0", // 新版本号
      selectedHexValues: selectedHexValues,
      exportDate: new Date().toISOString(),
      totalColors: selectedHexValues.length
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'custom-perler-palette.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // ++ 新增：处理导入的色板文件 ++
  const handleImportPaletteFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);

        // 检查文件格式
        if (!Array.isArray(data.selectedHexValues)) {
          throw new Error("无效的文件格式：文件必须包含 'selectedHexValues' 数组。");
        }

        console.log("检测到基于hex值的色板文件");

        const importedHexValues = data.selectedHexValues as string[];
        const validHexValues: string[] = [];
        const invalidHexValues: string[] = [];

        // 验证hex值
        importedHexValues.forEach(hex => {
          const normalizedHex = hex.toUpperCase();
          const colorData = fullBeadPalette.find(color => color.hex.toUpperCase() === normalizedHex);
          if (colorData) {
            validHexValues.push(normalizedHex);
          } else {
            invalidHexValues.push(hex);
          }
        });

        if (invalidHexValues.length > 0) {
          console.warn("导入时发现无效的hex值:", invalidHexValues);
          alert(`导入完成，但以下颜色无效已被忽略：\n${invalidHexValues.join(', ')}`);
        }

        if (validHexValues.length === 0) {
          alert("导入的文件中不包含任何有效的颜色。");
          return;
        }

        console.log(`成功验证 ${validHexValues.length} 个有效的hex值`);

        // 基于有效的hex值创建新的selections对象
        const allHexValues = fullBeadPalette.map(color => color.hex.toUpperCase());
        const newSelections = presetToSelections(allHexValues, validHexValues);
        setCustomPaletteSelections(newSelections);
        setIsCustomPalette(true); // 标记为自定义
        alert(`成功导入 ${validHexValues.length} 个颜色！`);

      } catch (error) {
        console.error("导入色板配置失败:", error);
        alert(`导入失败: ${error instanceof Error ? error.message : '未知错误'}`);
      } finally {
        // 重置文件输入，以便可以再次导入相同的文件
        if (event.target) {
          event.target.value = '';
        }
      }
    };
    reader.onerror = () => {
      alert("读取文件失败。");
      // 重置文件输入
      if (event.target) {
        event.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  // ++ 新增：触发导入文件选择 ++
  const triggerImportPalette = () => {
    importPaletteInputRef.current?.click();
  };

  // 新增：处理颜色高亮
  const handleHighlightColor = (colorHex: string) => {
    setHighlightColorKey(colorHex);
  };

  // 新增：高亮完成回调
  const handleHighlightComplete = () => {
    setHighlightColorKey(null);
  };

  // 新增：切换完整色板显示
  const handleToggleFullPalette = () => {
    setShowFullPalette(!showFullPalette);
  };

  // 新增：处理颜色选择，同时管理模式切换
  const handleColorSelect = (colorData: { key: string; color: string; isExternal?: boolean }) => {
    // 如果选择的是橡皮擦（透明色）且当前在颜色替换模式，退出替换模式
    if (colorData.key === TRANSPARENT_KEY && colorReplaceState.isActive) {
      setColorReplaceState({
        isActive: false,
        step: 'select-source'
      });
      setHighlightColorKey(null);
    }

    // 选择任何颜色（包括橡皮擦）时，都应该退出一键擦除模式
    if (isEraseMode) {
      setIsEraseMode(false);
    }

    // 设置选中的颜色
    setSelectedColor(colorData);
  };

  // 新增：颜色替换相关处理函数
  const handleColorReplaceToggle = () => {
    setColorReplaceState(prev => {
      if (prev.isActive) {
        // 退出替换模式
        return {
          isActive: false,
          step: 'select-source'
        };
      } else {
        // 进入替换模式
        // 只退出冲突的模式，但保持在手动上色模式下
        setIsEraseMode(false);
        setSelectedColor(null);
        return {
          isActive: true,
          step: 'select-source'
        };
      }
    });
  };

  // 新增：处理从画布选择源颜色
  const handleCanvasColorSelect = (colorData: { key: string; color: string }) => {
    if (colorReplaceState.isActive && colorReplaceState.step === 'select-source') {
      // 高亮显示选中的颜色
      setHighlightColorKey(colorData.color);
      // 进入第二步：选择目标颜色
      setColorReplaceState({
        isActive: true,
        step: 'select-target',
        sourceColor: colorData
      });
    }
  };

  // 新增：执行颜色替换
  const handleColorReplace = (sourceColor: { key: string; color: string }, targetColor: { key: string; color: string }) => {
    if (!mappedPixelData || !gridDimensions) return;

    const { N, M } = gridDimensions;
    const newPixelData = mappedPixelData.map(row => row.map(cell => ({ ...cell })));
    let replaceCount = 0;

    // 遍历所有像素，替换匹配的颜色
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < N; i++) {
        const currentCell = newPixelData[j][i];
        if (currentCell && !currentCell.isExternal &&
          currentCell.color.toUpperCase() === sourceColor.color.toUpperCase()) {
          // 替换颜色
          newPixelData[j][i] = {
            key: targetColor.key,
            color: targetColor.color,
            isExternal: false
          };
          replaceCount++;
        }
      }
    }

    if (replaceCount > 0) {
      // 更新像素数据
      setMappedPixelData(newPixelData);

      // 重新计算颜色统计
      if (colorCounts) {
        const newColorCounts: { [hexKey: string]: { count: number; color: string } } = {};
        let newTotalCount = 0;

        newPixelData.flat().forEach(cell => {
          if (cell && !cell.isExternal && cell.key !== TRANSPARENT_KEY) {
            const cellHex = cell.color.toUpperCase();
            if (!newColorCounts[cellHex]) {
              newColorCounts[cellHex] = {
                count: 0,
                color: cellHex
              };
            }
            newColorCounts[cellHex].count++;
            newTotalCount++;
          }
        });

        setColorCounts(newColorCounts);
        setTotalBeadCount(newTotalCount);
      }

      console.log(`颜色替换完成：将 ${replaceCount} 个 ${sourceColor.key} 替换为 ${targetColor.key}`);
    }

    // 退出替换模式
    setColorReplaceState({
      isActive: false,
      step: 'select-source'
    });

    // 清除高亮
    setHighlightColorKey(null);
  };

  // 生成完整色板数据（用户自定义色板中选中的所有颜色）
  const fullPaletteColors = useMemo(() => {
    const selectedColors: { key: string; color: string }[] = [];

    Object.entries(customPaletteSelections).forEach(([hexValue, isSelected]) => {
      if (isSelected) {
        // 根据选择的色号系统获取显示的色号
        const displayKey = getColorKeyByHex(hexValue, selectedColorSystem);
        selectedColors.push({
          key: displayKey,
          color: hexValue
        });
      }
    });

    // 使用色相排序而不是色号排序
    return sortColorsByHue(selectedColors);
  }, [customPaletteSelections, selectedColorSystem]);

  return (
    <>
      {/* 添加自定义动画样式 */}
      <style dangerouslySetInnerHTML={{ __html: floatAnimation }} />

      {/* PWA 安装按钮 */}
      {SHOW_INSTALL_PROMPT && <InstallPWA />}

      {/* 手机号输入弹窗 */}
      {isPhoneModalOpen && IS_PHONE_GATING_ENABLED && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
          <div className="bg-white rounded-xl p-6 mx-4 max-w-sm w-full shadow-2xl">
            <h3 className="text-lg font-bold text-gray-800 mb-2">验证身份</h3>
            <p className="text-sm text-gray-600 mb-4">
              请输入下单时的手机号以激活下载功能
            </p>
            <input
              type="tel"
              value={phoneNumber}
              onChange={(e) => {
                setPhoneNumber(e.target.value.replace(/\D/g, '').slice(0, 11));
                setPhoneError(null);
              }}
              placeholder="请输入11位手机号"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-800 text-lg tracking-wider"
              maxLength={11}
              autoFocus
            />
            {phoneError && (
              <p className="text-red-500 text-sm mt-2">{phoneError}</p>
            )}
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setIsPhoneModalOpen(false)}
                className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                稍后验证
              </button>
              <button
                onClick={() => activatePhone(phoneNumber)}
                disabled={phoneNumber.length !== 11 || isPhoneSubmitting}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                {isPhoneSubmitting ? '验证中...' : '确认'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-3 text-center">
              首次验证后默认可下载{DEFAULT_PHONE_MAX_USES}次图纸
            </p>
          </div>
        </div>
      )}

      {/* Apply dark mode styles to the main container */}
      <div className="min-h-screen p-4 sm:p-6 flex flex-col items-center bg-gradient-to-b from-gray-50 to-white dark:from-gray-800 dark:to-gray-900 font-sans overflow-x-hidden">
        {/* Apply dark mode styles to the header */}
        <header className="w-full md:max-w-4xl text-center mt-6 mb-8 sm:mt-8 sm:mb-10 relative overflow-hidden">
          {/* Adjust decorative background colors for dark mode */}
          <div className="absolute top-0 left-0 w-48 h-48 bg-blue-100 dark:bg-blue-900 rounded-full opacity-30 dark:opacity-20 blur-3xl"></div>
          <div className="absolute bottom-0 right-0 w-48 h-48 bg-pink-100 dark:bg-pink-900 rounded-full opacity-30 dark:opacity-20 blur-3xl"></div>

          {/* Adjust decorative dots color */}
          <div className="absolute top-0 right-0 grid grid-cols-5 gap-1 opacity-20 dark:opacity-10">
            {[...Array(25)].map((_, i) => (
              <div key={i} className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-600"></div>
            ))}
          </div>
          <div className="absolute bottom-0 left-0 grid grid-cols-5 gap-1 opacity-20 dark:opacity-10">
            {[...Array(25)].map((_, i) => (
              <div key={i} className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-600"></div>
            ))}
          </div>

          {/* Header content - Ultra fancy integrated logo and titles */}
          <div className="relative z-10 py-8">
            {/* Integrated super fancy logo and title container */}
            <div className="relative flex flex-col items-center">
              {/* Ultra cute hyper-detailed 16-bead icon */}
              <div className="relative mb-6 animate-float">
                <div className="relative grid grid-cols-4 gap-2 p-4 bg-white/95 dark:bg-gray-800/95 rounded-3xl shadow-2xl border-4 border-gradient-to-r from-pink-300 via-purple-300 to-blue-300 dark:border-gray-600">
                  {['bg-red-400', 'bg-blue-400', 'bg-yellow-400', 'bg-green-400',
                    'bg-purple-400', 'bg-pink-400', 'bg-orange-400', 'bg-teal-400',
                    'bg-indigo-400', 'bg-cyan-400', 'bg-lime-400', 'bg-amber-400',
                    'bg-rose-400', 'bg-sky-400', 'bg-emerald-400', 'bg-violet-400'].map((color, i) => (
                      <div key={i} className="relative">
                        <div
                          className={`w-5 h-5 rounded-full ${color} transition-all duration-500 hover:scale-150 shadow-xl hover:shadow-2xl relative z-10`}
                          style={{
                            animation: `float ${2 + (i % 3)}s ease-in-out infinite ${i * 0.1}s`,
                            boxShadow: `0 0 20px ${color.includes('red') ? '#f87171' : color.includes('blue') ? '#60a5fa' : color.includes('yellow') ? '#fbbf24' : color.includes('green') ? '#4ade80' : color.includes('purple') ? '#a855f7' : color.includes('pink') ? '#f472b6' : color.includes('orange') ? '#fb923c' : color.includes('teal') ? '#2dd4bf' : color.includes('indigo') ? '#818cf8' : color.includes('cyan') ? '#22d3ee' : color.includes('lime') ? '#84cc16' : color.includes('amber') ? '#f59e0b' : color.includes('rose') ? '#fb7185' : color.includes('sky') ? '#0ea5e9' : color.includes('emerald') ? '#10b981' : '#8b5cf6'}70`
                          }}
                        ></div>
                        {/* Mini decorations around each bead */}
                        {i % 4 === 0 && <div className="absolute -top-0.5 -right-0.5 w-1 h-1 bg-yellow-300 rounded-full animate-ping"></div>}
                        {i % 4 === 1 && <div className="absolute -bottom-0.5 -left-0.5 w-0.5 h-0.5 bg-pink-300 rounded-full animate-pulse"></div>}
                        {i % 4 === 2 && <div className="absolute -top-0.5 -left-0.5 w-0.5 h-0.5 bg-blue-300 rounded-full animate-bounce"></div>}
                        {i % 4 === 3 && <div className="absolute -bottom-0.5 -right-0.5 w-1 h-1 bg-purple-300 rounded-full animate-spin"></div>}
                      </div>
                    ))}
                </div>

                {/* Super cute decorations around the icon */}
                <div className="absolute -top-3 -right-4 w-3 h-3 bg-gradient-to-br from-yellow-400 to-pink-500 rounded-full animate-ping transform rotate-12"></div>
                <div className="absolute -top-1 -right-2 w-2 h-2 bg-gradient-to-br from-pink-400 to-purple-500 rotate-45 animate-spin"></div>
                <div className="absolute -bottom-3 -left-4 w-2.5 h-2.5 bg-gradient-to-br from-blue-400 to-cyan-500 rounded-full animate-bounce"></div>
                <div className="absolute -bottom-1 -left-2 w-1.5 h-1.5 bg-gradient-to-br from-green-400 to-teal-500 rotate-45 animate-pulse"></div>
                <div className="absolute top-0 -right-1 w-1 h-1 bg-gradient-to-br from-purple-400 to-pink-500 rounded-full animate-pulse delay-100"></div>
                <div className="absolute -top-2 left-2 w-1 h-1 bg-gradient-to-br from-orange-400 to-red-500 rounded-full animate-bounce delay-200"></div>
                <div className="absolute bottom-1 -right-3 w-1.5 h-1.5 bg-gradient-to-br from-indigo-400 to-purple-500 rotate-45 animate-spin delay-300"></div>
                <div className="absolute -bottom-2 right-1 w-0.5 h-0.5 bg-gradient-to-br from-cyan-400 to-blue-500 rounded-full animate-ping delay-400"></div>

                {/* Extra tiny sparkles */}
                <div className="absolute -top-4 left-1 w-0.5 h-0.5 bg-yellow-300 rounded-full animate-pulse delay-500"></div>
                <div className="absolute top-2 -left-4 w-0.5 h-0.5 bg-pink-300 rounded-full animate-bounce delay-600"></div>
                <div className="absolute -bottom-4 right-2 w-0.5 h-0.5 bg-blue-300 rounded-full animate-ping delay-700"></div>
                <div className="absolute bottom-2 -right-5 w-0.5 h-0.5 bg-purple-300 rounded-full animate-pulse delay-800"></div>
              </div>

              {/* Ultra fancy brand name and tool name with hyper cute decorations */}
              <div className="relative flex flex-col items-center space-y-3">
                {/* Brand name - PerlerCraft with ultra fancy effects */}
                <div className="relative">
                  <h1 className="relative text-4xl sm:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-pink-500 via-purple-500 via-blue-500 to-cyan-400 tracking-wider drop-shadow-2xl transform hover:scale-105 transition-transform duration-300 animate-bounce">
                    拼豆底稿大师
                  </h1>

                  {/* Super fancy geometric decorations */}
                  <div className="absolute -top-4 -right-5 w-4 h-4 bg-gradient-to-br from-yellow-400 to-pink-500 rounded-full animate-spin transform rotate-12"></div>
                  <div className="absolute -top-2 -right-2 w-2.5 h-2.5 bg-gradient-to-br from-pink-400 to-purple-500 rounded-full animate-ping"></div>
                  <div className="absolute -top-1 -right-0.5 w-1.5 h-1.5 bg-gradient-to-br from-purple-400 to-blue-500 rotate-45 animate-pulse delay-100"></div>
                  <div className="absolute -bottom-3 -left-5 w-4 h-4 bg-gradient-to-br from-blue-400 to-purple-500 rotate-45 animate-bounce delay-200"></div>
                  <div className="absolute -bottom-1 -left-2 w-2 h-2 bg-gradient-to-br from-cyan-400 to-blue-500 rounded-full animate-spin delay-300"></div>
                  <div className="absolute top-0 left-1/2 w-1.5 h-1.5 bg-gradient-to-br from-purple-400 to-pink-500 rounded-full animate-pulse delay-400"></div>
                  <div className="absolute -bottom-4 -right-3 w-3 h-3 bg-gradient-to-br from-cyan-400 to-teal-500 rounded-full animate-bounce delay-500"></div>
                  <div className="absolute top-1 -left-4 w-2 h-2 bg-gradient-to-br from-pink-400 to-red-500 rotate-45 animate-ping delay-600"></div>

                  {/* Extra tiny sparkles around brand name */}
                  <div className="absolute -top-3 left-0 w-1 h-1 bg-yellow-300 rounded-full animate-pulse delay-700"></div>
                  <div className="absolute -top-2 right-3 w-0.5 h-0.5 bg-pink-300 rounded-full animate-bounce delay-800"></div>
                  <div className="absolute bottom-0 -left-1 w-0.5 h-0.5 bg-blue-300 rounded-full animate-ping delay-900"></div>
                  <div className="absolute bottom-1 right-0 w-1 h-1 bg-purple-300 rounded-full animate-pulse delay-1000"></div>
                </div>

              </div>

              {/* Ultra cute floating elements constellation around the entire group */}
              <div className="absolute -top-10 -left-10 w-3 h-3 bg-gradient-to-br from-pink-400 to-purple-500 rounded-full animate-float"></div>
              <div className="absolute -top-8 -left-6 w-1.5 h-1.5 bg-gradient-to-br from-purple-400 to-pink-500 rotate-45 animate-spin delay-100"></div>
              <div className="absolute -top-6 -left-12 w-2 h-2 bg-gradient-to-br from-pink-400 to-red-500 rounded-full animate-bounce delay-200"></div>

              <div className="absolute -top-10 -right-10 w-2.5 h-2.5 bg-gradient-to-br from-blue-400 to-cyan-500 rounded-full animate-ping delay-300"></div>
              <div className="absolute -top-6 -right-14 w-1 h-1 bg-gradient-to-br from-cyan-400 to-blue-500 rotate-45 animate-pulse delay-400"></div>
              <div className="absolute -top-4 -right-8 w-3 h-3 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full animate-bounce delay-500"></div>

              <div className="absolute -bottom-10 -left-10 w-2 h-2 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full animate-pulse delay-600"></div>
              <div className="absolute -bottom-8 -left-14 w-1.5 h-1.5 bg-gradient-to-br from-orange-400 to-red-500 rotate-45 animate-spin delay-700"></div>
              <div className="absolute -bottom-6 -left-6 w-2.5 h-2.5 bg-gradient-to-br from-yellow-400 to-pink-500 rounded-full animate-float delay-800"></div>

              <div className="absolute -bottom-10 -right-10 w-3 h-3 bg-gradient-to-br from-green-400 to-teal-500 rotate-45 animate-bounce delay-900"></div>
              <div className="absolute -bottom-8 -right-6 w-1 h-1 bg-gradient-to-br from-teal-400 to-cyan-500 rounded-full animate-ping delay-1000"></div>
              <div className="absolute -bottom-6 -right-14 w-2 h-2 bg-gradient-to-br from-emerald-400 to-green-500 rounded-full animate-pulse delay-1100"></div>

              {/* Extra tiny magical sparkles */}
              <div className="absolute -top-12 left-0 w-0.5 h-0.5 bg-yellow-300 rounded-full animate-ping delay-1200"></div>
              <div className="absolute -top-2 -left-16 w-1 h-1 bg-pink-300 rounded-full animate-bounce delay-1300"></div>
              <div className="absolute top-2 -right-18 w-0.5 h-0.5 bg-blue-300 rounded-full animate-pulse delay-1400"></div>
              <div className="absolute -bottom-12 right-0 w-1 h-1 bg-purple-300 rounded-full animate-float delay-1500"></div>
              <div className="absolute -bottom-2 -right-16 w-0.5 h-0.5 bg-green-300 rounded-full animate-ping delay-1600"></div>
              <div className="absolute bottom-2 -left-18 w-1 h-1 bg-teal-300 rounded-full animate-bounce delay-1700"></div>
            </div>
            {/* Separator gradient remains the same */}
            <div className="h-1 w-24 mx-auto my-3 bg-gradient-to-r from-blue-500 to-pink-500 rounded-full"></div>
            {/* Slogan with clean typography */}
            <p className="mt-4 text-base sm:text-lg font-light text-gray-600 dark:text-gray-300 max-w-lg mx-auto text-center tracking-[0.1em] leading-relaxed">
              让像素创意属于每一个人
            </p>

          </div>
        </header>

        {/* Apply dark mode styles to the main section */}
        <main ref={mainRef} className="w-full md:max-w-4xl flex flex-col items-center space-y-5 sm:space-y-6 relative overflow-hidden">
          {/* Apply dark mode styles to the Drop Zone */}
          <div
            onDrop={handleDrop} onDragOver={handleDragOver} onDragEnter={handleDragOver}
            onClick={isMounted ? triggerFileInput : undefined}
            className={`border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 sm:p-8 text-center ${isMounted ? 'cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-gray-800' : 'cursor-wait'} transition-all duration-300 w-full md:max-w-md flex flex-col justify-center items-center shadow-sm hover:shadow-md`}
            style={{ minHeight: '130px' }}
          >
            {/* Icon color */}
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 sm:h-12 sm:w-12 text-gray-400 dark:text-gray-500 mb-2 sm:mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            {/* Text color */}
            <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">拖放图片到此处，或<span className="font-medium text-blue-600 dark:text-blue-400">点击选择文件</span></p>
            {/* Text color */}
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">支持 JPG, PNG 图片格式，或 CSV 数据文件</p>
          </div>

          {/* Apply dark mode styles to the Tip Box */}
          {!originalImageSrc && (
            <div className="w-full md:max-w-md bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-gray-800 dark:to-gray-700 p-3 rounded-lg border border-blue-100 dark:border-gray-600 shadow-sm">
              {/* Icon color */}
              <p className="text-xs text-indigo-700 dark:text-indigo-300 flex items-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5 flex-shrink-0 text-blue-500 dark:text-blue-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {/* Text color */}
                <span className="text-indigo-700 dark:text-indigo-300">小贴士：上传图片后，输入你想要的成品宽度（cm）或格数，系统会自动帮你计算尺寸和所需豆板数量。修改参数后会自动更新预览。</span>
              </p>
            </div>
          )}

          <input type="file" accept="image/jpeg, image/png, .csv, text/csv, application/csv, text/plain" onChange={handleFileChange} ref={fileInputRef} className="hidden" />

          {/* Controls and Output Area */}
          {originalImageSrc && (
            <div className="w-full flex flex-col items-center space-y-5 sm:space-y-6">
              {/* ++ HIDE Control Row in manual mode ++ */}
              {!isManualColoringMode && (
                /* 修改控制面板网格布局 */
                <div className="w-full md:max-w-2xl grid grid-cols-1 gap-4 bg-white dark:bg-gray-800 p-4 sm:p-5 rounded-xl shadow-md border border-gray-100 dark:border-gray-700">

                  {/* 作品尺寸设置区 */}
                  <div className="sm:col-span-2">
                    <div className="flex items-center gap-2 mb-3">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">作品尺寸</span>
                      {isProcessing && (
                        <span className="ml-auto flex items-center gap-1.5 text-xs text-blue-500 dark:text-blue-400 animate-pulse">
                          <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                          处理中...
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {/* 成品宽度 cm */}
                      <div>
                        <label htmlFor="desiredWidthCm" className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                          成品宽度 (cm)
                        </label>
                        <input
                          type="number"
                          id="desiredWidthCm"
                          value={desiredWidthCm}
                          onChange={handleDesiredWidthCmChange}
                          className="w-full p-1.5 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500 h-9 shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200"
                          min="1"
                          max="80"
                          step="0.1"
                        />
                      </div>
                      {/* 图纸宽度 格数 */}
                      <div>
                        <label htmlFor="granularityInput" className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                          图纸宽度（格数）
                        </label>
                        <input
                          type="number"
                          id="granularityInput"
                          value={granularityInput}
                          onChange={handleGranularityInputChange}
                          className="w-full p-1.5 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500 h-9 shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200"
                          min="10"
                          max="300"
                        />
                      </div>
                    </div>

                    {/* 尺寸提示 */}
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
                      💡 标准豆板 {BOARD_PEGS}×{BOARD_PEGS}格 ≈ {BOARD_SIZE_CM}×{BOARD_SIZE_CM}cm ｜ 豆子直径 {BEAD_SIZE_MM}mm
                    </p>

                    {/* 尺寸计算信息卡片（仅在有图片时显示）*/}
                    {gridDimensions && (
                      <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800/40">
                        <div className="grid grid-cols-1 gap-1.5 text-xs">
                          <div className="flex items-start gap-2 text-blue-700 dark:text-blue-300">
                            <span className="flex-shrink-0">📐</span>
                            <div>
                              <span className="font-medium">完成后作品大小：</span>
                              <span>{(gridDimensions.N * BEAD_SIZE_MM / 10).toFixed(1)} × {(gridDimensions.M * BEAD_SIZE_MM / 10).toFixed(1)} cm</span>
                              <span className="text-blue-500 dark:text-blue-400 ml-1">（宽 × 高）</span>
                            </div>
                          </div>
                          <div className="flex items-start gap-2 text-blue-700 dark:text-blue-300">
                            <span className="flex-shrink-0">📏</span>
                            <div>
                              <span className="font-medium">需要的豆子格数：</span>
                              <span>横 {gridDimensions.N} 格 × 纵 {gridDimensions.M} 格</span>
                            </div>
                          </div>
                          <div className="flex items-start gap-2 text-blue-700 dark:text-blue-300">
                            <span className="flex-shrink-0">🧩</span>
                            <div>
                              <span className="font-medium">需要豆板：</span>
                              <span>{Math.ceil(gridDimensions.N / BOARD_PEGS)} × {Math.ceil(gridDimensions.M / BOARD_PEGS)} 块</span>
                              {(Math.ceil(gridDimensions.N / BOARD_PEGS) > 1 || Math.ceil(gridDimensions.M / BOARD_PEGS) > 1) && (
                                <span className="text-blue-500 dark:text-blue-400 ml-1">（需要多块豆板拼接）</span>
                              )}
                              {Math.ceil(gridDimensions.N / BOARD_PEGS) === 1 && Math.ceil(gridDimensions.M / BOARD_PEGS) === 1 && (
                                <span className="text-green-600 dark:text-green-400 ml-1">（1块豆板即可完成 ✓）</span>
                              )}
                            </div>
                          </div>
                          {totalBeadCount > 0 && (
                            <div className="flex items-start gap-2 text-blue-700 dark:text-blue-300">
                              <span className="flex-shrink-0">🔢</span>
                              <div>
                                <span className="font-medium">格子总数：</span>
                                <span>{totalBeadCount.toLocaleString()} ,铺满需要{totalBeadCount.toLocaleString()} 颗豆子</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 颜色简化 + 渲染风格 */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* 颜色简化程度 */}
                    <div>
                      <label htmlFor="similarityThresholdInput" className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        颜色简化程度
                      </label>
                      <input
                        type="number"
                        id="similarityThresholdInput"
                        value={similarityThresholdInput}
                        onChange={handleSimilarityThresholdInputChange}
                        className="w-full p-1.5 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500 h-9 shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200"
                        min="0"
                        max="100"
                      />
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">💡 0=最精细  100=最简化</p>
                    </div>

                    {/* 渲染风格 */}
                    <div>
                      <label htmlFor="pixelationModeSelect" className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        渲染风格
                      </label>
                      <select
                        id="pixelationModeSelect"
                        value={pixelationMode}
                        onChange={handlePixelationModeChange}
                        className="w-full p-1.5 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500 h-9 shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200"
                      >
                        <option value={PixelationMode.Dominant} className="bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200">卡通风格 — 颜色更鲜明</option>
                        <option value={PixelationMode.Average} className="bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200">写实风格 — 过渡更自然</option>
                      </select>
                    </div>
                  </div>

                  {/* 色号系统选择器 */}
                  <div className="sm:col-span-2">
                    <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 sm:mb-2">色号系统:</label>
                    <div className="flex flex-wrap gap-2">
                      {colorSystemOptions.map(option => (
                        <button
                          key={option.key}
                          onClick={() => setSelectedColorSystem(option.key as ColorSystem)}
                          className={`px-3 py-2 text-sm rounded-lg border transition-all duration-200 flex-shrink-0 ${selectedColorSystem === option.key
                            ? 'bg-blue-500 text-white border-blue-500 shadow-md transform scale-105'
                            : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-gray-600'
                            }`}
                        >
                          {option.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 自定义色板按钮 */}
                  <div className="sm:col-span-2 mt-1">
                    <button
                      onClick={() => setIsCustomPaletteEditorOpen(true)}
                      className="w-full py-2.5 px-3 flex items-center justify-center gap-2 bg-gradient-to-r from-blue-500 to-purple-500 text-white font-medium rounded-lg shadow-sm transition-all duration-200 hover:shadow-md hover:from-blue-600 hover:to-purple-600"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4 2a2 2 0 00-2 2v11a3 3 0 106 0V4a2 2 0 00-2-2H4zm1 14a1 1 0 100-2 1 1 0 000 2zm5-1.757l4.9-4.9a2 2 0 000-2.828L13.485 5.1a2 2 0 00-2.828 0L10 5.757v8.486zM16 18H9.071l6-6H16a2 2 0 012 2v2a2 2 0 01-2 2z" clipRule="evenodd" />
                      </svg>
                      管理色板 ({Object.values(customPaletteSelections).filter(Boolean).length} 色)
                    </button>
                    {isCustomPalette && (
                      <p className="text-xs text-center text-blue-500 dark:text-blue-400 mt-1.5">当前使用自定义色板</p>
                    )}
                  </div>
                </div>
              )}

              {/* 自定义色板编辑器弹窗 - 这是新增的部分 */}
              {isCustomPaletteEditorOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm z-50 flex justify-center items-center p-4">
                  <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
                    {/* 添加隐藏的文件输入框 */}
                    <input
                      type="file"
                      accept=".json"
                      ref={importPaletteInputRef}
                      onChange={handleImportPaletteFile}
                      className="hidden"
                    />
                    <div className="p-4 sm:p-6 flex-1 overflow-y-auto"> {/* 让内容区域可滚动 */}
                      <CustomPaletteEditor
                        allColors={fullBeadPalette}
                        currentSelections={customPaletteSelections}
                        onSelectionChange={handleSelectionChange}
                        onSaveCustomPalette={handleSaveCustomPalette}
                        onClose={() => setIsCustomPaletteEditorOpen(false)}
                        onExportCustomPalette={handleExportCustomPalette}
                        onImportCustomPalette={triggerImportPalette}
                        selectedColorSystem={selectedColorSystem}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Output Section */}
              <div className="w-full md:max-w-2xl">
                <canvas ref={originalCanvasRef} className="hidden"></canvas>

                {/* ++ 手动编辑模式提示信息 ++ */}
                {isManualColoringMode && mappedPixelData && gridDimensions && (
                  <div className="w-full mb-4 p-3 bg-blue-50 dark:bg-gray-800 rounded-lg shadow-sm border border-blue-100 dark:border-gray-700">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 text-xs text-gray-600 dark:text-gray-300">
                        <div className="flex items-center gap-1">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-blue-500 dark:text-blue-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                          <span>手动编辑中，使用右上角菜单操作</span>
                        </div>
                        <span className="hidden sm:inline text-gray-300 dark:text-gray-500">|</span>
                        <div className="flex items-center gap-1">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-blue-500 dark:text-blue-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                          <span>推荐电脑操作，上色更精准</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => {
                            // 放弃修改：恢复快照
                            const snapshot = manualModeSnapshotRef.current;
                            if (snapshot) {
                              if (snapshot.pixelData) setMappedPixelData(snapshot.pixelData);
                              if (snapshot.colorCounts) setColorCounts(snapshot.colorCounts);
                              setTotalBeadCount(snapshot.totalBeadCount);
                            }
                            manualModeSnapshotRef.current = null;
                            setIsManualColoringMode(false);
                            setSelectedColor(null);
                            setIsEraseMode(false);
                          }}
                          className="px-2.5 py-1.5 text-xs bg-red-100 dark:bg-red-900/40 hover:bg-red-200 dark:hover:bg-red-800/50 text-red-700 dark:text-red-300 rounded-md transition-colors"
                        >
                          放弃修改
                        </button>
                        <button
                          onClick={() => {
                            // 保存并退出：不恢复快照
                            manualModeSnapshotRef.current = null;
                            setIsManualColoringMode(false);
                            setSelectedColor(null);
                            setIsEraseMode(false);
                          }}
                          className="px-2.5 py-1.5 text-xs bg-green-500 hover:bg-green-600 text-white rounded-md transition-colors"
                        >
                          保存退出 ✓
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Canvas Preview Container */}
                {/* Apply dark mode styles */}
                <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-md border border-gray-100 dark:border-gray-700">
                  {/* 大画布提示信息 */}
                  {gridDimensions && gridDimensions.N > 100 && (
                    <div className="mb-3 p-2 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg text-xs text-blue-700 dark:text-blue-300 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-blue-500 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>高精度网格 ({gridDimensions.N}×{gridDimensions.M}) - 画布已自动放大，可左右滚动、放大查看精细图像</span>
                      </div>
                    </div>
                  )}
                  {/* Inner container background - 允许水平滚动以适应大画布 */}
                  <div className="flex justify-center mb-3 sm:mb-4 bg-gray-100 dark:bg-gray-700 p-2 rounded-lg overflow-x-auto overflow-y-hidden"
                    style={{ minHeight: '150px' }}>
                    {/* PixelatedPreviewCanvas component needs internal changes for dark mode drawing */}
                    <PixelatedPreviewCanvas
                      canvasRef={pixelatedCanvasRef}
                      mappedPixelData={mappedPixelData}
                      gridDimensions={gridDimensions}
                      isManualColoringMode={isManualColoringMode}
                      onInteraction={handleCanvasInteraction}
                      highlightColorKey={highlightColorKey}
                      onHighlightComplete={handleHighlightComplete}
                    />
                  </div>
                </div>
              </div>
            </div> // This closes the main div started after originalImageSrc check
          )}

          {/* ++ HIDE Color Counts in manual mode ++ */}
          {!isManualColoringMode && originalImageSrc && colorCounts && Object.keys(colorCounts).length > 0 && (
            // Apply dark mode styles to color counts container
            <div className="w-full md:max-w-2xl mt-6 bg-white dark:bg-gray-800 p-4 rounded-lg shadow border border-gray-100 dark:border-gray-700 color-stats-panel">
              {/* Title color */}
              <h3 className="text-lg font-semibold mb-1 text-gray-700 dark:text-gray-200 text-center">
                颜色管理
              </h3>
              {/* Subtitle color */}
              <p className="text-xs text-center text-gray-500 dark:text-red-400 mb-3">点击颜色可从图纸中移除（变为透明），恢复后重新渲染。总计: {totalBeadCount} 颗.</p>
              <ul className="space-y-1 max-h-60 overflow-y-auto pr-2 text-sm">
                {Object.keys(colorCounts)
                  .sort(sortColorKeys)
                  .map((hexKey) => {
                    // 现在key是hex值，需要通过hex获取对应色号系统的色号
                    const displayColorKey = getColorKeyByHex(hexKey, selectedColorSystem);
                    const isExcluded = excludedColorKeys.has(hexKey);
                    const count = colorCounts[hexKey].count;
                    const colorHex = colorCounts[hexKey].color;

                    return (
                      <li
                        key={hexKey}
                        onClick={() => handleToggleExcludeColor(hexKey)}
                        // Apply dark mode styles for list items (normal and excluded)
                        className={`flex items-center justify-between p-1.5 rounded cursor-pointer transition-colors ${isExcluded
                          ? 'bg-red-100 dark:bg-red-900/50 hover:bg-red-200 dark:hover:bg-red-800/60 opacity-60 dark:opacity-70' // Darker red background for excluded
                          : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                          }`}
                        title={isExcluded ? `点击恢复 ${displayColorKey}` : `点击移除 ${displayColorKey}`}
                      >
                        <div className={`flex items-center space-x-2 ${isExcluded ? 'line-through' : ''}`}>
                          {/* Adjust color swatch border */}
                          <span
                            className="inline-block w-4 h-4 rounded border border-gray-400 dark:border-gray-500 flex-shrink-0"
                            style={{ backgroundColor: isExcluded ? '#666' : colorHex }} // Darker gray for excluded swatch
                          ></span>
                          {/* Adjust text color for key (normal and excluded) */}
                          <span className={`font-mono font-medium ${isExcluded ? 'text-red-700 dark:text-red-400' : 'text-gray-800 dark:text-gray-200'}`}>{displayColorKey}</span>
                        </div>
                        {/* Adjust text color for count (normal and excluded) */}
                        <span className={`text-xs ${isExcluded ? 'text-red-600 dark:text-red-400 line-through' : 'text-gray-600 dark:text-gray-300'}`}>{count} 颗</span>
                      </li>
                    );
                  })}
              </ul>
              {excludedColorKeys.size > 0 && (
                <div className="mt-3">
                  <button
                    onClick={() => setShowExcludedColors(prev => !prev)}
                    className="w-full text-xs py-1.5 px-2 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors flex items-center justify-between"
                  >
                    <span>已排除的颜色 ({excludedColorKeys.size})</span>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className={`h-4 w-4 text-gray-500 dark:text-gray-400 transform transition-transform ${showExcludedColors ? 'rotate-180' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {showExcludedColors && (
                    <div className="mt-2 border border-gray-200 dark:border-gray-700 rounded-md p-2 bg-gray-100 dark:bg-gray-800">
                      <div className="max-h-40 overflow-y-auto">
                        {Array.from(excludedColorKeys).length > 0 ? (
                          <ul className="space-y-1">
                            {Array.from(excludedColorKeys).sort(sortColorKeys).map(hexKey => {
                              const colorData = fullBeadPalette.find(color => color.hex.toUpperCase() === hexKey.toUpperCase());
                              return (
                                <li key={hexKey} className="flex justify-between items-center p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded">
                                  <div className="flex items-center space-x-2">
                                    <span
                                      className="inline-block w-4 h-4 rounded border border-gray-400 dark:border-gray-500 flex-shrink-0"
                                      style={{ backgroundColor: colorData?.hex || hexKey }}
                                    ></span>
                                    <span className="font-mono text-xs text-gray-800 dark:text-gray-200">{getColorKeyByHex(hexKey, selectedColorSystem)}</span>
                                  </div>
                                  <button
                                    onClick={() => {
                                      // 实现恢复单个颜色的逻辑
                                      const newExcludedKeys = new Set(excludedColorKeys);
                                      newExcludedKeys.delete(hexKey);
                                      setExcludedColorKeys(newExcludedKeys);
                                      setRemapTrigger(prev => prev + 1);
                                      setIsManualColoringMode(false);
                                      setSelectedColor(null);
                                      console.log(`Restored color: ${hexKey}`);
                                    }}
                                    className="text-xs py-0.5 px-2 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-800/40"
                                  >
                                    恢复
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className="text-xs text-center text-gray-500 dark:text-gray-400 py-2">
                            没有排除的颜色
                          </p>
                        )}
                      </div>

                      <button
                        onClick={() => {
                          // 恢复所有颜色的逻辑
                          setExcludedColorKeys(new Set());
                          setRemapTrigger(prev => prev + 1);
                          setIsManualColoringMode(false);
                          setSelectedColor(null);
                          console.log("Restored all excluded colors");
                        }}
                        className="mt-2 w-full text-xs py-1 px-2 bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors"
                      >
                        一键恢复所有颜色
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )} {/* ++ End of HIDE Color Counts ++ */}

          {/* Message if palette becomes empty (Also hide in manual mode) */}
          {!isManualColoringMode && originalImageSrc && activeBeadPalette.length === 0 && excludedColorKeys.size > 0 && (
            // Apply dark mode styles to the warning box
            <div className="w-full md:max-w-2xl mt-6 bg-yellow-100 dark:bg-yellow-900/50 p-4 rounded-lg shadow border border-yellow-200 dark:border-yellow-800/60 text-center text-sm text-yellow-800 dark:text-yellow-300">
              当前可用颜色过少或为空。请在上方统计列表中查看已排除的颜色并恢复部分，或更换色板。
              {excludedColorKeys.size > 0 && (
                // Apply dark mode styles to the inline "restore all" button
                <button
                  onClick={() => {
                    setShowExcludedColors(true); // 展开排除颜色列表
                    // 滚动到颜色列表处
                    setTimeout(() => {
                      const listElement = document.querySelector('.color-stats-panel');
                      if (listElement) {
                        listElement.scrollIntoView({ behavior: 'smooth' });
                      }
                    }, 100);
                  }}
                  className="mt-2 ml-2 text-xs py-1 px-2 bg-yellow-200 dark:bg-yellow-700/60 text-yellow-900 dark:text-yellow-200 rounded hover:bg-yellow-300 dark:hover:bg-yellow-600/70 transition-colors"
                >
                  查看已排除颜色 ({excludedColorKeys.size})
                </button>
              )}
            </div>
          )}

          {/* ++ RENDER Enter Manual Mode Button ONLY when NOT in manual mode ++ */}
          {!isManualColoringMode && originalImageSrc && mappedPixelData && gridDimensions && (
            <div className="w-full md:max-w-2xl mt-4">
              <button
                onClick={() => {
                  // 保存快照后进入手动模式
                  manualModeSnapshotRef.current = {
                    pixelData: mappedPixelData ? mappedPixelData.map(row => row.map(cell => ({ ...cell }))) : null,
                    colorCounts: colorCounts ? JSON.parse(JSON.stringify(colorCounts)) : null,
                    totalBeadCount: totalBeadCount,
                  };
                  setIsManualColoringMode(true);
                  setSelectedColor(null);
                  setTooltipData(null);
                }}
                className={`w-full py-2.5 px-4 text-sm sm:text-base rounded-lg transition-all duration-300 flex items-center justify-center gap-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white shadow-md hover:shadow-lg hover:translate-y-[-1px]`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"> <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" /> </svg>
                进入手动编辑模式
              </button>
            </div>
          )}

          {/* ++ Download Buttons (always visible when image loaded) ++ */}
          {originalImageSrc && mappedPixelData && (
            <div className="w-full md:max-w-2xl mt-4">
              {/* 使用一个大按钮，现在所有的下载设置都通过弹窗控制 */}
              <button
                onClick={() => setIsDownloadSettingsOpen(true)}
                disabled={!mappedPixelData || !gridDimensions || gridDimensions.N === 0 || gridDimensions.M === 0 || activeBeadPalette.length === 0}
                className="w-full py-2.5 px-4 bg-gradient-to-r from-green-500 to-green-600 text-white text-sm sm:text-base rounded-lg hover:from-green-600 hover:to-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg hover:translate-y-[-1px] disabled:hover:translate-y-0 disabled:hover:shadow-md"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                下载拼豆图纸
              </button>
            </div>
          )} {/* ++ End of HIDE Download Buttons ++ */}

          {/* Tooltip Display (Needs update in GridTooltip.tsx) */}
          {tooltipData && (
            <GridTooltip tooltipData={tooltipData} selectedColorSystem={selectedColorSystem} />
          )}

        </main>

        {/* 悬浮工具栏 */}
        {SHOW_FLOATING_TOOLBAR && (
          <FloatingToolbar
            isManualColoringMode={isManualColoringMode}
            isPaletteOpen={isFloatingPaletteOpen}
            onTogglePalette={() => setIsFloatingPaletteOpen(!isFloatingPaletteOpen)}
            onExitManualMode={() => {
              setIsManualColoringMode(false);
              setSelectedColor(null);
              setTooltipData(null);
              setIsEraseMode(false);
              setColorReplaceState({
                isActive: false,
                step: 'select-source'
              });
              setHighlightColorKey(null);
              setIsMagnifierActive(false);
              setMagnifierSelectionArea(null);
            }}
            onToggleMagnifier={handleToggleMagnifier}
            isMagnifierActive={isMagnifierActive}
          />
        )}

        {/* 底部调色盘面板 */}
        {isManualColoringMode && (
          <FloatingColorPalette
            colors={currentGridColors}
            selectedColor={selectedColor}
            onColorSelect={handleColorSelect}
            selectedColorSystem={selectedColorSystem}
            isEraseMode={isEraseMode}
            onEraseToggle={handleEraseToggle}
            fullPaletteColors={fullPaletteColors}
            showFullPalette={showFullPalette}
            onToggleFullPalette={handleToggleFullPalette}
            colorReplaceState={colorReplaceState}
            onColorReplaceToggle={handleColorReplaceToggle}
            onColorReplace={handleColorReplace}
            onHighlightColor={handleHighlightColor}
            isOpen={isFloatingPaletteOpen}
            onToggleOpen={() => setIsFloatingPaletteOpen(!isFloatingPaletteOpen)}
            isActive={activeFloatingTool === 'palette'}
            onActivate={handleActivatePalette}
          />
        )}

        {/* 放大镜工具 */}
        {isManualColoringMode && (
          <>
            <MagnifierTool
              isActive={isMagnifierActive}
              onToggle={handleToggleMagnifier}
              mappedPixelData={mappedPixelData}
              gridDimensions={gridDimensions}
              selectedColor={selectedColor}
              selectedColorSystem={selectedColorSystem}
              onPixelEdit={handleMagnifierPixelEdit}
              cellSize={gridDimensions ? Math.min(6, Math.max(4, 500 / Math.max(gridDimensions.N, gridDimensions.M))) : 6}
              selectionArea={magnifierSelectionArea}
              onClearSelection={() => setMagnifierSelectionArea(null)}
              isFloatingActive={activeFloatingTool === 'magnifier'}
              onActivateFloating={handleActivateMagnifier}
              highlightColorKey={highlightColorKey}
            />

            {/* 放大镜选择覆盖层 */}
            <MagnifierSelectionOverlay
              isActive={isMagnifierActive && !magnifierSelectionArea}
              canvasRef={pixelatedCanvasRef}
              gridDimensions={gridDimensions}
              cellSize={gridDimensions ? Math.min(6, Math.max(4, 500 / Math.max(gridDimensions.N, gridDimensions.M))) : 6}
              onSelectionComplete={setMagnifierSelectionArea}
            />
          </>
        )}

        {/* Apply dark mode styles to the Footer */}
        <footer className="w-full md:max-w-4xl mt-10 mb-6 py-6 text-xs sm:text-sm text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 bg-gradient-to-b from-white to-gray-50 dark:from-gray-900 dark:to-gray-800/50 rounded-lg shadow-inner">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="font-medium text-gray-600 dark:text-gray-300">
              PerlerCraft Studio &copy; {new Date().getFullYear()}
            </p>
            {IS_ACCESS_CONTROL_ENABLED && (
              <div className="flex items-center gap-3 text-xs sm:text-sm text-gray-600 dark:text-gray-300">
                {isAnyAuthActive ? (
                  <>
                    <span className="font-mono text-blue-600 dark:text-blue-300">
                      {isTokenActive ? maskedToken : '📱 手机号验证'}
                    </span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                      剩余 {totalRemainingUses} / {totalAvailableUses} 次
                    </span>
                    {isTokenActive && (
                      <button
                        type="button"
                        onClick={clearActiveToken}
                        className="inline-flex items-center rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-xs text-gray-600 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      >
                        清除授权
                      </button>
                    )}
                    {isPhoneActive && phoneRemainingUses === 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          clearPhoneAuth();
                          setIsPhoneModalOpen(true);
                        }}
                        className="inline-flex items-center rounded border border-orange-400 dark:border-orange-500 px-2 py-1 text-xs text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/30 transition-colors"
                      >
                        次数已用完，更换手机号
                      </button>
                    )}
                    {isPhoneActive && phoneRemainingUses > 0 && (
                      <button
                        type="button"
                        onClick={clearPhoneAuth}
                        className="inline-flex items-center rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-xs text-gray-600 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      >
                        更换手机号
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsPhoneModalOpen(true)}
                    className="text-rose-500 dark:text-rose-400 hover:underline cursor-pointer"
                  >
                    未验证，点击输入手机号
                  </button>
                )}
              </div>
            )}
          </div>
          {tokenError && (
            <p className="mt-2 text-xs text-rose-500 dark:text-rose-400">
              {tokenError}
            </p>
          )}
        </footer>

        {/* 使用导入的下载设置弹窗组件 */}
        <DownloadSettingsModal
          isOpen={isDownloadSettingsOpen}
          onClose={() => setIsDownloadSettingsOpen(false)}
          options={downloadOptions}
          onOptionsChange={setDownloadOptions}
          onDownload={handleDownloadRequest}
        />

        {/* 专心拼豆模式进入前下载提醒弹窗 */}
        <FocusModePreDownloadModal
          isOpen={isFocusModePreDownloadModalOpen}
          onClose={() => setIsFocusModePreDownloadModalOpen(false)}
          onProceedWithoutDownload={handleProceedToFocusMode}
          mappedPixelData={mappedPixelData}
          gridDimensions={gridDimensions}
          selectedColorSystem={selectedColorSystem}
        />
      </div>
    </>
  );
}
