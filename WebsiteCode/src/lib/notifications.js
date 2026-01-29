// ===========================================
// Global Notification System
// Handles connection status and error toasts
// ===========================================

import { state, subscribe } from './state.js';
import { showToast } from '../components/ui.js';

let wasConnected = false;
let unsubscribe = null;

/**
 * Initialize the notification system
 * Subscribes to connection and error state changes
 */
export function initNotifications() {
  // Track connection changes
  unsubscribe = subscribe(['connected', 'error'], handleStateChange);
  
  // Initial state
  wasConnected = state.connected;
}

/**
 * Handle state changes and show appropriate notifications
 */
function handleStateChange(newState) {
  // Connection lost
  if (wasConnected && !newState.connected) {
    showToast('Device disconnected', 'warning');
    showConnectionBanner(false);
  }
  
  // Connection established
  if (!wasConnected && newState.connected) {
    showToast('Device connected', 'success');
    hideConnectionBanner();
  }
  
  // Error occurred
  if (newState.error && newState.error !== state.lastError) {
    showToast(newState.error, 'error');
  }
  
  wasConnected = newState.connected;
}

/**
 * Show a persistent connection banner at the top of the app
 */
function showConnectionBanner(connected) {
  // Remove existing banner
  hideConnectionBanner();
  
  if (!connected) {
    const banner = document.createElement('div');
    banner.id = 'connection-banner';
    banner.className = 'fixed top-0 left-0 right-0 z-50 bg-stress-elevated text-white text-center py-2 px-4 text-sm font-medium animate-slide-down';
    banner.style.animation = 'slideDown 0.3s ease-out reverse';
    banner.innerHTML = `
      <div class="max-w-md mx-auto flex items-center justify-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
          <line x1="12" y1="9" x2="12" y2="13"></line>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
        <span>Connection lost. <a href="#/settings" class="underline">Reconnect</a></span>
      </div>
    `;
    
    const app = document.getElementById('app');
    if (app) {
      app.style.paddingTop = '40px';
      document.body.insertBefore(banner, document.body.firstChild);
    }
  }
}

/**
 * Hide the connection banner
 */
function hideConnectionBanner() {
  const banner = document.getElementById('connection-banner');
  if (banner) {
    banner.remove();
    const app = document.getElementById('app');
    if (app) {
      app.style.paddingTop = '';
    }
  }
}

/**
 * Cleanup notification subscriptions
 */
export function destroyNotifications() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  hideConnectionBanner();
}
