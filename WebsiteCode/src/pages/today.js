// ===========================================
// Today Page - Daily Stress Overview
// ===========================================

import { state, subscribe } from '../lib/state.js';
import { 
  getHourlySummaries, 
  getAnnotationsByDate, 
  saveAnnotation,
  deleteAnnotation,
  getTodayDate 
} from '../lib/storage.js';
import { createLineChart, generate24HourCategories } from '../components/chart-line.js';

let container = null;
let chartController = null;
let unsubscribe = null;
let unsubscribeLive = null;
let todayData = [];
let annotations = [];

export function render() {
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', { 
    weekday: 'long', 
    month: 'long', 
    day: 'numeric' 
  });

  return `
    <div class="page h-full bg-surface-dim pb-16">
      <!-- Header -->
      <div class="bg-surface p-4 border-b border-border shrink-0">
        <div class="flex justify-between items-center">
          <div>
            <h1 class="text-xl font-bold text-text">Today</h1>
            <p class="text-sm text-text-muted">${dateStr}</p>
          </div>
          <div class="flex items-center gap-2 text-sm text-text-muted" id="live-indicator">
            <span class="w-2 h-2 rounded-full ${state.connected ? 'bg-stress-calm animate-pulse' : 'bg-border'}"></span>
            <span>${state.connected ? 'Live' : 'Offline'}</span>
          </div>
        </div>
      </div>
      
      <!-- Summary Stats -->
      <div class="p-4 shrink-0">
        <div class="grid grid-cols-3 gap-3">
          <div class="bg-surface rounded-xl p-3 text-center shadow-sm">
            <p class="text-2xl md:text-3xl font-bold text-primary" id="avg-stress">--</p>
            <p class="text-xs text-text-muted">Avg Stress</p>
          </div>
          <div class="bg-surface rounded-xl p-3 text-center shadow-sm">
            <p class="text-2xl md:text-3xl font-bold text-stress-high" id="peak-stress">--</p>
            <p class="text-xs text-text-muted">Peak</p>
          </div>
          <div class="bg-surface rounded-xl p-3 text-center shadow-sm">
            <p class="text-2xl md:text-3xl font-bold text-stress-elevated" id="high-mins">--</p>
            <p class="text-xs text-text-muted">High Mins</p>
          </div>
        </div>
      </div>
      
      <!-- Chart - grows to fill space -->
      <div class="px-4 flex-1 flex flex-col min-h-0">
        <div class="bg-surface rounded-xl p-4 shadow-sm flex-1 flex flex-col">
          <div class="flex justify-between items-center mb-3 shrink-0">
            <h2 class="font-semibold text-text">Stress Over Time</h2>
            <span class="text-xs text-text-muted">24 hours</span>
          </div>
          <div id="stress-chart" class="flex-1 min-h-[150px]"></div>
          <p class="text-xs text-text-muted text-center mt-2 shrink-0">Tap a data point to add annotation</p>
        </div>
      </div>
      
      <!-- Annotations -->
      <div class="p-4 shrink-0">
        <div class="bg-surface rounded-xl p-4 shadow-sm">
          <h2 class="font-semibold text-text mb-3">Annotations</h2>
          <div id="annotations-list" class="max-h-32 overflow-y-auto">
            <p class="text-sm text-text-muted text-center py-4">No annotations yet. Tap a point on the chart above.</p>
          </div>
        </div>
      </div>
      
      <!-- Add Annotation Modal -->
      <div id="annotation-modal" class="hidden fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div class="bg-surface w-full max-w-md rounded-2xl p-6 shadow-xl">
          <h3 class="text-lg font-bold text-text mb-1">Add Annotation</h3>
          <p class="text-sm text-text-muted mb-4" id="modal-time-label">--</p>
          <input 
            type="text" 
            id="annotation-input" 
            placeholder="What were you doing at this time?" 
            class="w-full p-3 border border-border rounded-lg text-text bg-surface-dim mb-4 focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <div class="flex gap-3">
            <button id="cancel-annotation" class="flex-1 py-3 border border-border rounded-lg text-text-muted font-medium hover:bg-surface-dim transition-colors">
              Cancel
            </button>
            <button id="save-annotation" class="flex-1 py-3 bg-primary text-white rounded-lg font-medium hover:bg-primary-dark transition-colors">
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Mount the today page - initialize chart, load data, and set up event listeners.
 * Called by router when navigating to today page.
 * 
 * @param {HTMLElement} pageContainer - Page container element
 */
export async function mount(pageContainer) {
  container = pageContainer;
  
  // Load hourly summaries and annotations from IndexedDB
  await loadData();
  
  // Initialize ApexCharts line chart with 24-hour data
  initChart();
  
  // Calculate and display summary statistics (avg, peak, high stress minutes)
  updateStats();
  
  // Render list of user annotations
  renderAnnotations();
  
  // Set up annotation modal event listeners
  container.querySelector('#cancel-annotation').addEventListener('click', hideAnnotationModal);
  container.querySelector('#save-annotation').addEventListener('click', handleSaveAnnotation);
  // Close modal when clicking backdrop (outside the modal content)
  container.querySelector('#annotation-modal').addEventListener('click', (e) => {
    if (e.target.id === 'annotation-modal') hideAnnotationModal();
  });
  
  // Allow Enter key to save annotation (better UX than clicking button)
  container.querySelector('#annotation-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSaveAnnotation();
  });
  
  // Subscribe to historical data changes (when device syncs new data)
  unsubscribe = subscribe(['todayData'], () => {
    loadData().then(() => {
      updateChartData();
      updateStats();
    });
  });
  
  // Subscribe to live stress updates for real-time chart updates
  // Updates current hour's data point as new readings arrive
  unsubscribeLive = subscribe(['stress', 'connected'], () => {
    updateLiveIndicator();
    // When connected and receiving live data, update the current hour's data point
    // Provides real-time feedback while hour is in progress
    if (state.connected && state.stress > 0) {
      updateCurrentHourPoint();
    }
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
  if (unsubscribeLive) {
    unsubscribeLive();
    unsubscribeLive = null;
  }
  container = null;
}

async function loadData() {
  const dateStr = getTodayDate();
  
  // Load hourly summaries
  try {
    todayData = await getHourlySummaries(dateStr);
  } catch (e) {
    console.warn('Failed to load hourly data:', e);
    todayData = state.todayData || [];
  }
  
  // Load annotations
  try {
    annotations = await getAnnotationsByDate(dateStr);
  } catch (e) {
    console.warn('Failed to load annotations:', e);
    annotations = [];
  }
}

function initChart() {
  const chartEl = container.querySelector('#stress-chart');
  
  // Format annotations for chart
  const chartAnnotations = annotations.map(a => ({
    x: new Date(a.timestamp).getHours() + ':00',
    y: a.stressLevel || 50,
    label: a.text,
  }));
  
  // Get the container height for responsive chart
  const chartHeight = Math.max(chartEl.clientHeight || 200, 150);
  
  // Create chart using the reusable component
  chartController = createLineChart(chartEl, {
    height: chartHeight,
    categories: generate24HourCategories(),
    annotations: chartAnnotations,
    curveType: 'smooth',
    onPointClick: handleChartClick,
  });
  
  // Set initial data with animation
  const seriesData = generateChartData();
  chartController.updateData(seriesData, null, true);
}

/**
 * Generate chart data array for 24-hour stress visualization.
 * Merges historical hourly summaries with live current-hour data.
 * 
 * Data strategy:
 * - Past hours: Use saved hourly summaries if available, null if missing
 * - Current hour: Use live stress value if connected, otherwise saved summary
 * - Future hours: Always null (no data yet)
 * 
 * @returns {Array<number|null>} Array of 24 stress values (null for missing data)
 */
function generateChartData() {
  const data = [];
  const currentHour = new Date().getHours();
  
  for (let h = 0; h < 24; h++) {
    const hourData = todayData.find(d => d.hour === h);
    
    if (hourData && hourData.valid) {
      // Use saved hourly summary (aggregated average for this hour)
      data.push(hourData.avgStress);
    } else if (h === currentHour && state.connected && state.stress > 0) {
      // Current hour: Use live stress value if device is connected
      // Provides real-time feedback while hour is in progress
      data.push(state.stress);
    } else if (h <= currentHour) {
      // Past hours with no data: Show null (chart will show gap)
      data.push(null);
    } else {
      // Future hours: Always null (no data exists yet)
      data.push(null);
    }
  }
  
  return data;
}

function updateChartData() {
  if (!chartController) return;
  
  const seriesData = generateChartData();
  chartController.updateData(seriesData, null, false); // No animation for data updates
  
  // Update annotations
  const chartAnnotations = annotations.map(a => ({
    x: new Date(a.timestamp).getHours() + ':00',
    y: a.stressLevel || 50,
    label: a.text,
  }));
  chartController.updateAnnotations(chartAnnotations);
}

function updateCurrentHourPoint() {
  // Update just the current hour's data point with live stress value
  if (!chartController) return;
  
  const seriesData = generateChartData();
  chartController.updateData(seriesData, null, false); // No animation for live updates
}

function updateLiveIndicator() {
  const indicator = container?.querySelector('#live-indicator');
  if (!indicator) return;
  
  const dot = indicator.querySelector('span:first-child');
  const text = indicator.querySelector('span:last-child');
  
  if (state.connected) {
    dot.className = 'w-2 h-2 rounded-full bg-stress-calm animate-pulse';
    text.textContent = 'Live data streaming';
  } else {
    dot.className = 'w-2 h-2 rounded-full bg-border';
    text.textContent = 'Not connected';
  }
}

function updateStats() {
  const validData = todayData.filter(d => d.valid);
  
  if (validData.length === 0) {
    container.querySelector('#avg-stress').textContent = '--';
    container.querySelector('#peak-stress').textContent = '--';
    container.querySelector('#high-mins').textContent = '--';
    return;
  }
  
  const avgStress = Math.round(
    validData.reduce((sum, d) => sum + d.avgStress, 0) / validData.length
  );
  const peakStress = Math.max(...validData.map(d => d.peakStress));
  const highMins = validData.reduce((sum, d) => sum + (d.highStressMins || 0), 0);
  
  container.querySelector('#avg-stress').textContent = avgStress;
  container.querySelector('#peak-stress').textContent = peakStress;
  container.querySelector('#high-mins').textContent = highMins;
}

function renderAnnotations() {
  const listEl = container.querySelector('#annotations-list');
  
  if (annotations.length === 0) {
    listEl.innerHTML = `
      <div class="text-center py-6">
        <div class="text-text-muted opacity-40 mb-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="mx-auto"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
        </div>
        <p class="text-sm text-text-muted">No annotations yet</p>
        <p class="text-xs text-text-muted mt-1">Tap a point on the chart to add one</p>
      </div>
    `;
    return;
  }
  
  listEl.innerHTML = annotations
    .sort((a, b) => b.timestamp - a.timestamp)
    .map(a => `
      <div class="flex items-center justify-between py-2 border-b border-border last:border-0" data-id="${a.id}">
        <div>
          <p class="text-sm text-text">${a.text}</p>
          <p class="text-xs text-text-muted">${formatTime(a.timestamp)} • ${a.stressLevel || '--'}% stress</p>
        </div>
        <button class="delete-annotation text-red-500 text-sm p-2 hover:bg-red-50 rounded-lg transition-colors">✕</button>
      </div>
    `)
    .join('');
  
  // Add delete handlers
  listEl.querySelectorAll('.delete-annotation').forEach(btn => {
    btn.addEventListener('click', handleDeleteAnnotation);
  });
}

/**
 * Handle chart data point click - opens annotation modal.
 * Only allows annotation on data points that have actual values (not null).
 * 
 * @param {Event} event - Click event
 * @param {Object} chartContext - ApexCharts chart context
 * @param {Object} config - Click configuration with dataPointIndex
 */
function handleChartClick(event, chartContext, config) {
  // Validate that click was on an actual data point (not empty space)
  if (config.dataPointIndex === undefined || config.dataPointIndex < 0) return;
  
  const hour = config.dataPointIndex;
  const seriesData = generateChartData();
  const stressValue = seriesData[hour];
  
  // Only allow annotation on data points that have values
  // Prevents annotating empty hours (no data collected)
  if (stressValue === null || stressValue === undefined) {
    return;
  }
  
  // Create timestamp for this hour (start of hour, e.g., 14:00:00)
  const timestamp = new Date();
  timestamp.setHours(hour, 0, 0, 0);
  
  // Show annotation modal with pre-filled hour and stress value
  showAnnotationModal(timestamp.getTime(), hour, stressValue);
}

let pendingTimestamp = null;
let pendingStressLevel = null;

function showAnnotationModal(timestamp, hour, stressLevel) {
  pendingTimestamp = timestamp;
  pendingStressLevel = stressLevel;
  
  // Format time for display
  const timeLabel = `${hour}:00 - ${hour + 1}:00 • ${Math.round(stressLevel)}% stress`;
  container.querySelector('#modal-time-label').textContent = timeLabel;
  
  container.querySelector('#annotation-modal').classList.remove('hidden');
  container.querySelector('#annotation-input').focus();
}

function hideAnnotationModal() {
  container.querySelector('#annotation-modal').classList.add('hidden');
  container.querySelector('#annotation-input').value = '';
  pendingTimestamp = null;
  pendingStressLevel = null;
}

async function handleSaveAnnotation() {
  const input = container.querySelector('#annotation-input');
  const text = input.value.trim();
  
  if (!text || pendingTimestamp === null) return;
  
  try {
    await saveAnnotation({
      text,
      timestamp: pendingTimestamp,
      stressLevel: pendingStressLevel || state.stress || 50,
    });
    
    // Reload and render
    await loadData();
    renderAnnotations();
    updateChartData();
    
    hideAnnotationModal();
  } catch (e) {
    console.error('Failed to save annotation:', e);
    alert('Failed to save annotation');
  }
}

async function handleDeleteAnnotation(e) {
  const item = e.target.closest('[data-id]');
  const id = parseInt(item.dataset.id);
  
  try {
    await deleteAnnotation(id);
    await loadData();
    renderAnnotations();
    updateChartData();
  } catch (e) {
    console.error('Failed to delete annotation:', e);
  }
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}
