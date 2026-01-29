// ===========================================
// Main Application Entry Point
// Initializes all subsystems and starts the SPA
// ===========================================

import './style.css';
import { initRouter, navigate } from './router.js';
import { initState, setState } from './lib/state.js';
import { initDB, pruneOldReadings, getHourlySummaries, getTodayDate, clearAllData } from './lib/storage.js';
import { initNotifications } from './lib/notifications.js';

// Configuration constants
const HOURS_TO_KEEP_READINGS = 24; // Prune readings older than 24 hours
const LOADING_FADE_OUT_MS = 200; // Animation duration for loading screen removal
const PRUNE_INTERVAL_MS = 60 * 60 * 1000; // Run data pruning every hour

/**
 * Initialize the StressView application.
 * Sets up all subsystems in order: state management, storage, routing, and notifications.
 * Loads today's data from IndexedDB if available, then navigates to the initial route.
 * 
 * Uses localStorage as fallback if IndexedDB fails - app remains functional but
 * loses persistence across sessions.
 */
async function init() {
  console.log('StressView Web App starting...');
  
  // Initialize reactive state management (uses localStorage for persistence)
  // This must happen first as other systems depend on state
  initState();
  
  // Initialize IndexedDB for persistent storage of readings and summaries
  // IndexedDB provides better performance and storage limits than localStorage
  try {
    await initDB();
    console.log('IndexedDB initialized');
    
    // One-time clear of any mock/test data (remove this block after first run if desired)
    // Check if we should clear mock data (only runs once, controlled by localStorage flag)
    const mockDataCleared = localStorage.getItem('mock_data_cleared');
    if (!mockDataCleared) {
      console.log('Clearing any existing mock/test data...');
      await clearAllData();
      setState({ todayData: [], weekData: [] });
      localStorage.removeItem('stressview_state');
      localStorage.setItem('mock_data_cleared', 'true');
      console.log('Mock data cleared');
    }
    
    // Load today's hourly data from IndexedDB to restore state after page refresh
    // This ensures continuity - user sees their data even after closing the app
    const todayDate = getTodayDate();
    const hourlySummaries = await getHourlySummaries(todayDate);
    if (hourlySummaries.length > 0) {
      setState({ todayData: hourlySummaries });
      console.log(`Loaded ${hourlySummaries.length} hourly summaries from IndexedDB`);
    }
    
    // Prune old readings on startup to prevent database bloat
    // Only keeps last 24 hours of raw readings (hourly summaries are kept longer)
    await pruneOldReadings(HOURS_TO_KEEP_READINGS);
    
  } catch (error) {
    console.warn('IndexedDB initialization failed:', error);
    // App will still work with localStorage fallback for state management
    // User loses historical data persistence but can still use the app
  }
  
  // Initialize hash-based router for SPA navigation
  // Uses hash routing instead of history API for better Electron compatibility
  initRouter();
  
  // Initialize global notification system for connection status and errors
  initNotifications();
  
  // Remove loading screen with fade-out animation
  // Provides smooth transition from loading state to app content
  const loading = document.getElementById('loading');
  if (loading) {
    loading.style.opacity = '0';
    setTimeout(() => loading.remove(), LOADING_FADE_OUT_MS);
  }
  
  // Navigate to initial route based on URL hash
  // Falls back to home page (/) if no hash is present
  const hash = window.location.hash.slice(1) || '/';
  navigate(hash);
  
  // Set up periodic data pruning to run every hour
  // Prevents IndexedDB from growing unbounded by removing old raw readings
  // Hourly summaries are kept for longer-term analysis
  setInterval(() => {
    pruneOldReadings(HOURS_TO_KEEP_READINGS).catch(err => {
      console.warn('Periodic prune failed:', err);
    });
  }, PRUNE_INTERVAL_MS);
}

// Start app when DOM is ready
// Handles both cases: DOM already loaded (immediate init) or still loading (wait for event)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  // DOM already loaded - initialize immediately
  init();
}
