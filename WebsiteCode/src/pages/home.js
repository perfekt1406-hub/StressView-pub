// ===========================================
// Home Page - Main Dashboard
// 
// Displays current stress level with live sensor data.
// Shows stress zone (Calm/Balanced/Elevated/High) with color-coded background.
// Provides quick access to breathing exercises and today's summary.
// ===========================================

import { state, subscribe, getStressZone } from '../lib/state.js';

// Subscription management
let unsubscribe = null; // Cleanup function for state subscriptions

/**
 * Render the home page HTML.
 * Returns template string with current stress zone styling applied.
 * Background color changes based on stress level for visual feedback.
 * 
 * @returns {string} HTML template string
 */
export function render() {
  // Get stress zone classification (determines colors and labels)
  const zone = getStressZone(state.stress);
  
  return `
    <div class="page h-full ${zone.class} transition-all duration-500 pb-16">
      <!-- Header: Connection status and settings link -->
      <div class="flex justify-between items-center p-4 shrink-0">
        <div class="flex items-center gap-2">
          <!-- Connection indicator dot (green when connected) -->
          <div class="w-3 h-3 rounded-full ${state.connected ? 'bg-stress-calm' : 'bg-border'}"></div>
          <span class="text-sm text-text-muted">${state.connected ? 'Connected' : 'Not connected'}</span>
        </div>
        <a href="#/settings" class="p-2 text-text-muted hover:text-text">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
        </a>
      </div>
      
      <!-- Main stress display: Large zone label and percentage -->
      <!-- Uses flex-1 to grow and center content vertically -->
      <div class="flex-1 flex flex-col items-center justify-center px-6">
        <p class="text-lg text-text-muted mb-2">You're feeling</p>
        <h1 id="stress-label" class="text-6xl md:text-7xl font-bold text-${zone.color} mb-4">${zone.label}</h1>
        <p id="stress-value" class="text-xl text-text-muted">${state.stress}%</p>
      </div>
      
      <!-- Bottom section: Metrics, actions, and summary teaser -->
      <div class="shrink-0 p-4 space-y-4">
        <!-- Secondary metrics: Heart rate, HRV, sensor status -->
        <div class="p-4 bg-surface/80 backdrop-blur rounded-2xl shadow-sm">
          <div class="grid grid-cols-3 gap-4 text-center">
            <div>
              <p class="text-2xl md:text-3xl font-semibold text-text" id="hr-value">${state.hr || '--'}</p>
              <p class="text-xs text-text-muted">Heart Rate</p>
            </div>
            <div>
              <p class="text-2xl md:text-3xl font-semibold text-text" id="hrv-value">${state.hrv || '--'}</p>
              <p class="text-xs text-text-muted">HRV</p>
            </div>
            <div>
              <p class="text-2xl md:text-3xl font-semibold text-text" id="status-value">${state.hrActive ? 'Active' : 'Idle'}</p>
              <p class="text-xs text-text-muted">Sensor</p>
            </div>
          </div>
        </div>
        
        <!-- Quick action: Navigate to breathing exercises -->
        <a href="#/breathe" class="block w-full py-4 px-6 bg-primary text-white text-center font-semibold rounded-xl shadow-lg hover:bg-primary-dark transition-colors">
          Start Breathing Exercise
        </a>
        
        <!-- Today's summary teaser: Link to detailed today page -->
        <div class="p-4 bg-surface rounded-xl border border-border">
          <div class="flex justify-between items-center">
            <div>
              <p class="font-medium text-text">Today so far</p>
              <p class="text-sm text-text-muted">Tap to see your day</p>
            </div>
            <a href="#/today" class="text-primary font-medium">View →</a>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Mount the home page - attach event listeners and subscribe to state.
 * Called by router when navigating to home page.
 * 
 * @param {HTMLElement} container - Page container element
 */
export function mount(container) {
  // Subscribe to state changes for reactive UI updates
  // Updates display automatically when stress, HR, HRV, or connection status changes
  unsubscribe = subscribe(['stress', 'hr', 'hrv', 'hrActive', 'connected'], (newState) => {
    updateDisplay(newState);
  });
}

/**
 * Unmount the home page - cleanup subscriptions.
 * Called by router when navigating away from home page.
 */
export function unmount() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}

/**
 * Update the display with new state values.
 * Updates stress label, percentage, metrics, and background color reactively.
 * 
 * @param {Object} s - Current state object
 */
function updateDisplay(s) {
  const zone = getStressZone(s.stress);
  
  // Update stress zone label and percentage
  const label = document.getElementById('stress-label');
  const value = document.getElementById('stress-value');
  if (label) {
    label.textContent = zone.label;
    // Update color class dynamically based on zone
    label.className = `text-5xl font-bold text-${zone.color} mb-4`;
  }
  if (value) value.textContent = `${s.stress}%`;
  
  // Update secondary metrics (heart rate, HRV, sensor status)
  const hr = document.getElementById('hr-value');
  const hrv = document.getElementById('hrv-value');
  const status = document.getElementById('status-value');
  if (hr) hr.textContent = s.hr || '--';
  if (hrv) hrv.textContent = s.hrv || '--';
  if (status) status.textContent = s.hrActive ? 'Active' : 'Idle';
  
  // Update page background color based on stress zone
  // Smooth transition via CSS transition class
  const page = container?.querySelector('.page');
  if (page) {
    page.className = `page min-h-screen ${zone.class} transition-all duration-500`;
  }
}
