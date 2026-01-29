// ===========================================
// Settings Page
// ===========================================

import { state, subscribe, setState } from '../lib/state.js';
import * as ble from '../lib/bluetooth.js';
import { clearAllData } from '../lib/storage.js';

let unsubscribe = null;
let container = null;

export function render() {
  const supported = ble.isSupported();
  
  return `
    <div class="page h-full bg-surface-dim pb-16">
      <!-- Header -->
      <div class="bg-surface p-4 border-b border-border shrink-0">
        <h1 class="text-xl font-bold text-text">Settings</h1>
      </div>
      
      <!-- Content - scrollable -->
      <div class="flex-1 overflow-y-auto">
      <!-- Device Connection -->
      <div class="p-4">
        <div class="bg-surface rounded-xl p-4 shadow-sm">
          <h2 class="font-semibold text-text mb-3">Device</h2>
          
          ${!supported ? `
            <div class="p-3 bg-amber-50 border border-amber-200 rounded-lg mb-4">
              <p class="text-sm text-amber-800">
                Web Bluetooth is not supported in this browser. Please use Chrome on desktop or Android.
              </p>
            </div>
          ` : ''}
          
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-primary"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
              </div>
              <div>
                <p class="font-medium text-text" id="device-name">${state.device || 'StressView'}</p>
                <p class="text-sm text-text-muted" id="connection-status">${state.connected ? 'Connected' : 'Not connected'}</p>
              </div>
            </div>
            <button 
              id="connect-btn" 
              class="px-4 py-2 ${state.connected ? 'bg-red-100 text-red-600' : 'bg-primary text-white'} rounded-lg font-medium text-sm disabled:opacity-50"
              ${!supported ? 'disabled' : ''}
            >
              ${state.connected ? 'Disconnect' : 'Connect'}
            </button>
          </div>
          
          <!-- Connection error message -->
          <div id="error-message" class="hidden p-3 bg-red-50 border border-red-200 rounded-lg mb-4">
            <p class="text-sm text-red-800"></p>
          </div>
          
          <!-- Loading state -->
          <div id="connecting-state" class="hidden flex items-center gap-2 mb-4">
            <div class="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
            <span class="text-sm text-text-muted">Connecting...</span>
          </div>
          
          <p class="text-xs text-text-muted">
            Connect your StressView device via Bluetooth to see real-time stress data.
          </p>
        </div>
      </div>
      
      <!-- Sync History (only when connected) -->
      ${state.connected ? `
        <div class="p-4 pt-0">
          <div class="bg-surface rounded-xl p-4 shadow-sm">
            <h2 class="font-semibold text-text mb-3">Sync</h2>
            
            <button id="sync-btn" class="w-full py-3 text-primary text-sm font-medium border border-primary rounded-lg hover:bg-primary/5 transition-colors">
              Sync History from Device
            </button>
            
            <p class="text-xs text-text-muted mt-2">
              Download today's hourly data and weekly summaries from your device.
            </p>
          </div>
        </div>
      ` : ''}
      
      <!-- Data Management -->
      <div class="p-4 pt-0">
        <div class="bg-surface rounded-xl p-4 shadow-sm">
          <h2 class="font-semibold text-text mb-3">Data</h2>
          
          <button id="clear-data-btn" class="w-full py-3 text-red-600 text-sm font-medium border border-red-300 rounded-lg hover:bg-red-50 transition-colors">
            Clear All Data
          </button>
          
          <p class="text-xs text-text-muted mt-2">
            Permanently delete all stored data including readings, summaries, and annotations.
          </p>
        </div>
      </div>
      
      <!-- About -->
      <div class="p-4 pt-0">
        <div class="bg-surface rounded-xl p-4 shadow-sm">
          <h2 class="font-semibold text-text mb-3">About</h2>
          <p class="text-sm text-text-muted mb-2">StressView Web App v1.0.0</p>
          <p class="text-xs text-text-muted">
            All data is stored locally on your device. No data is sent to any server.
          </p>
        </div>
      </div>
      </div><!-- end scrollable content -->
    </div>
  `;
}

export function mount(pageContainer) {
  container = pageContainer;
  
  const connectBtn = container.querySelector('#connect-btn');
  const syncBtn = container.querySelector('#sync-btn');
  const clearDataBtn = container.querySelector('#clear-data-btn');
  
  if (connectBtn) {
    connectBtn.addEventListener('click', handleConnect);
  }
  
  if (syncBtn) {
    syncBtn.addEventListener('click', handleSync);
  }
  
  if (clearDataBtn) {
    clearDataBtn.addEventListener('click', handleClearData);
  }
  
  // Subscribe to connection state changes
  unsubscribe = subscribe(['connected', 'device'], updateUI);
  
  // Set up disconnect handler
  ble.onDisconnect(() => {
    showError('Device disconnected');
  });
}

export function unmount() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  container = null;
}

/**
 * Handle connect/disconnect button click.
 * Toggles connection state: connects if disconnected, disconnects if connected.
 * On successful connect, subscribes to live data and syncs history.
 * 
 * Error handling: Shows user-friendly error message if connection fails.
 */
async function handleConnect() {
  const connectBtn = container.querySelector('#connect-btn');
  const connectingState = container.querySelector('#connecting-state');
  const errorMessage = container.querySelector('#error-message');
  
  // Hide any previous error message
  errorMessage?.classList.add('hidden');
  
  if (state.connected) {
    // Already connected - disconnect
    ble.disconnect();
  } else {
    // Not connected - initiate connection
    try {
      // Show loading state (disable button, show spinner)
      connectBtn.disabled = true;
      connectingState?.classList.remove('hidden');
      
      // Request device connection (opens system device picker)
      await ble.connect();
      
      // Sync time immediately after connection
      // Device needs real-world time for accurate hourly data tracking
      try {
        await ble.syncTime();
        console.log('Time synced to device');
      } catch (e) {
        // Non-fatal - device will use millis() fallback
        console.warn('Failed to sync time:', e);
      }
      
      // Subscribe to live data notifications
      // Device will now send sensor readings at ~1Hz
      await ble.subscribe((data) => {
        console.log('Live data:', data);
      });
      
      // Auto-sync history on connect
      // Downloads today's hourly data and week summaries from device
      try {
        await ble.readHistory();
        console.log('History synced');
      } catch (e) {
        // Non-fatal - app continues to work even if history sync fails
        console.warn('Failed to sync history:', e);
      }
      
    } catch (error) {
      // Connection failed - show error to user
      console.error('Connection error:', error);
      showError(error.message || 'Failed to connect');
    } finally {
      // Always restore UI state (enable button, hide spinner)
      connectBtn.disabled = false;
      connectingState?.classList.add('hidden');
    }
  }
}

/**
 * Handle manual history sync button click.
 * Downloads today's hourly data and week summaries from device.
 * Updates app state and saves to IndexedDB for persistence.
 * 
 * Shows visual feedback during sync (button text changes, disabled state).
 */
async function handleSync() {
  const syncBtn = container.querySelector('#sync-btn');
  
  // Validate connection before attempting sync
  if (!state.connected) {
    showError('Not connected to device');
    return;
  }
  
  try {
    // Show sync in progress state
    syncBtn.disabled = true;
    syncBtn.textContent = 'Syncing...';
    
    // Read history from device (triggers device's onRead callbacks)
    await ble.readHistory();
    
    // Show success feedback
    syncBtn.textContent = 'Synced!';
    
    // Reset button after 2 seconds
    const SYNC_SUCCESS_DISPLAY_MS = 2000;
    setTimeout(() => {
      syncBtn.textContent = 'Sync History from Device';
      syncBtn.disabled = false;
    }, SYNC_SUCCESS_DISPLAY_MS);
    
  } catch (error) {
    // Sync failed - show error and restore button
    console.error('Sync error:', error);
    showError(error.message || 'Failed to sync');
    syncBtn.textContent = 'Sync History from Device';
    syncBtn.disabled = false;
  }
}

function showError(message) {
  const errorMessage = container?.querySelector('#error-message');
  if (errorMessage) {
    errorMessage.querySelector('p').textContent = message;
    errorMessage.classList.remove('hidden');
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
      errorMessage.classList.add('hidden');
    }, 5000);
  }
}

/**
 * Handle clear all data button click.
 * Permanently deletes all data from IndexedDB and resets app state.
 * Shows confirmation dialog to prevent accidental deletion.
 */
async function handleClearData() {
  const clearDataBtn = container.querySelector('#clear-data-btn');
  
  // Confirm before deleting
  const confirmed = confirm(
    'Are you sure you want to delete all data?\n\n' +
    'This will permanently remove:\n' +
    '• All sensor readings\n' +
    '• Hourly and daily summaries\n' +
    '• Annotations\n' +
    '• Breathing sessions\n\n' +
    'This action cannot be undone.'
  );
  
  if (!confirmed) return;
  
  try {
    clearDataBtn.disabled = true;
    clearDataBtn.textContent = 'Clearing...';
    
    // Clear all data from IndexedDB
    await clearAllData();
    
    // Clear state data
    setState({
      todayData: [],
      weekData: [],
    });
    
    // Clear localStorage state
    localStorage.removeItem('stressview_state');
    
    // Show success feedback
    clearDataBtn.textContent = 'Data Cleared!';
    clearDataBtn.className = 'w-full py-3 text-green-600 text-sm font-medium border border-green-300 rounded-lg bg-green-50';
    
    // Reset button after 2 seconds
    setTimeout(() => {
      clearDataBtn.textContent = 'Clear All Data';
      clearDataBtn.className = 'w-full py-3 text-red-600 text-sm font-medium border border-red-300 rounded-lg hover:bg-red-50 transition-colors';
      clearDataBtn.disabled = false;
    }, 2000);
    
    console.log('All data cleared successfully');
    
  } catch (error) {
    console.error('Failed to clear data:', error);
    showError('Failed to clear data: ' + error.message);
    clearDataBtn.textContent = 'Clear All Data';
    clearDataBtn.disabled = false;
  }
}

function updateUI() {
  if (!container) return;
  
  const deviceName = container.querySelector('#device-name');
  const connectionStatus = container.querySelector('#connection-status');
  const connectBtn = container.querySelector('#connect-btn');
  
  if (deviceName) {
    deviceName.textContent = state.device || 'StressView';
  }
  
  if (connectionStatus) {
    connectionStatus.textContent = state.connected ? 'Connected' : 'Not connected';
  }
  
  if (connectBtn) {
    connectBtn.textContent = state.connected ? 'Disconnect' : 'Connect';
    connectBtn.className = `px-4 py-2 ${state.connected ? 'bg-red-100 text-red-600' : 'bg-primary text-white'} rounded-lg font-medium text-sm`;
  }
}
