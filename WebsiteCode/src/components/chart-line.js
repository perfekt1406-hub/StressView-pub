// ===========================================
// Line Chart Component
// Reusable ApexCharts area/line chart for stress data
// ===========================================

import ApexCharts from 'apexcharts';
import { 
  CHART_COLORS, 
  getStressColor, 
  tooltipConfig, 
  gridConfig, 
  markerConfig, 
  animationConfig,
  gradientFillConfig,
  createStressTooltip
} from './chart-theme.js';

/**
 * Create a line chart instance
 * @param {HTMLElement} container - DOM element to render chart into
 * @param {Object} options - Chart configuration options
 * @returns {Object} Chart controller with update/destroy methods
 */
export function createLineChart(container, options = {}) {
  const {
    height = 200,
    showToolbar = false,
    showDataLabels = false,
    enableZoom = false,
    curveType = 'smooth', // 'smooth', 'straight', 'stepline'
    fillGradient = false,
    annotations = [],
    onPointClick = null,
    categories = [],
    yMin = 0,
    yMax = 100,
    useCustomTooltip = false,
  } = options;

  const chartOptions = {
    series: [{
      name: 'Stress',
      data: [],
    }],
    chart: {
      type: 'area',
      height,
      toolbar: { show: showToolbar },
      zoom: { enabled: enableZoom },
      fontFamily: 'inherit',
      animations: animationConfig,
      events: {
        click: onPointClick || undefined,
        dataPointSelection: onPointClick || undefined,
      },
    },
    colors: [CHART_COLORS.primary],
    fill: {
      type: 'solid',
      opacity: 0.2,
    },
    stroke: {
      curve: curveType,
      width: 2.5,
      lineCap: 'round',
    },
    dataLabels: { enabled: showDataLabels },
    xaxis: {
      type: 'category',
      categories,
      labels: {
        style: { 
          colors: CHART_COLORS.textMuted, 
          fontSize: '10px',
          fontWeight: 500,
        },
        rotate: 0,
        hideOverlappingLabels: true,
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
      crosshairs: {
        show: true,
        stroke: { color: CHART_COLORS.border, width: 1, dashArray: 4 },
      },
    },
    yaxis: {
      min: yMin,
      max: yMax,
      tickAmount: 4,
      labels: {
        style: { 
          colors: CHART_COLORS.textMuted, 
          fontSize: '10px',
          fontWeight: 500,
        },
        formatter: (val) => Math.round(val),
      },
    },
    grid: gridConfig,
    tooltip: useCustomTooltip ? {
      ...tooltipConfig,
      custom: createStressTooltip,
    } : {
      ...tooltipConfig,
      y: { 
        formatter: (val) => val !== null ? `${Math.round(val)}%` : 'No data',
      },
    },
    markers: markerConfig,
    annotations: {
      points: annotations.map(a => ({
        x: a.x,
        y: a.y,
        marker: {
          size: 6,
          fillColor: CHART_COLORS.elevated,
          strokeColor: '#fff',
          strokeWidth: 2,
          shape: 'circle',
        },
        label: a.label ? {
          text: a.label,
          borderColor: CHART_COLORS.elevated,
          style: {
            fontSize: '10px',
            background: CHART_COLORS.elevated,
            color: '#fff',
            padding: { left: 5, right: 5, top: 2, bottom: 2 },
          },
        } : undefined,
      })),
    },
  };

  const chart = new ApexCharts(container, chartOptions);
  chart.render();

  // Return controller object
  return {
    /**
     * Update chart data
     * @param {Array} data - Array of numeric values
     * @param {Array} categories - Optional new categories
     * @param {boolean} animate - Whether to animate the update (default false for live updates)
     */
    updateData(data, newCategories = null, animate = false) {
      const updates = { series: [{ data }] };
      if (newCategories) {
        updates.xaxis = { categories: newCategories };
      }
      chart.updateOptions(updates, true, animate);
    },

    /**
     * Update annotations
     * @param {Array} annotations - Array of annotation objects { x, y, label }
     */
    updateAnnotations(newAnnotations) {
      chart.updateOptions({
        annotations: {
          points: newAnnotations.map(a => ({
            x: a.x,
            y: a.y,
            marker: {
              size: 6,
              fillColor: CHART_COLORS.elevated,
              strokeColor: '#fff',
              strokeWidth: 2,
            },
            label: a.label ? {
              text: a.label,
              borderColor: CHART_COLORS.elevated,
              style: { 
                fontSize: '10px',
                background: CHART_COLORS.elevated,
                color: '#fff',
              },
            } : undefined,
          })),
        },
      });
    },

    /**
     * Destroy chart instance
     */
    destroy() {
      chart.destroy();
    },

    /**
     * Get underlying ApexCharts instance
     */
    getInstance() {
      return chart;
    },
  };
}

/**
 * Generate 24-hour category labels
 * @returns {Array} Array of hour strings like '0:00', '1:00', etc.
 */
export function generate24HourCategories() {
  return Array.from({ length: 24 }, (_, i) => `${i}:00`);
}

// Re-export getStressColor for convenience
export { getStressColor };
