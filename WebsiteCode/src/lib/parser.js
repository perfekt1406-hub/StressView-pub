// ===========================================
// Binary Data Parser for ESP32 BLE Protocol
// ===========================================

/**
 * Parse live data from ESP32 (7 bytes)
 * Format:
 *   [0] stress (0-100)
 *   [1] hr (0-255 BPM)
 *   [2] hrv low byte
 *   [3] hrv high byte
 *   [4] gsr low byte
 *   [5] gsr high byte
 *   [6] status bits
 * 
 * @param {DataView} dataView - DataView of the 7-byte buffer
 * @returns {Object} Parsed live data
 */
export function parseLiveData(dataView) {
  if (dataView.byteLength < 7) {
    throw new Error(`Invalid LiveData length: ${dataView.byteLength}, expected 7`);
  }

  const status = dataView.getUint8(6);

  return {
    stress: dataView.getUint8(0),
    hr: dataView.getUint8(1),
    hrv: dataView.getUint16(2, true), // little-endian
    gsr: dataView.getUint16(4, true), // little-endian
    // Status bit flags
    hrActive: (status & 0x01) !== 0,
    calibrated: (status & 0x02) !== 0,
    motionDetected: (status & 0x04) !== 0,
    activityLevel: (status >> 3) & 0x03,
    mpuReady: (status & 0x80) !== 0,
  };
}

/**
 * Parse hourly data from ESP32 (240 bytes = 24 × 10 bytes)
 * Format per record:
 *   [0] hour (0-23)
 *   [1] avgStress
 *   [2] peakStress
 *   [3] highStressMins
 *   [4] avgHR
 *   [5-6] avgHRV (16-bit LE)
 *   [7-8] avgGSR (16-bit LE)
 *   [9] flags: bit 0=valid, bits 1-2=activityLevel
 * 
 * @param {DataView} dataView - DataView of the 240-byte buffer
 * @returns {Array} Array of 24 hourly records
 */
export function parseHourlyData(dataView) {
  if (dataView.byteLength < 240) {
    throw new Error(`Invalid HourlyData length: ${dataView.byteLength}, expected 240`);
  }

  const records = [];
  
  for (let i = 0; i < 24; i++) {
    const offset = i * 10;
    const flags = dataView.getUint8(offset + 9);
    
    records.push({
      hour: dataView.getUint8(offset),
      avgStress: dataView.getUint8(offset + 1),
      peakStress: dataView.getUint8(offset + 2),
      highStressMins: dataView.getUint8(offset + 3),
      avgHR: dataView.getUint8(offset + 4),
      avgHRV: dataView.getUint16(offset + 5, true),
      avgGSR: dataView.getUint16(offset + 7, true),
      valid: (flags & 0x01) !== 0,
      activityLevel: (flags >> 1) & 0x03,
    });
  }
  
  return records;
}

/**
 * Parse daily summary data from ESP32 (70 bytes = 7 × 10 bytes)
 * Format per record:
 *   [0] day index (0-6)
 *   [1] avgStress
 *   [2] peakStress
 *   [3] peakHour
 *   [4] highStressMins
 *   [5] avgHR
 *   [6-7] avgHRV (16-bit LE)
 *   [8] reserved
 *   [9] valid flag
 * 
 * @param {DataView} dataView - DataView of the 70-byte buffer
 * @returns {Array} Array of 7 daily summaries
 */
export function parseDailyData(dataView) {
  if (dataView.byteLength < 70) {
    throw new Error(`Invalid DailyData length: ${dataView.byteLength}, expected 70`);
  }

  const records = [];
  
  for (let i = 0; i < 7; i++) {
    const offset = i * 10;
    
    records.push({
      dayIndex: dataView.getUint8(offset),
      avgStress: dataView.getUint8(offset + 1),
      peakStress: dataView.getUint8(offset + 2),
      peakHour: dataView.getUint8(offset + 3),
      highStressMins: dataView.getUint8(offset + 4),
      avgHR: dataView.getUint8(offset + 5),
      avgHRV: dataView.getUint16(offset + 6, true),
      valid: dataView.getUint8(offset + 9) !== 0,
    });
  }
  
  return records;
}

/**
 * Get activity level name from numeric value
 * @param {number} level - Activity level (0-3)
 * @returns {string} Activity level name
 */
export function getActivityLevelName(level) {
  const names = ['Still', 'Light', 'Active', 'Exercise'];
  return names[level] || 'Unknown';
}
