// ===========================================
// Trends Page - Weekly Stress Overview
// ===========================================

import { state, subscribe } from '../lib/state.js';
import { getHourlySummariesForDates, getWeekDates } from '../lib/storage.js';
import { createBarChart, generateLast7DaysCategories } from '../components/chart-bar.js';

let container = null;
let chartController = null;
let unsubscribe = null;
let weekData = [];

export function render() {
  return `
    <div class="page h-full bg-surface-dim pb-16 overflow-y-auto">
      <!-- Header -->
      <div class="bg-surface p-4 border-b border-border">
        <h1 class="text-xl font-bold text-text">Weekly Trends</h1>
        <p class="text-sm text-text-muted">Last 7 days overview</p>
      </div>
      
      <!-- Week Stats -->
      <div class="p-4">
        <div class="grid grid-cols-2 gap-3">
          <div class="bg-surface rounded-xl p-4 shadow-sm">
            <p class="text-3xl md:text-4xl font-bold text-primary" id="week-avg">--</p>
            <p class="text-sm text-text-muted">Weekly Average</p>
          </div>
          <div class="bg-surface rounded-xl p-4 shadow-sm">
            <p class="text-3xl md:text-4xl font-bold text-stress-calm" id="best-day">--</p>
            <p class="text-sm text-text-muted">Best Day</p>
          </div>
        </div>
      </div>
      
      <!-- Bar Chart -->
      <div class="px-4">
        <div class="bg-surface rounded-xl p-4 shadow-sm">
          <h2 class="font-semibold text-text mb-3">Daily Stress Levels</h2>
          <div id="week-chart" class="h-[200px]"></div>
        </div>
      </div>
      
      <!-- Insights -->
      <div class="p-4 space-y-4">
        <div class="bg-surface rounded-xl p-4 shadow-sm">
          <h2 class="font-semibold text-text mb-3">Insights</h2>
          <div id="insights-list" class="space-y-3">
            <p class="text-sm text-text-muted">Loading insights...</p>
          </div>
        </div>
        
        <!-- Daily Breakdown -->
        <div class="bg-surface rounded-xl p-4 shadow-sm">
          <h2 class="font-semibold text-text mb-3">Daily Breakdown</h2>
          <div id="daily-breakdown" class="space-y-2">
            <p class="text-sm text-text-muted">Loading data...</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

export async function mount(pageContainer) {
  container = pageContainer;
  
  // Load data
  await loadWeekData();
  
  // Initialize chart with new component
  initChart();
  
  // Update stats
  updateStats();
  
  // Generate insights
  generateInsights();
  
  // Render daily breakdown
  renderDailyBreakdown();
  
  // Subscribe to state changes
  unsubscribe = subscribe(['weekData', 'connected'], () => {
    loadWeekData().then(() => {
      updateChartData();
      updateStats();
      generateInsights();
      renderDailyBreakdown();
    });
  });
}

export function unmount() {
  if (chartController) {
    chartController.destroy();
    chartController = null;
  }
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  container = null;
}

async function loadWeekData() {
  const dates = getWeekDates();
  
  // If not connected, show empty state (no data from device or IndexedDB)
  if (!state.connected) {
    weekData = dates.map(date => ({ date, valid: false }));
    return;
  }
  
  // First, check if we have week data directly from device (7-day summaries)
  if (state.weekData && state.weekData.length === 7) {
    // Use the device's week data directly, mapping to dates
    weekData = state.weekData.map((dayData, index) => {
      const date = dates[index];
      if (!dayData.valid) {
        return { date, valid: false };
      }
      return {
        date,
        valid: true,
        avgStress: dayData.avgStress,
        peakStress: dayData.peakStress,
        highMins: dayData.highStressMins || 0,
        hoursRecorded: 24, // Assume full day from device summary
        peakHour: dayData.peakHour,
        avgHR: dayData.avgHR,
        avgHRV: dayData.avgHRV,
      };
    });
    return;
  }
  
  // Fallback to IndexedDB hourly data if no device week data
  try {
    const dataByDate = await getHourlySummariesForDates(dates);
    
    // Process into daily summaries
    weekData = dates.map(date => {
      const hourlyData = dataByDate[date] || [];
      const validHours = hourlyData.filter(h => h.valid);
      
      if (validHours.length === 0) {
        return { date, valid: false };
      }
      
      return {
        date,
        valid: true,
        avgStress: Math.round(validHours.reduce((s, h) => s + h.avgStress, 0) / validHours.length),
        peakStress: Math.max(...validHours.map(h => h.peakStress)),
        highMins: validHours.reduce((s, h) => s + (h.highStressMins || 0), 0),
        hoursRecorded: validHours.length,
      };
    });
  } catch (e) {
    console.warn('Failed to load week data:', e);
    weekData = [];
  }
}

function initChart() {
  const chartEl = container.querySelector('#week-chart');
  
  // Create chart using the reusable component with fixed height
  chartController = createBarChart(chartEl, {
    height: 200,
    categories: generateLast7DaysCategories(),
    distributed: true,
    borderRadius: 8,
    columnWidth: '60%',
    showDataLabels: true,
  });
  
  // Set initial data - use null for invalid data to show empty state
  const seriesData = weekData.map(d => d.valid ? d.avgStress : null);
  chartController.updateData(seriesData);
}

function updateChartData() {
  if (!chartController) return;
  
  // Use null for invalid data to show empty state
  const seriesData = weekData.map(d => d.valid ? d.avgStress : null);
  chartController.updateData(seriesData);
}

function updateStats() {
  const validDays = weekData.filter(d => d.valid);
  
  if (validDays.length === 0) {
    container.querySelector('#week-avg').textContent = '--';
    container.querySelector('#best-day').textContent = '--';
    return;
  }
  
  // Weekly average
  const weekAvg = Math.round(
    validDays.reduce((sum, d) => sum + d.avgStress, 0) / validDays.length
  );
  container.querySelector('#week-avg').textContent = weekAvg;
  
  // Best day
  const bestDay = validDays.reduce((best, d) => 
    d.avgStress < best.avgStress ? d : best
  );
  const bestDayName = new Date(bestDay.date).toLocaleDateString('en-US', { weekday: 'short' });
  container.querySelector('#best-day').textContent = bestDayName;
}

function generateInsights() {
  const insightsEl = container.querySelector('#insights-list');
  const validDays = weekData.filter(d => d.valid);
  
  if (validDays.length < 2) {
    insightsEl.innerHTML = `
      <div class="flex items-start gap-3 p-3 bg-surface-dim rounded-lg">
        <span class="text-xl">📊</span>
        <p class="text-sm text-text-muted">Not enough data yet. Keep tracking to see insights!</p>
      </div>
    `;
    return;
  }
  
  const insights = [];
  
  // Best day insight
  const bestDay = validDays.reduce((best, d) => d.avgStress < best.avgStress ? d : best);
  const bestDayName = new Date(bestDay.date).toLocaleDateString('en-US', { weekday: 'long' });
  insights.push({
    icon: '🌟',
    text: `Your calmest day was <strong>${bestDayName}</strong> with ${bestDay.avgStress}% average stress.`,
  });
  
  // Worst day insight
  const worstDay = validDays.reduce((worst, d) => d.avgStress > worst.avgStress ? d : worst);
  const worstDayName = new Date(worstDay.date).toLocaleDateString('en-US', { weekday: 'long' });
  if (worstDay.date !== bestDay.date) {
    insights.push({
      icon: '⚠️',
      text: `<strong>${worstDayName}</strong> was most stressful at ${worstDay.avgStress}% average.`,
    });
  }
  
  // Weekly trend
  const firstHalf = validDays.slice(0, Math.floor(validDays.length / 2));
  const secondHalf = validDays.slice(Math.floor(validDays.length / 2));
  
  if (firstHalf.length > 0 && secondHalf.length > 0) {
    const firstAvg = firstHalf.reduce((s, d) => s + d.avgStress, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((s, d) => s + d.avgStress, 0) / secondHalf.length;
    const diff = Math.round(secondAvg - firstAvg);
    
    if (Math.abs(diff) >= 5) {
      if (diff < 0) {
        insights.push({
          icon: '📉',
          text: `Great progress! Your stress is <strong>trending down</strong> by ${Math.abs(diff)}%.`,
        });
      } else {
        insights.push({
          icon: '📈',
          text: `Your stress has <strong>increased</strong> by ${diff}% this week. Consider more breathing exercises.`,
        });
      }
    }
  }
  
  // High stress time
  const totalHighMins = validDays.reduce((s, d) => s + (d.highMins || 0), 0);
  if (totalHighMins > 60) {
    insights.push({
      icon: '⏰',
      text: `You spent <strong>${totalHighMins} minutes</strong> in high stress this week.`,
    });
  } else if (totalHighMins < 30 && validDays.length >= 5) {
    insights.push({
      icon: '✨',
      text: `Excellent! Only <strong>${totalHighMins} minutes</strong> of high stress this week.`,
    });
  }
  
  insightsEl.innerHTML = insights.map(i => `
    <div class="flex items-start gap-3 p-3 bg-surface-dim rounded-lg">
      <span class="text-xl">${i.icon}</span>
      <p class="text-sm text-text">${i.text}</p>
    </div>
  `).join('');
}

function renderDailyBreakdown() {
  const breakdownEl = container.querySelector('#daily-breakdown');
  
  const validDays = weekData.filter(d => d.valid);
  
  if (validDays.length === 0) {
    breakdownEl.innerHTML = `
      <div class="text-center py-6">
        <div class="text-text-muted opacity-40 mb-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="mx-auto"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
        </div>
        <p class="text-sm text-text-muted">No data recorded yet</p>
        <p class="text-xs text-text-muted mt-1">Connect your device to start tracking</p>
      </div>
    `;
    return;
  }
  
  breakdownEl.innerHTML = weekData
    .slice()
    .reverse()
    .map(d => {
      const dayName = new Date(d.date).toLocaleDateString('en-US', { 
        weekday: 'short', 
        month: 'short', 
        day: 'numeric' 
      });
      
      if (!d.valid) {
        return `
          <div class="flex items-center justify-between py-2 border-b border-border last:border-0">
            <span class="text-sm text-text-muted">${dayName}</span>
            <span class="text-sm text-text-muted">No data</span>
          </div>
        `;
      }
      
      const stressColor = d.avgStress <= 25 ? 'text-stress-calm' 
        : d.avgStress <= 50 ? 'text-primary'
        : d.avgStress <= 70 ? 'text-stress-elevated'
        : 'text-stress-high';
      
      return `
        <div class="flex items-center justify-between py-2 border-b border-border last:border-0">
          <span class="text-sm text-text">${dayName}</span>
          <div class="flex items-center gap-3">
            <span class="text-xs text-text-muted">${d.hoursRecorded}h recorded</span>
            <span class="text-sm font-semibold ${stressColor}">${d.avgStress}%</span>
          </div>
        </div>
      `;
    })
    .join('');
}
