// ===========================================
// IndexedDB Storage for StressView
// 
// Provides persistent storage for sensor readings, hourly summaries,
// annotations, and breathing sessions. Uses IndexedDB instead of localStorage
// for better performance with large datasets and higher storage limits.
// ===========================================

import { openDB } from 'idb';

// Database configuration
const DB_NAME = 'StressViewDB';
const DB_VERSION = 1; // Increment to trigger upgrade handler when schema changes

// Object store names (IndexedDB "tables")
const STORES = {
  READINGS: 'readings',           // Raw sensor readings (pruned to 24h)
  HOURLY: 'hourlySummaries',      // 24-hour aggregated summaries (kept longer)
  ANNOTATIONS: 'annotations',     // User annotations for specific time points
  SESSIONS: 'breathingSessions',  // Completed breathing exercise sessions
};

// Database instance and error state
let db = null;              // Cached database connection
let dbInitFailed = false;   // True if initialization permanently failed
let dbInitError = null;     // Error that caused initialization failure

/**
 * Check if IndexedDB is available
 * @returns {boolean}
 */
export function isDBAvailable() {
  return db !== null && !dbInitFailed;
}

/**
 * Initialize the database
 * @returns {Promise<IDBDatabase>}
 */
/**
 * Initialize the IndexedDB database.
 * Creates object stores and indexes if they don't exist (on first run or version upgrade).
 * Caches the database connection for reuse.
 * 
 * @returns {Promise<IDBDatabase>} Database instance
 * @throws {Error} If database initialization fails (permissions, quota, etc.)
 */
export async function initDB() {
  // Return cached connection if already initialized
  if (db) return db;
  
  // Don't retry if initialization previously failed
  if (dbInitFailed) throw dbInitError;

  try {
    // Open database (creates it if it doesn't exist)
    // upgrade handler runs on first creation or when DB_VERSION increases
    db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(database, oldVersion, newVersion, transaction) {
        // Create readings store for raw sensor data
        // Pruned to 24 hours to prevent unbounded growth
        if (!database.objectStoreNames.contains(STORES.READINGS)) {
          const readingsStore = database.createObjectStore(STORES.READINGS, {
            keyPath: 'id',           // Primary key field
            autoIncrement: true,     // Auto-generate IDs
          });
          // Indexes enable efficient queries by timestamp or date
          readingsStore.createIndex('timestamp', 'timestamp');
          readingsStore.createIndex('date', 'date');
        }

        // Create hourly summaries store
        // Stores aggregated data (24 records per day) - kept longer than raw readings
        if (!database.objectStoreNames.contains(STORES.HOURLY)) {
          const hourlyStore = database.createObjectStore(STORES.HOURLY, {
            keyPath: 'id', // Composite key: 'YYYY-MM-DD-HH' format (e.g., '2025-01-15-14')
          });
          hourlyStore.createIndex('date', 'date');
          hourlyStore.createIndex('timestamp', 'timestamp');
        }

        // Create annotations store for user notes
        // Users can add notes to specific time points on charts
        if (!database.objectStoreNames.contains(STORES.ANNOTATIONS)) {
          const annotationsStore = database.createObjectStore(STORES.ANNOTATIONS, {
            keyPath: 'id',
            autoIncrement: true,
          });
          annotationsStore.createIndex('timestamp', 'timestamp');
          annotationsStore.createIndex('date', 'date');
        }

        // Create breathing sessions store
        // Tracks completed breathing exercises for analytics
        if (!database.objectStoreNames.contains(STORES.SESSIONS)) {
          const sessionsStore = database.createObjectStore(STORES.SESSIONS, {
            keyPath: 'id',
            autoIncrement: true,
          });
          sessionsStore.createIndex('timestamp', 'timestamp');
          sessionsStore.createIndex('date', 'date');
          sessionsStore.createIndex('technique', 'technique'); // Query by technique type
        }
      },
    });

    return db;
  } catch (error) {
    // Mark as failed so we don't retry indefinitely
    dbInitFailed = true;
    dbInitError = error;
    throw error;
  }
}

/**
 * Get the database instance, initializing if needed.
 * Internal helper used by all storage functions.
 * 
 * @returns {Promise<IDBDatabase>} Database instance
 * @throws {Error} If database initialization failed previously
 */
async function getDB() {
  // Check if initialization previously failed (don't retry)
  if (dbInitFailed) {
    throw new Error('IndexedDB is not available. Please use a supported browser or enable storage permissions.');
  }
  
  // Initialize if not already done
  if (!db) {
    await initDB();
  }
  
  return db;
}

// ===========================================
// Readings Store (Real-time data)
// ===========================================

/**
 * Save a live sensor reading to IndexedDB.
 * Called automatically when device sends live data notifications (~1Hz).
 * Raw readings are pruned after 24 hours to prevent database bloat.
 * 
 * @param {Object} reading - Sensor data object { stress, hr, hrv, gsr, hrActive, calibrated, ... }
 * @returns {Promise<number>} The auto-generated record ID
 */
export async function saveReading(reading) {
  const database = await getDB();
  const timestamp = Date.now();
  // Extract date string (YYYY-MM-DD) for efficient date-based queries
  const date = new Date(timestamp).toISOString().split('T')[0];
  
  // Add record with auto-incrementing ID
  return database.add(STORES.READINGS, {
    ...reading,
    timestamp,
    date,
  });
}

/**
 * Get readings for a specific date
 * @param {string} date - Date in 'YYYY-MM-DD' format
 * @returns {Promise<Array>}
 */
export async function getReadingsByDate(date) {
  const database = await getDB();
  return database.getAllFromIndex(STORES.READINGS, 'date', date);
}

/**
 * Get readings within a time range
 * @param {number} startTime - Start timestamp (ms)
 * @param {number} endTime - End timestamp (ms)
 * @returns {Promise<Array>}
 */
export async function getReadingsInRange(startTime, endTime) {
  const database = await getDB();
  const range = IDBKeyRange.bound(startTime, endTime);
  return database.getAllFromIndex(STORES.READINGS, 'timestamp', range);
}

/**
 * Get the most recent readings
 * @param {number} limit - Maximum number of readings to return
 * @returns {Promise<Array>}
 */
export async function getRecentReadings(limit = 100) {
  const database = await getDB();
  const tx = database.transaction(STORES.READINGS, 'readonly');
  const store = tx.objectStore(STORES.READINGS);
  const index = store.index('timestamp');
  
  const readings = [];
  let cursor = await index.openCursor(null, 'prev');
  
  while (cursor && readings.length < limit) {
    readings.push(cursor.value);
    cursor = await cursor.continue();
  }
  
  return readings;
}

// ===========================================
// Hourly Summaries Store
// ===========================================

/**
 * Save an hourly summary
 * @param {Object} summary - Hourly data from device
 * @param {string} dateStr - Date in 'YYYY-MM-DD' format
 * @returns {Promise<string>} The record ID
 */
export async function saveHourlySummary(summary, dateStr) {
  const database = await getDB();
  const id = `${dateStr}-${String(summary.hour).padStart(2, '0')}`;
  
  await database.put(STORES.HOURLY, {
    id,
    date: dateStr,
    timestamp: new Date(`${dateStr}T${String(summary.hour).padStart(2, '0')}:00:00`).getTime(),
    ...summary,
  });
  
  return id;
}

/**
 * Save multiple hourly summaries from device sync.
 * Uses a single transaction for efficiency (all-or-nothing atomicity).
 * Only saves summaries marked as valid (device had data for that hour).
 * 
 * @param {Array} summaries - Array of hourly record objects from device
 * @param {string} dateStr - Date in 'YYYY-MM-DD' format
 * @returns {Promise<void>}
 */
export async function saveHourlySummaries(summaries, dateStr) {
  const database = await getDB();
  // Single transaction for all writes (faster and atomic)
  const tx = database.transaction(STORES.HOURLY, 'readwrite');
  
  for (const summary of summaries) {
    // Only save valid summaries (device had actual data for this hour)
    if (summary.valid) {
      // Composite key: date + hour (e.g., '2025-01-15-14' for 2 PM)
      const id = `${dateStr}-${String(summary.hour).padStart(2, '0')}`;
      
      // Put (upsert) - overwrites existing record if key already exists
      await tx.store.put({
        id,
        date: dateStr,
        // Calculate timestamp for this hour (enables time-based queries)
        timestamp: new Date(`${dateStr}T${String(summary.hour).padStart(2, '0')}:00:00`).getTime(),
        ...summary,
      });
    }
  }
  
  // Wait for transaction to complete
  await tx.done;
}

/**
 * Get hourly summaries for a date
 * @param {string} date - Date in 'YYYY-MM-DD' format
 * @returns {Promise<Array>}
 */
export async function getHourlySummaries(date) {
  const database = await getDB();
  const results = await database.getAllFromIndex(STORES.HOURLY, 'date', date);
  return results;
}

/**
 * Get hourly summaries for multiple dates
 * @param {Array<string>} dates - Array of dates in 'YYYY-MM-DD' format
 * @returns {Promise<Object>} Object keyed by date
 */
export async function getHourlySummariesForDates(dates) {
  const result = {};
  for (const date of dates) {
    result[date] = await getHourlySummaries(date);
  }
  return result;
}

// ===========================================
// Annotations Store
// ===========================================

/**
 * Save an annotation
 * @param {Object} annotation - { text, timestamp, stressLevel }
 * @returns {Promise<number>} The inserted record ID
 */
export async function saveAnnotation(annotation) {
  const database = await getDB();
  const timestamp = annotation.timestamp || Date.now();
  const date = new Date(timestamp).toISOString().split('T')[0];
  
  return database.add(STORES.ANNOTATIONS, {
    ...annotation,
    timestamp,
    date,
  });
}

/**
 * Get annotations for a date
 * @param {string} date - Date in 'YYYY-MM-DD' format
 * @returns {Promise<Array>}
 */
export async function getAnnotationsByDate(date) {
  const database = await getDB();
  return database.getAllFromIndex(STORES.ANNOTATIONS, 'date', date);
}

/**
 * Delete an annotation
 * @param {number} id - Annotation ID
 * @returns {Promise<void>}
 */
export async function deleteAnnotation(id) {
  const database = await getDB();
  return database.delete(STORES.ANNOTATIONS, id);
}

/**
 * Update an annotation
 * @param {number} id - Annotation ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<void>}
 */
export async function updateAnnotation(id, updates) {
  const database = await getDB();
  const existing = await database.get(STORES.ANNOTATIONS, id);
  if (existing) {
    await database.put(STORES.ANNOTATIONS, { ...existing, ...updates });
  }
}

// ===========================================
// Breathing Sessions Store
// ===========================================

/**
 * Save a breathing session
 * @param {Object} session - { technique, duration, cycles, startStress, endStress }
 * @returns {Promise<number>} The inserted record ID
 */
export async function saveBreathingSession(session) {
  const database = await getDB();
  const timestamp = Date.now();
  const date = new Date(timestamp).toISOString().split('T')[0];
  
  return database.add(STORES.SESSIONS, {
    ...session,
    timestamp,
    date,
  });
}

/**
 * Get breathing sessions for a date
 * @param {string} date - Date in 'YYYY-MM-DD' format
 * @returns {Promise<Array>}
 */
export async function getSessionsByDate(date) {
  const database = await getDB();
  return database.getAllFromIndex(STORES.SESSIONS, 'date', date);
}

/**
 * Get recent breathing sessions
 * @param {number} limit - Maximum number to return
 * @returns {Promise<Array>}
 */
export async function getRecentSessions(limit = 10) {
  const database = await getDB();
  const tx = database.transaction(STORES.SESSIONS, 'readonly');
  const store = tx.objectStore(STORES.SESSIONS);
  const index = store.index('timestamp');
  
  const sessions = [];
  let cursor = await index.openCursor(null, 'prev');
  
  while (cursor && sessions.length < limit) {
    sessions.push(cursor.value);
    cursor = await cursor.continue();
  }
  
  return sessions;
}

/**
 * Get total breathing stats
 * @returns {Promise<Object>} { totalSessions, totalMinutes, avgStressReduction }
 */
export async function getBreathingStats() {
  const database = await getDB();
  const sessions = await database.getAll(STORES.SESSIONS);
  
  if (sessions.length === 0) {
    return { totalSessions: 0, totalMinutes: 0, avgStressReduction: 0 };
  }
  
  const totalMinutes = sessions.reduce((sum, s) => sum + (s.duration || 0), 0) / 60;
  const reductions = sessions
    .filter(s => s.startStress != null && s.endStress != null)
    .map(s => s.startStress - s.endStress);
  
  const avgStressReduction = reductions.length > 0
    ? reductions.reduce((a, b) => a + b, 0) / reductions.length
    : 0;
  
  return {
    totalSessions: sessions.length,
    totalMinutes: Math.round(totalMinutes),
    avgStressReduction: Math.round(avgStressReduction),
  };
}

// ===========================================
// Data Pruning
// ===========================================

/**
 * Delete readings older than specified hours.
 * Prevents IndexedDB from growing unbounded by removing old raw sensor data.
 * Hourly summaries are kept longer (they're more valuable and smaller).
 * 
 * Uses cursor-based deletion for efficiency with large datasets.
 * 
 * @param {number} hours - Age threshold in hours (default 24)
 * @returns {Promise<number>} Number of deleted records
 */
export async function pruneOldReadings(hours = 24) {
  const database = await getDB();
  // Calculate cutoff timestamp (everything older than this gets deleted)
  const cutoff = Date.now() - (hours * 60 * 60 * 1000);
  
  const tx = database.transaction(STORES.READINGS, 'readwrite');
  const store = tx.objectStore(STORES.READINGS);
  const index = store.index('timestamp'); // Use timestamp index for range query
  
  let deleted = 0;
  // Open cursor for all records with timestamp <= cutoff
  // Cursor iterates through matching records efficiently
  let cursor = await index.openCursor(IDBKeyRange.upperBound(cutoff));
  
  while (cursor) {
    // Delete current record and move to next
    await cursor.delete();
    deleted++;
    cursor = await cursor.continue();
  }
  
  await tx.done;
  console.log(`Pruned ${deleted} old readings`);
  return deleted;
}

/**
 * Clear all data from a specific store
 * @param {string} storeName - Store name from STORES
 * @returns {Promise<void>}
 */
export async function clearStore(storeName) {
  const database = await getDB();
  await database.clear(storeName);
}

/**
 * Clear all data from all stores
 * @returns {Promise<void>}
 */
export async function clearAllData() {
  const database = await getDB();
  await Promise.all([
    database.clear(STORES.READINGS),
    database.clear(STORES.HOURLY),
    database.clear(STORES.ANNOTATIONS),
    database.clear(STORES.SESSIONS),
  ]);
}

// ===========================================
// Utility Functions
// ===========================================

/**
 * Get today's date string
 * @returns {string} Date in 'YYYY-MM-DD' format
 */
export function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get date string for N days ago
 * @param {number} daysAgo - Number of days in the past
 * @returns {string} Date in 'YYYY-MM-DD' format
 */
export function getDateDaysAgo(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().split('T')[0];
}

/**
 * Get array of date strings for the past week
 * @returns {Array<string>} Array of dates in 'YYYY-MM-DD' format
 */
export function getWeekDates() {
  const dates = [];
  for (let i = 6; i >= 0; i--) {
    dates.push(getDateDaysAgo(i));
  }
  return dates;
}
