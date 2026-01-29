// ===========================================
// Bar Chart Component
// Reusable ApexCharts bar chart for weekly comparisons
// ===========================================

import ApexCharts from 'apexcharts';
import { 
  CHART_COLORS, 
  getStressColor, 
  tooltipConfig, 
  gridConfig, 
  animationConfig 
} from './chart-theme.js';

/**
 * Create a bar chart instance
 * @param {HTMLElement} container - DOM element to render chart into
 * @param {Object} options - Chart configuration options
 * @returns {Object} Chart controller with update/destroy methods
 */
export function createBarChart(container, options = {}) {
  const {
    height = 220,
    showToolbar = false,
    showDataLabels = true,
    distributed = true, // Each bar can have different color
    borderRadius = 8,
    columnWidth = '60%',
    categories = [],
    yMin = 0,
    yMax = 100,
    horizontal = false,
    onBarClick = null,
  } = options;

  // Initial empty data
  const initialData = categories.map(() => 0);
  const initialColors = initialData.map(v => getStressColor(v));

  const chartOptions = {
    series: [{
      name: 'Avg Stress',
      data: initialData,
    }],
    chart: {
      type: 'bar',
      height,
      toolbar: { show: showToolbar },
      fontFamily: 'inherit',
      animations: animationConfig,
      events: {
        dataPointSelection: onBarClick || undefined,
      },
    },
    plotOptions: {
      bar: {
        horizontal,
        borderRadius,
        columnWidth,
        distributed,
        dataLabels: {
          position: 'top',
        },
      },
    },
    colors: initialColors,
    dataLabels: {
      enabled: showDataLabels,
      formatter: (val) => val > 0 ? Math.round(val) : '',
      offsetY: -20,
      style: {
        fontSize: '11px',
        fontWeight: 600,
        colors: [CHART_COLORS.textMuted],
      },
    },
    legend: { show: false },
    xaxis: {
      categories,
      labels: {
        style: { 
          colors: CHART_COLORS.textMuted, 
          fontSize: '12px',
          fontWeight: 500,
        },
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
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
    tooltip: {
      ...tooltipConfig,
      y: { 
        formatter: (val) => val > 0 ? `${Math.round(val)}%` : 'No data',
      },
    },
    states: {
      hover: {
        filter: { type: 'darken', value: 0.9 },
      },
      active: {
        filter: { type: 'darken', value: 0.85 },
      },
    },
  };

  const chart = new ApexCharts(container, chartOptions);
  chart.render();

  // Return controller object
  return {
    /**
     * Update chart data with automatic color coding
     * @param {Array} data - Array of numeric values
     * @param {Array} newCategories - Optional new categories
     */
    updateData(data, newCategories = null) {
      const colors = data.map(v => getStressColor(v));
      
      const updates = {
        series: [{ data }],
        colors,
      };
      
      if (newCategories) {
        updates.xaxis = { categories: newCategories };
      }
      
      chart.updateOptions(updates, true, true);
    },

    /**
     * Update just the colors (useful for highlighting)
     * @param {Array} colors - Array of hex colors
     */
    updateColors(colors) {
      chart.updateOptions({ colors }, false, false);
    },

    /**
     * Highlight a specific bar
     * @param {number} index - Bar index to highlight
     */
    highlightBar(index) {
      // ApexCharts doesn't have direct highlight API,
      // but you can trigger hover state programmatically
      chart.toggleDataPointSelection(0, index);
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
 * Generate weekday categories for the past 7 days
 * @returns {Array} Array of short weekday names starting from 6 days ago
 */
export function generateLast7DaysCategories() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    days.push(date.toLocaleDateString('en-US', { weekday: 'short' }));
  }
  return days;
}
