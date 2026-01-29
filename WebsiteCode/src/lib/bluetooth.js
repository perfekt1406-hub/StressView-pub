// ===========================================
// Web Bluetooth API Wrapper for StressView
// 
// Handles all BLE communication with the ESP32 device.
// Manages connection lifecycle, characteristic subscriptions, and data parsing.
// Automatically saves received data to IndexedDB for persistence.
// ===========================================

import { parseLiveData, parseHourlyData, parseDailyData } from './parser.js';
import { setState } from './state.js';
import { saveReading, saveHourlySummaries, getTodayDate } from './storage.js';

// BLE Service and Characteristic UUIDs (must match ESP32 DeviceCode.cpp)
// Custom UUIDs avoid conflicts with standard Bluetooth services
const SERVICE_UUID = '0000ff00-0000-1000-8000-00805f9b34fb';
const CHAR_LIVE_UUID = '0000ff01-0000-1000-8000-00805f9b34fb';  // Real-time notifications (7 bytes)
const CHAR_TODAY_UUID = '0000ff02-0000-1000-8000-00805f9b34fb';  // 24-hour history (240 bytes)
const CHAR_WEEK_UUID = '0000ff03-0000-1000-8000-00805f9b34fb';   // 7-day summaries (70 bytes)
const CHAR_COMMAND_UUID = '0000ff04-0000-1000-8000-00805f9b34fb'; // App control commands (write-only)

// Connection state (managed internally, not exposed)
let device = null;        // BluetoothDevice instance
let server = null;        // BluetoothRemoteGATTServer
let service = null;       // BluetoothRemoteGATTService
let liveChar = null;      // Live data characteristic (notifications)
let todayChar = null;     // Today's history characteristic (read)
let weekChar = null;      // Week summaries characteristic (read)
let commandChar = null;   // Command characteristic (write)

// Event callbacks (set by app code)
let onDataCallback = null;        // Called when live data notification received
let onDisconnectCallback = null;   // Called when device disconnects

/**
 * Check if Web Bluetooth is supported
 * @returns {boolean}
 */
export function isSupported() {
  return 'bluetooth' in navigator;
}

/**
 * Check if currently connected
 * @returns {boolean}
 */
export function isConnected() {
  return device?.gatt?.connected ?? false;
}

/**
 * Get connected device name
 * @returns {string|null}
 */
export function getDeviceName() {
  return device?.name ?? null;
}

/**
 * Connect to StressView device via Web Bluetooth.
 * Opens device picker, connects to GATT server, and retrieves all characteristics.
 * 
 * Note: Uses acceptAllDevices=true for better Electron compatibility.
 * Device filtering happens in Electron's custom handler, not in browser API.
 * 
 * @returns {Promise<boolean>} Success status (always true if no error thrown)
 * @throws {Error} If Web Bluetooth unsupported, user cancels, or connection fails
 */
export async function connect() {
  if (!isSupported()) {
    throw new Error('Web Bluetooth is not supported in this browser');
  }

  try {
    // Request device connection (opens system device picker)
    // acceptAllDevices=true shows all BLE devices - more reliable in Electron
    // than filtering by service UUID or name (which can be inconsistent)
    device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [SERVICE_UUID],
    });
    
    // Set up disconnect listener (fires when device goes out of range or powers off)
    device.addEventListener('gattserverdisconnected', handleDisconnect);

    // Connect to GATT server (low-level Bluetooth connection)
    server = await device.gatt.connect();
    console.log('Connected to GATT server');
    
    // Get the StressView service (contains all characteristics)
    service = await server.getPrimaryService(SERVICE_UUID);
    console.log('Got StressView service');

    // Get all characteristics (data endpoints)
    // These are cached for later use (read/write/notify operations)
    liveChar = await service.getCharacteristic(CHAR_LIVE_UUID);
    todayChar = await service.getCharacteristic(CHAR_TODAY_UUID);
    weekChar = await service.getCharacteristic(CHAR_WEEK_UUID);
    commandChar = await service.getCharacteristic(CHAR_COMMAND_UUID);
    console.log('Got all characteristics');
    
    // Update app state to reflect connection
    setState({ connected: true, device: device.name });

    return true;
  } catch (error) {
    console.error('Connection failed:', error);
    // Clean up any partial connection state
    cleanup();
    throw error;
  }
}

/**
 * Disconnect from device
 */
export function disconnect() {
  if (device?.gatt?.connected) {
    device.gatt.disconnect();
  }
  cleanup();
}

/**
 * Subscribe to live data notifications from device.
 * Device sends 7-byte packets at ~1Hz with current sensor readings.
 * Each notification is parsed and saved to IndexedDB automatically.
 * 
 * @param {Function} callback - Optional callback called with parsed data on each notification
 * @returns {Promise<void>}
 * @throws {Error} If not connected to device
 */
export async function subscribe(callback) {
  if (!liveChar) {
    throw new Error('Not connected');
  }

  // Store callback for later invocation (in handleLiveData)
  onDataCallback = callback;

  // Enable notifications on the characteristic
  // Device will now send data packets automatically at ~1Hz
  await liveChar.startNotifications();
  
  // Listen for incoming notification events
  liveChar.addEventListener('characteristicvaluechanged', handleLiveData);
  console.log('Subscribed to live data');
}

/**
 * Unsubscribe from live data notifications
 */
export async function unsubscribe() {
  if (liveChar) {
    try {
      liveChar.removeEventListener('characteristicvaluechanged', handleLiveData);
      await liveChar.stopNotifications();
    } catch (e) {
      // Ignore errors during cleanup
    }
  }
  onDataCallback = null;
}

/**
 * Read today's hourly data from device.
 * Device packs 24 hourly summaries into 240 bytes (10 bytes per hour).
 * Data is read on-demand when app requests it (not streamed).
 * 
 * @returns {Promise<Array>} Array of 24 hourly record objects
 * @throws {Error} If not connected to device
 */
export async function readTodayData() {
  if (!todayChar) {
    throw new Error('Not connected');
  }

  // Read characteristic value (triggers device's onRead callback)
  // Device packs data fresh on each read to ensure it's current
  const value = await todayChar.readValue();
  return parseHourlyData(value);
}

/**
 * Read weekly daily summaries
 * @returns {Promise<Array>} Array of 7 daily summaries
 */
export async function readWeekData() {
  if (!weekChar) {
    throw new Error('Not connected');
  }

  const value = await weekChar.readValue();
  return parseDailyData(value);
}

/**
 * Read all history data from device (today's hourly + week's daily summaries).
 * Reads both characteristics in parallel for efficiency.
 * Automatically updates app state and saves to IndexedDB.
 * 
 * @returns {Promise<Object>} { today: Array, week: Array }
 * @throws {Error} If not connected or read fails
 */
export async function readHistory() {
  try {
    // Read both characteristics in parallel (faster than sequential)
    const [today, week] = await Promise.all([
      readTodayData(),
      readWeekData(),
    ]);
    
    // Update app state so UI reflects the new data immediately
    setState({ todayData: today, weekData: week });

    // Save hourly summaries to IndexedDB for persistence
    // Don't await - let it happen async so it doesn't block UI
    const todayDate = getTodayDate();
    saveHourlySummaries(today, todayDate).catch(err => {
      console.warn('Failed to save hourly summaries:', err);
      // Non-fatal - app continues to work even if save fails
    });

    return { today, week };
  } catch (error) {
    throw error;
  }
}

/**
 * Send command to device
 * @param {number} command - Command byte (0x01=sync, 0x02=refresh)
 * @returns {Promise<void>}
 */
export async function sendCommand(command) {
  if (!commandChar) {
    throw new Error('Not connected');
  }

  const data = new Uint8Array([command]);
  await commandChar.writeValue(data);
  console.log('Sent command:', command);
}

/**
 * Send time synchronization to device.
 * Sends current date/time so device can track real-world time.
 * Format: [0x01, year_low, year_high, month, day, hour, minute, second]
 * @returns {Promise<void>}
 */
export async function syncTime() {
  if (!commandChar) {
    throw new Error('Not connected');
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;  // 1-12
  const day = now.getDate();          // 1-31
  const hour = now.getHours();        // 0-23
  const minute = now.getMinutes();    // 0-59
  const second = now.getSeconds();     // 0-59

  // Pack time data: [command, year_low, year_high, month, day, hour, minute, second]
  const data = new Uint8Array([
    0x01,                    // Command: time sync
    year & 0xFF,             // Year low byte
    (year >> 8) & 0xFF,      // Year high byte
    month,
    day,
    hour,
    minute,
    second
  ]);

  await commandChar.writeValue(data);
  console.log('Time synced:', year, month, day, hour, minute, second);
}

/**
 * Send sync acknowledgment (deprecated - use syncTime instead)
 */
export async function sendSyncAck() {
  await sendCommand(0x01);
}

/**
 * Request history refresh
 */
export async function requestRefresh() {
  await sendCommand(0x02);
}

/**
 * Set disconnect callback
 * @param {Function} callback
 */
export function onDisconnect(callback) {
  onDisconnectCallback = callback;
}

// ===========================================
// Internal handlers
// ===========================================

/**
 * Handle incoming live data notification from device.
 * Called automatically by Web Bluetooth when device sends a notification.
 * Parses 7-byte packet, updates app state, saves to IndexedDB, and invokes callback.
 * 
 * @param {Event} event - Characteristic value changed event
 */
function handleLiveData(event) {
  const dataView = event.target.value; // DataView of the 7-byte buffer
  
  try {
    // Parse binary data into structured object
    const data = parseLiveData(dataView);
    
    // Update app state with new sensor readings
    // Triggers reactive UI updates for all subscribed components
    setState({
      stress: data.stress,
      hr: data.hr,
      hrv: data.hrv,
      gsr: data.gsr,
      hrActive: data.hrActive,
      calibrated: data.calibrated,
    });

    // Save raw reading to IndexedDB for historical analysis
    // Don't await - let it happen async so notifications aren't blocked
    saveReading(data).catch(err => {
      console.warn('Failed to save reading:', err);
      // Non-fatal - app continues to work even if save fails
    });

    // Invoke user-provided callback if set (for custom handling)
    if (onDataCallback) {
      onDataCallback(data);
    }
  } catch (error) {
    console.error('Error parsing live data:', error);
    // Continue processing future notifications even if one fails
  }
}

function handleDisconnect() {
  console.log('Device disconnected');
  cleanup();
  
  if (onDisconnectCallback) {
    onDisconnectCallback();
  }
}

/**
 * Clean up BLE connection state.
 * Removes event listeners, clears references, and updates app state.
 * Called on disconnect or connection failure.
 */
function cleanup() {
  // Remove event listeners to prevent memory leaks
  if (liveChar) {
    liveChar.removeEventListener('characteristicvaluechanged', handleLiveData);
  }
  if (device) {
    device.removeEventListener('gattserverdisconnected', handleDisconnect);
  }

  // Clear all references (allows garbage collection)
  device = null;
  server = null;
  service = null;
  liveChar = null;
  todayChar = null;
  weekChar = null;
  commandChar = null;
  onDataCallback = null;

  // Update app state to reflect disconnection
  setState({ connected: false, device: null });
}
