// ===========================================
// ApexCharts Wellness Theme Configuration
// Shared theme settings for all charts
// ===========================================

/**
 * Wellness color palette for stress visualization
 */
export const CHART_COLORS = {
  // Primary colors
  primary: '#0d9488',
  primaryLight: '#14b8a6',
  primaryDark: '#0f766e',
  
  // Stress level colors
  calm: '#10b981',       // 0-25% - Emerald green (original)
  balanced: '#14b8a6',   // 26-50%
  elevated: '#f59e0b',   // 51-70%
  high: '#f87171',       // 71-100%
  
  // UI colors
  text: '#1f2937',
  textMuted: '#9ca3af',
  border: '#e5e7eb',
  surface: '#ffffff',
  surfaceDim: '#f9fafb',
  empty: '#e5e7eb',
};

/**
 * Get stress zone color based on value
 * @param {number} value - Stress value 0-100
 * @returns {string} Hex color
 */
export function getStressColor(value) {
  if (value === 0 || value === null || value === undefined) return CHART_COLORS.empty;
  if (value <= 25) return CHART_COLORS.calm;
  if (value <= 50) return CHART_COLORS.balanced;
  if (value <= 70) return CHART_COLORS.elevated;
  return CHART_COLORS.high;
}

/**
 * Get stress zone name based on value
 * @param {number} value - Stress value 0-100
 * @returns {string} Zone name
 */
export function getStressZoneName(value) {
  if (value === 0 || value === null || value === undefined) return 'No data';
  if (value <= 25) return 'Calm';
  if (value <= 50) return 'Balanced';
  if (value <= 70) return 'Elevated';
  return 'High';
}

/**
 * Shared tooltip configuration for wellness theme
 */
export const tooltipConfig = {
  enabled: true,
  theme: 'light',
  style: {
    fontSize: '12px',
    fontFamily: 'inherit',
  },
  marker: {
    show: true,
  },
  onDatasetHover: {
    highlightDataSeries: true,
  },
};

/**
 * Custom tooltip formatter for stress data
 * @param {Object} options - ApexCharts tooltip options
 * @returns {string} HTML string for tooltip
 */
export function createStressTooltip({ seriesIndex, dataPointIndex, w }) {
  const value = w.config.series[seriesIndex].data[dataPointIndex];
  const category = w.config.xaxis.categories[dataPointIndex];
  const color = getStressColor(value);
  const zone = getStressZoneName(value);
  
  if (value === null || value === undefined) {
    return `
      <div class="chart-tooltip">
        <div class="tooltip-header">${category}</div>
        <div class="tooltip-value text-muted">No data</div>
      </div>
    `;
  }
  
  return `
    <div class="chart-tooltip">
      <div class="tooltip-header">${category}</div>
      <div class="tooltip-value" style="color: ${color}">
        <span class="tooltip-number">${Math.round(value)}%</span>
        <span class="tooltip-zone">${zone}</span>
      </div>
    </div>
  `;
}

/**
 * Shared axis label configuration
 */
export const axisLabelConfig = {
  style: {
    colors: CHART_COLORS.textMuted,
    fontSize: '10px',
    fontWeight: 500,
    fontFamily: 'inherit',
  },
};

/**
 * Shared grid configuration
 */
export const gridConfig = {
  borderColor: CHART_COLORS.border,
  strokeDashArray: 4,
  xaxis: { lines: { show: false } },
  yaxis: { lines: { show: true } },
  padding: { left: 10, right: 10, top: 10, bottom: 0 },
};

/**
 * Shared marker configuration
 */
export const markerConfig = {
  size: 0,
  strokeWidth: 2,
  strokeColors: '#fff',
  colors: [CHART_COLORS.primary],
  hover: {
    size: 6,
    sizeOffset: 2,
  },
  discrete: [],
};

/**
 * Fill configuration for area charts (solid color with transparency)
 */
export const gradientFillConfig = {
  type: 'solid',
  opacity: 0.2,
};

/**
 * Animation configuration
 */
export const animationConfig = {
  enabled: true,
  easing: 'easeinout',
  speed: 400,
  animateGradually: {
    enabled: true,
    delay: 50,
  },
  dynamicAnimation: {
    enabled: true,
    speed: 300,
  },
};

/**
 * Responsive breakpoints configuration
 */
export const responsiveConfig = [
  {
    breakpoint: 480,
    options: {
      chart: { height: 180 },
      xaxis: {
        labels: { rotate: -45 },
      },
    },
  },
];
