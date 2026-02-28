'use client';

import React, { useState } from 'react';
import { MappedPixel } from '../utils/pixelation';
import { TRANSPARENT_KEY } from '../utils/pixelEditingUtils';
import { ColorReplaceState } from '../hooks/useManualEditingState';
import { ColorSystem, getColorKeyByHex } from '../utils/colorSystemUtils';

interface FloatingColorPaletteProps {
  colors: { key: string; color: string }[];
  selectedColor: MappedPixel | null;
  onColorSelect: (colorData: { key: string; color: string; isExternal?: boolean }) => void;
  selectedColorSystem: ColorSystem;
  isEraseMode: boolean;
  onEraseToggle: () => void;
  fullPaletteColors: { key: string; color: string }[];
  showFullPalette: boolean;
  onToggleFullPalette: () => void;
  colorReplaceState: ColorReplaceState;
  onColorReplaceToggle: () => void;
  onColorReplace: (sourceColor: { key: string; color: string }, targetColor: { key: string; color: string }) => void;
  onHighlightColor: (colorHex: string) => void;
  isOpen: boolean;
  onToggleOpen: () => void;
  isActive: boolean;
  onActivate: () => void;
}

const FloatingColorPalette: React.FC<FloatingColorPaletteProps> = ({
  colors,
  selectedColor,
  onColorSelect,
  selectedColorSystem,
  isEraseMode,
  onEraseToggle,
  fullPaletteColors,
  showFullPalette,
  onToggleFullPalette,
  colorReplaceState,
  onColorReplaceToggle,
  onColorReplace,
  onHighlightColor,
  isOpen,
  onToggleOpen,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // 处理颜色点击
  const handleColorClick = (colorData: { key: string; color: string }) => {
    if (colorReplaceState.isActive && colorReplaceState.step === 'select-target' && colorReplaceState.sourceColor) {
      onColorReplace(colorReplaceState.sourceColor, colorData);
    } else {
      onHighlightColor(colorData.color);
      onColorSelect(colorData);
    }
  };

  const displayColors = showFullPalette ? fullPaletteColors : colors;

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 shadow-[0_-4px_20px_rgba(0,0,0,0.15)] border-t border-gray-200 dark:border-gray-600 z-[60] transition-all duration-300 ease-out ${isExpanded ? 'max-h-[70vh]' : 'max-h-[280px]'
        }`}
      style={{ borderRadius: '16px 16px 0 0' }}
    >
      {/* 拉手 + 标题栏 */}
      <div
        className="flex flex-col items-center pt-2 pb-1 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {/* 拉手指示条 */}
        <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full mb-2" />

        <div className="flex items-center justify-between w-full px-4 pb-1">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 2a2 2 0 00-2 2v11a3 3 0 106 0V4a2 2 0 00-2-2H4zm1 14a1 1 0 100-2 1 1 0 000 2zm5-1.757l4.9-4.9a2 2 0 000-2.828L13.485 5.1a2 2 0 00-2.828 0L10 5.757v8.486zM16 18H9.071l6-6H16a2 2 0 012 2v2a2 2 0 01-2 2z" clipRule="evenodd" />
            </svg>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              调色盘
              {selectedColor && selectedColor.key !== TRANSPARENT_KEY && (
                <span className="ml-2 text-xs text-gray-500">
                  当前: {getColorKeyByHex(selectedColor.color, selectedColorSystem)}
                </span>
              )}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">
              {isExpanded ? '收起 ▼' : '展开 ▲'}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleOpen(); }}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              title="关闭调色盘"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* 模式状态指示器 */}
      {colorReplaceState.isActive && (
        <div className="mx-4 mb-2 p-2 bg-orange-100 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-800 rounded-lg text-xs">
          <div className="flex items-center gap-1 text-orange-700 dark:text-orange-300">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
            <span>
              {colorReplaceState.step === 'select-source' ? '点击画布选择要替换的颜色' : '选择目标颜色'}
            </span>
          </div>
        </div>
      )}

      {/* 工具按钮行 */}
      <div className="flex gap-2 px-4 mb-2">
        {/* 橡皮擦 */}
        <button
          onClick={() => handleColorClick({ key: TRANSPARENT_KEY, color: '#FFFFFF' })}
          className={`flex-1 py-2 px-2 rounded-lg border transition-all duration-200 flex items-center justify-center gap-1 text-xs ${selectedColor?.key === TRANSPARENT_KEY
              ? 'bg-red-500 text-white border-red-500'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'
            }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          橡皮擦
        </button>

        {/* 区域擦除 */}
        <button
          onClick={onEraseToggle}
          className={`flex-1 py-2 px-2 rounded-lg border transition-all duration-200 flex items-center justify-center gap-1 text-xs ${isEraseMode
              ? 'bg-orange-500 text-white border-orange-500'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'
            }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          区域擦除
        </button>

        {/* 批量替换 */}
        <button
          onClick={onColorReplaceToggle}
          className={`flex-1 py-2 px-2 rounded-lg border transition-all duration-200 flex items-center justify-center gap-1 text-xs ${colorReplaceState.isActive
              ? 'bg-blue-500 text-white border-blue-500'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'
            }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
          批量替换
        </button>

        {/* 色板切换 */}
        <button
          onClick={onToggleFullPalette}
          className="flex-1 py-2 px-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs transition-colors"
        >
          {showFullPalette ? `当前 (${colors.length})` : `全部 (${fullPaletteColors.length})`}
        </button>
      </div>

      {/* 颜色网格 — 可滚动区域 */}
      <div className={`px-4 pb-4 overflow-y-auto ${isExpanded ? 'max-h-[calc(70vh-140px)]' : 'max-h-[140px]'}`}>
        <div className="grid grid-cols-8 sm:grid-cols-10 gap-1.5">
          {displayColors.map((colorData) => {
            const isSelected = selectedColor?.key === colorData.key && selectedColor?.color === colorData.color;
            const displayKey = getColorKeyByHex(colorData.color, selectedColorSystem);

            return (
              <button
                key={`${colorData.key}-${colorData.color}`}
                onClick={() => handleColorClick(colorData)}
                className={`aspect-square rounded-lg border-2 transition-all duration-150 ${isSelected
                    ? 'border-blue-500 dark:border-blue-400 ring-2 ring-blue-200 dark:ring-blue-800 scale-110'
                    : 'border-gray-200 dark:border-gray-600 active:scale-95'
                  }`}
                style={{ backgroundColor: colorData.color }}
                title={`${displayKey} (${colorData.color})`}
              >
                {isSelected && (
                  <div className="flex items-center justify-center w-full h-full">
                    <div className="w-2 h-2 bg-white rounded-full shadow-lg"></div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default FloatingColorPalette;