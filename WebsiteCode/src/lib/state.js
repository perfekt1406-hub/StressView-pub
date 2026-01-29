// ===========================================
// Simple Reactive State Management
// 
// Centralized state store with pub/sub pattern for reactivity.
// Components subscribe to specific state keys and re-render when they change.
// Uses localStorage for persistence of history data (not connection state).
// ===========================================

/**
 * Application-wide state object.
 * All UI components read from and update this single source of truth.
 * 
 * State categories:
 * - Connection: BLE device connection status
 * - Live data: Real-time sensor readings from device
 * - History: Aggregated hourly/daily summaries
 * - UI: Current page and navigation state
 * - Error: Error messages and notification state
 */
export const state = {
  // BLE connection state (not persisted - resets on page reload)
  connected: false,      // Whether device is currently connected
  device: null,          // Connected device name
  connecting: false,     // Connection attempt in progress
  
  // Live sensor data from device (updated via BLE notifications)
  stress: 0,            // Current stress index (0-100)
  hr: 0,                // Heart rate in BPM
  hrv: 0,               // Heart rate variability in ms
  gsr: 0,               // Galvanic skin response (raw ADC value)
  hrActive: false,      // Heart rate sensor is detecting beats
  calibrated: false,    // Device has completed GSR calibration
  
  // Historical data (persisted to localStorage and IndexedDB)
  todayData: [],        // 24 hourly summary records for today
  weekData: [],         // 7 daily summary records for past week
  
  // UI state
  currentPage: '/',     // Current route path (managed by router)
  
  // Error/notification state
  error: null,           // Current error message (null if no error)
  lastError: null,      // Previous error (prevents duplicate notifications)
};

/**
 * Subscriber registry for reactive updates.
 * Maps state keys to Maps of subscriber callbacks.
 * Structure: Map<key, Map<subscriberId, callback>>
 * 
 * When a key changes, all registered callbacks for that key are invoked.
 */
const subscribers = new Map();

/**
 * Initialize state management system.
 * Loads persisted history data from localStorage (connection state is not persisted).
 * Called once during app initialization.
 */
export function initState() {
  // Load persisted state from localStorage
  // Only history data is persisted - connection state resets on page reload
  const saved = localStorage.getItem('stressview_state');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      // Only restore non-connection state (todayData, weekData)
      // Connection state must be re-established on each page load
      if (parsed.todayData) state.todayData = parsed.todayData;
      if (parsed.weekData) state.weekData = parsed.weekData;
    } catch (e) {
      console.warn('Failed to load saved state:', e);
      // Continue with empty state - app remains functional
    }
  }
}

/**
 * Update application state and notify subscribers.
 * Only updates keys that actually changed to avoid unnecessary re-renders.
 * Automatically persists history data to localStorage after updates.
 * 
 * @param {Object} updates - Object with state keys and new values to set
 * 
 * @example
 * setState({ stress: 45, hr: 72 }); // Updates stress and heart rate
 */
export function setState(updates) {
  const changedKeys = [];
  
  // Track which keys actually changed (reference equality check)
  // Only changed keys trigger subscriber notifications (performance optimization)
  for (const [key, value] of Object.entries(updates)) {
    if (state[key] !== value) {
      state[key] = value;
      changedKeys.push(key);
    }
  }
  
  // Only notify subscribers if something actually changed
  // Prevents unnecessary re-renders and localStorage writes
  if (changedKeys.length > 0) {
    // Notify all subscribers registered for the changed keys
    notifySubscribers(changedKeys);
    
    // Persist history data to localStorage (async, doesn't block)
    // Only history is persisted - connection state is ephemeral
    persistState();
  }
}

/**
 * Subscribe to state changes for specific keys.
 * Callback is invoked whenever any of the subscribed keys change.
 * Returns an unsubscribe function to clean up the subscription.
 * 
 * @param {string|string[]} keys - State key(s) to subscribe to
 * @param {Function} callback - Function called with new state when keys change
 * @returns {Function} Unsubscribe function to remove the subscription
 * 
 * @example
 * const unsubscribe = subscribe(['stress', 'hr'], (newState) => {
 *   console.log('Stress:', newState.stress, 'HR:', newState.hr);
 * });
 * // Later: unsubscribe();
 */
export function subscribe(keys, callback) {
  // Create unique ID for this subscription (allows multiple subscriptions per component)
  const id = Symbol();
  const keyArray = Array.isArray(keys) ? keys : [keys];
  
  // Register callback for each key
  keyArray.forEach(key => {
    if (!subscribers.has(key)) {
      subscribers.set(key, new Map());
    }
    subscribers.get(key).set(id, callback);
  });
  
  // Return cleanup function to remove subscription
  // Components should call this in their unmount() to prevent memory leaks
  return () => {
    keyArray.forEach(key => {
      subscribers.get(key)?.delete(id);
    });
  };
}

/**
 * Notify all subscribers registered for the changed keys.
 * Uses Set to ensure each subscriber is only called once, even if subscribed
 * to multiple changed keys (prevents duplicate re-renders).
 * 
 * @param {string[]} changedKeys - Array of state keys that changed
 */
function notifySubscribers(changedKeys) {
  const notified = new Set(); // Track which subscribers we've already called
  
  changedKeys.forEach(key => {
    const keySubscribers = subscribers.get(key);
    if (keySubscribers) {
      keySubscribers.forEach((callback, id) => {
        // Only call each subscriber once, even if subscribed to multiple changed keys
        // This prevents components from re-rendering multiple times for a single state update
        if (!notified.has(id)) {
          notified.add(id);
          callback(state); // Pass entire state object (subscribers can access any key)
        }
      });
    }
  });
}

/**
 * Persist state to localStorage.
 * Only saves history data (todayData, weekData) - connection state is ephemeral.
 * Called automatically after setState() updates.
 */
function persistState() {
  // Only persist history data, not connection state
  // Connection state must be re-established on each page load (BLE requires user interaction)
  const toPersist = {
    todayData: state.todayData,
    weekData: state.weekData,
  };
  localStorage.setItem('stressview_state', JSON.stringify(toPersist));
}

// ===========================================
// Stress Zone Classification
// ===========================================

/**
 * Get stress zone classification and styling info.
 * Maps numeric stress value (0-100) to human-readable zone with color classes.
 * Used for UI theming and visual feedback.
 * 
 * Zones:
 * - Calm (0-25): Low stress, relaxed state
 * - Balanced (26-50): Normal stress, manageable
 * - Elevated (51-70): Increased stress, attention needed
 * - High (71-100): High stress, intervention recommended
 * 
 * @param {number} stress - Stress index value (0-100)
 * @returns {Object} Zone info with label, CSS class, and color class
 */
export function getStressZone(stress) {
  if (stress <= 25) {
    return { label: 'Calm', class: 'stress-bg-calm', color: 'stress-calm' };
  } else if (stress <= 50) {
    return { label: 'Balanced', class: 'stress-bg-balanced', color: 'stress-balanced' };
  } else if (stress <= 70) {
    return { label: 'Elevated', class: 'stress-bg-elevated', color: 'stress-elevated' };
  } else {
    return { label: 'High', class: 'stress-bg-high', color: 'stress-high' };
  }
}
