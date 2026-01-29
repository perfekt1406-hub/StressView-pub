#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Wire.h>
#include <Preferences.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <MPU6050_light.h>
#include "MAX30105.h"

// ===========================================
// HARDWARE CONFIGURATION
// ===========================================
// Pin mapping optimized for XIAO ESP32-C3
#define GSR_PIN             2    // Galvanic skin response sensor (ADC1)
#define BUTTON_PIN          3    // Mode switching button
#define VIBRO_MOTOR_PIN     10   // Haptic feedback for high stress

// I2C shared bus (SDA=GPIO6/D4, SCL=GPIO7/D5) for OLED display, MPU6050, and MAX30102

// ===========================================
// DISPLAY CONFIGURATION
// ===========================================
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

// ===========================================
// MAX30102 SENSOR
// ===========================================
MAX30105 particleSensor;
bool hrSensorActive = false;

// ===========================================
// BLE SERVICE DEFINITION
// ===========================================
// Custom UUIDs for StressView service and characteristics
#define SERVICE_UUID        "0000ff00-0000-1000-8000-00805f9b34fb"
#define CHAR_LIVE_UUID      "0000ff01-0000-1000-8000-00805f9b34fb"  // Real-time notifications
#define CHAR_TODAY_UUID     "0000ff02-0000-1000-8000-00805f9b34fb"  // 24-hour history
#define CHAR_WEEK_UUID      "0000ff03-0000-1000-8000-00805f9b34fb"  // 7-day summary
#define CHAR_COMMAND_UUID   "0000ff04-0000-1000-8000-00805f9b34fb"  // App control commands

BLEServer* pServer = nullptr;
BLECharacteristic* pLiveChar = nullptr;
BLECharacteristic* pTodayChar = nullptr;
BLECharacteristic* pWeekChar = nullptr;
BLECharacteristic* pCommandChar = nullptr;

bool deviceConnected = false;
bool oldDeviceConnected = false;
unsigned long lastBLENotify = 0;

// BLE data buffers (global scope to avoid stack overflow)
uint8_t bleTodayBuffer[240];  // 24 hours × 10 bytes
uint8_t bleWeekBuffer[70];    // 7 days × 10 bytes
bool bleHistoryDirty = true;  // Triggers rebuild on next read

// ===========================================
// TIME SYNCHRONIZATION
// ===========================================
// Maintains current time via BLE sync + millis() offset
// Avoids need for RTC hardware while providing accurate hourly rollups
struct SyncedTime {
  uint8_t hour;
  uint8_t minute;
  uint8_t second;
  uint8_t day;
  uint8_t month;
  uint16_t year;
  unsigned long millisAtSync;  // Reference point for millis() calculations
  bool isValid;                // False until first BLE time sync
};

SyncedTime syncedTime = {0, 0, 0, 1, 1, 2025, 0, false};

// ===========================================
// MOTION DETECTION (MPU6050)
// ===========================================
MPU6050 mpu(Wire);
bool mpuReady = false;

enum ActivityLevel { 
  STILL = 0,    // Variance < 0.005
  LIGHT = 1,    // Variance 0.005-0.03
  ACTIVE = 2,   // Variance 0.03-0.15
  EXERCISE = 3  // Variance > 0.15
};
ActivityLevel currentActivity = STILL;
bool motionDetected = false;

// Rolling buffer for motion variance calculation
#define MOTION_BUFFER_SIZE 50  // 1 second at 50Hz sampling - balances responsiveness with noise filtering
float motionBuffer[MOTION_BUFFER_SIZE];
int motionBufferIndex = 0;
float motionVariance = 0;
unsigned long lastMotionUpdate = 0;

// ===========================================
// HOURLY DATA AGGREGATION
// ===========================================
Preferences preferences;

// Packed structure for flash storage efficiency (10 bytes per hour)
struct HourlySummary {
  uint8_t hour;              // 0-23
  uint8_t avgStress;         // 0-100 stress index
  uint8_t peakStress;        // Maximum stress reached this hour
  uint8_t highStressMins;    // Minutes spent above 70% stress
  uint8_t avgHR;             // Average heart rate (0 = no valid data)
  uint16_t avgHRV;           // Average HRV in milliseconds
  uint16_t avgGSR;           // Raw ADC value average
  uint16_t sampleCount;      // For data validity checking
  uint8_t avgActivityLevel;  // Dominant activity level (0-3)
};

// Storage arrays
#define HOURS_PER_DAY 24
#define DAYS_TO_STORE 7
HourlySummary todayData[HOURS_PER_DAY];
uint8_t currentDay = 0;  // Index 0-6 for rotating weekly storage
uint8_t lastSyncedDay = 0;  // Track last synced day for rollover detection

// Real-time accumulator for current hour
struct HourlyAccumulator {
  uint32_t stressSum;
  uint32_t hrSum;
  uint32_t hrvSum;
  uint32_t gsrSum;
  uint16_t sampleCount;
  uint16_t hrSampleCount;    // Separate count for HR validity
  uint8_t peakStress;
  uint8_t highStressMins;
  uint8_t lastMinute;
  bool highStressThisMinute;
  uint32_t activitySum;
};
HourlyAccumulator hourAccum;

int currentHour = -1;
unsigned long lastHourCheck = 0;

// ===========================================
// UI STATE MANAGEMENT
// ===========================================
enum State { DASHBOARD, BREATHE, INFO };
State currentState = DASHBOARD;

unsigned long lastDebounceTime = 0;
bool systemReady = false;
int buttonState = HIGH;
int lastButtonState = HIGH;

unsigned long buttonPressStartTime = 0;
bool buttonHeldForPowerOff = false;
bool devicePoweredOff = false;


// ===========================================
// HEART RATE VARIABILITY (HRV)
// ===========================================
// RMSSD calculation over rolling window of inter-beat intervals
#define BUFFER_SIZE 30
int rrBuffer[BUFFER_SIZE];
int head = 0, count = 0;
float currentHRV = 0;
uint8_t currentHR = 0;  // Current heart rate in BPM

// Warmup period before HRV becomes reliable
const int HRV_WARMUP_COUNT = 20;  // Requires stable beat history

// Adaptive baseline for relative stress calculation
float longTermHRV = 50.0;         // Starts at typical resting value
float hrvLearningRate = 0.01;     // Slow adaptation to user's personal baseline

// Activity-stratified HRV baselines (multipliers for each activity level)
// HRV naturally decreases during physical activity
const float HRV_ACTIVITY_MULTIPLIER[4] = {
  1.0,   // STILL: full baseline
  0.95,  // LIGHT: slight reduction
  0.80,  // ACTIVE: moderate reduction
  0.65   // EXERCISE: significant reduction (normal during exercise)
};

// ===========================================
// BPM CALCULATION (from MAX30102 IR signal)
// ===========================================
// IR signal buffer for peak detection and min/max tracking
#define IR_BUFFER_SIZE 128
long irBuffer[IR_BUFFER_SIZE];
int irBufferIndex = 0;
long maxValue = 0;
long minValue = 100000;

// BPM calculation variables
#define PEAK_BUFFER_SIZE 10
unsigned long peakTimes[PEAK_BUFFER_SIZE];
int peakIndex = 0;
int peakCount = 0;
float currentBPM = 0;
unsigned long lastPeakTime = 0;
long lastValue = 0;
long peakThreshold = 0;
bool peakDetected = false;

// Adaptive threshold
long runningAvg = 0;
int sampleCount = 0;

// RR interval tracking for HRV (extracted from peak times)
unsigned long lastBeatTime = 0;

// Raw IR value for display and debugging
long rawIR = 0;

// ===========================================
// GALVANIC SKIN RESPONSE (GSR)
// ===========================================
#define GSR_BUFFER_SIZE 50
int gsrBuffer[GSR_BUFFER_SIZE];
int gsrHead = 0, gsrCount = 0;
float currentGSR = 0;
float baselineGSR = 0;
float gsrMaxSwing = 100.0;        // Adapts to user's dynamic range
const float GSR_ALPHA = 0.01;     // Slow baseline tracking for long-term drift
int rawGSR = 0;

// Motion-aware stress detection variables
float physiologicalToMotionRatio = 0.0;  // PMR: (HR+GSR change) / motion variance
float previousHR = 0.0;                  // For tracking HR changes
float previousGSR = 0.0;                 // For tracking GSR changes

// ===========================================
// STRESS CALCULATION
// ===========================================

/**
 * Float version of map() function for linear interpolation
 * Maps a value from one range to another
 */
float mapFloat(float x, float in_min, float in_max, float out_min, float out_max) {
  return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}
bool calibrationComplete = false;
unsigned long calibrationStartTime = 0;
unsigned long lastGSRSampleTime = 0;
long calibrationSum = 0;
int calibrationReadings = 0;
float stressIndex = 0;           // Data recording value (alpha=0.90)
float stressIndexDisplay = 0;    // Display value (alpha=0.40, switches to 0.90 during anxiety)

// ===========================================
// FUNCTION PROTOTYPES
// ===========================================
// HRV and heart rate functions
void addRRInterval(int rrIntervalMs);
float calculateRMSSD();
void updateHeartRate();
void detectPeakAndCalculateBPM(long irValue);

// GSR and stress calculation
void updateGSR();
float calculateStressIndex();

// UI rendering
void drawDashboard();
void drawBreatheMode();
void drawInfoScreen();

// Storage management
void initStorage();
void saveHourlyData(int hour);
void loadTodayData();
void updateHourlyAccumulator();
void checkHourChange();
void clearAllData();

// Time synchronization
void getCurrentTime(uint8_t &hour, uint8_t &minute, uint8_t &second);

// BLE communication
void initBLE();
void updateBLEData();
void packTodayData(uint8_t* buffer);
void packWeekData(uint8_t* buffer);

// Motion detection
void initMPU();
void updateMotion();
void updateActivityLevel();

// Power management
void enterPowerOff();
void wakeFromPowerOff();

// ===========================================
// BLE CALLBACKS
// ===========================================
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
  }
  
  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
  }
};

/**
 * BLE callback for Command characteristic - handles app control commands.
 * Command 0x01: Time sync (8 bytes: command + year(2) + month + day + hour + minute + second)
 * Command 0x02: Force history buffer rebuild
 */
class CommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    String value = pCharacteristic->getValue();
    if (value.length() > 0) {
      uint8_t command = (uint8_t)value[0];
      if (command == 0x01) {
        // Time sync: 8 bytes total
        // [0] = command (0x01)
        // [1-2] = year (little-endian, uint16_t)
        // [3] = month (1-12)
        // [4] = day (1-31)
        // [5] = hour (0-23)
        // [6] = minute (0-59)
        // [7] = second (0-59)
        if (value.length() >= 8) {
          uint16_t year = ((uint16_t)value[2] << 8) | (uint16_t)value[1];
          uint8_t month = (uint8_t)value[3];
          uint8_t day = (uint8_t)value[4];
          uint8_t hour = (uint8_t)value[5];
          uint8_t minute = (uint8_t)value[6];
          uint8_t second = (uint8_t)value[7];
          
          // Validate time values
          if (year >= 2024 && year <= 2100 &&
              month >= 1 && month <= 12 &&
              day >= 1 && day <= 31 &&
              hour < 24 && minute < 60 && second < 60) {
            
            // Update synced time structure
            syncedTime.year = year;
            syncedTime.month = month;
            syncedTime.day = day;
            syncedTime.hour = hour;
            syncedTime.minute = minute;
            syncedTime.second = second;
            syncedTime.millisAtSync = millis();
            syncedTime.isValid = true;
            lastSyncedDay = day;  // Initialize day tracking
            
            // Recalculate current hour based on synced time
            uint8_t currentH, currentM, currentS;
            getCurrentTime(currentH, currentM, currentS);
            currentHour = currentH;
            
            Serial.print("Time synced: ");
            Serial.print(year);
            Serial.print("-");
            Serial.print(month);
            Serial.print("-");
            Serial.print(day);
            Serial.print(" ");
            Serial.print(hour);
            Serial.print(":");
            Serial.print(minute);
            Serial.print(":");
            Serial.println(second);
          }
        }
      } else if (command == 0x02) {
        bleHistoryDirty = true;
      }
    }
  }
};

/**
 * BLE callback for Today characteristic - packs data on-demand.
 * Reduces memory pressure by only packing when app requests data.
 */
class TodayReadCallback : public BLECharacteristicCallbacks {
  void onRead(BLECharacteristic* pCharacteristic) {
    packTodayData(bleTodayBuffer);
    pCharacteristic->setValue(bleTodayBuffer, 240);
  }
};

/**
 * BLE callback for Week characteristic - packs data on-demand.
 * Only rebuilds buffer if data has changed since last read.
 */
class WeekReadCallback : public BLECharacteristicCallbacks {
  void onRead(BLECharacteristic* pCharacteristic) {
    if (bleHistoryDirty) {
      packWeekData(bleWeekBuffer);
      bleHistoryDirty = false;
    }
    pCharacteristic->setValue(bleWeekBuffer, 70);
  }
};

// ===========================================
// SETUP
// ===========================================

/**
 * Initialize all hardware and systems on device startup.
 * Sets up ADC, I2C, display, sensors (MAX30102, MPU6050), storage, and BLE.
 * Begins 5-second GSR calibration period before system becomes ready.
 */
void setup() {
  Serial.begin(115200);
  delay(100);

  analogSetAttenuation(ADC_11db);
  
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(VIBRO_MOTOR_PIN, OUTPUT);

  Wire.begin(6, 7);
  Wire.setClock(1000000);
  delay(200);

  int displayAttempts = 0;
  while (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C) && displayAttempts < 3) {
    delay(500);
    displayAttempts++;
  }
  
  if (displayAttempts >= 3) {
    for(int i = 0; i < 10; i++) {
      analogWrite(VIBRO_MOTOR_PIN, 64);  // 25% strength
      delay(100);
      analogWrite(VIBRO_MOTOR_PIN, 0);
      delay(100);
    }
  }

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(20, 25);
  display.print("Initializing...");
  display.display();
  delay(500);

  display.clearDisplay();
  display.setCursor(20, 25);
  display.print("Init MAX30102...");
  display.display();
  
  if (!particleSensor.begin(Wire, I2C_SPEED_STANDARD)) {
    display.clearDisplay();
    display.setCursor(0, 0);
    display.println("Sensor Error!");
    display.display();
    hrSensorActive = false;
  } else {
    particleSensor.setup();
    particleSensor.setPulseAmplitudeRed(0x0A);
    particleSensor.setPulseAmplitudeGreen(0);
    hrSensorActive = true;
    
    memset(irBuffer, 0, sizeof(irBuffer));
    irBufferIndex = 0;
    maxValue = 0;
    minValue = 100000;
    
    memset(peakTimes, 0, sizeof(peakTimes));
    peakIndex = 0;
    peakCount = 0;
    currentBPM = 0;
    lastPeakTime = 0;
    lastValue = 0;
    peakThreshold = 0;
    peakDetected = false;
    
    runningAvg = 0;
    sampleCount = 0;
    
    lastBeatTime = 0;
    currentHR = 0;
  }

  initStorage();
  initMPU();
  initBLE();

  calibrationStartTime = millis();
  lastDebounceTime = millis();
  systemReady = false;
  currentState = DASHBOARD;
  buttonState = HIGH;
  lastButtonState = HIGH;
}

// ===========================================
// STORAGE MANAGEMENT
// ===========================================

/**
 * Initialize flash storage and load today's hourly data.
 * Sets up Preferences namespace and loads the current day's data from flash.
 * Initializes the hourly accumulator for real-time data collection.
 */
void initStorage() {
  preferences.begin("stressview", false);
  
  currentDay = preferences.getUChar("currentDay", 0);
  loadTodayData();
  
  memset(&hourAccum, 0, sizeof(hourAccum));
  hourAccum.lastMinute = 255;
}

/**
 * Load today's hourly summary data from flash storage.
 * If no data exists for the current day, initializes empty hourly slots.
 */
void loadTodayData() {
  String key = "day" + String(currentDay);
  size_t len = preferences.getBytesLength(key.c_str());
  
  if (len == sizeof(todayData)) {
    preferences.getBytes(key.c_str(), todayData, sizeof(todayData));
  } else {
    memset(todayData, 0, sizeof(todayData));
    for (int i = 0; i < HOURS_PER_DAY; i++) {
      todayData[i].hour = i;
    }
  }
}

/**
 * Save accumulated hourly data to flash storage.
 * Calculates averages from the running accumulator and stores them in the
 * packed HourlySummary structure. Only saves if valid samples were collected.
 * 
 * @param hour Hour index (0-23) to save data for
 */
void saveHourlyData(int hour) {
  if (hour < 0 || hour >= HOURS_PER_DAY) return;
  if (hourAccum.sampleCount == 0) return;
  
  todayData[hour].hour = hour;
  todayData[hour].avgStress = hourAccum.stressSum / hourAccum.sampleCount;
  todayData[hour].peakStress = hourAccum.peakStress;
  todayData[hour].highStressMins = hourAccum.highStressMins;
  todayData[hour].avgHR = (hourAccum.hrSampleCount > 0) ? (hourAccum.hrSum / hourAccum.hrSampleCount) : 0;
  todayData[hour].avgHRV = (hourAccum.hrSampleCount > 0) ? (hourAccum.hrvSum / hourAccum.hrSampleCount) : 0;
  todayData[hour].avgGSR = hourAccum.gsrSum / hourAccum.sampleCount;
  todayData[hour].sampleCount = hourAccum.sampleCount;
  todayData[hour].avgActivityLevel = hourAccum.activitySum / hourAccum.sampleCount;
  
  String key = "day" + String(currentDay);
  preferences.putBytes(key.c_str(), todayData, sizeof(todayData));
}

/**
 * Erase all stored hourly data from flash memory.
 * Removes all 7 days of data and resets the in-memory structures.
 */
void clearAllData() {
  for (int d = 0; d < DAYS_TO_STORE; d++) {
    String key = "day" + String(d);
    preferences.remove(key.c_str());
  }
  
  memset(todayData, 0, sizeof(todayData));
  for (int i = 0; i < HOURS_PER_DAY; i++) {
    todayData[i].hour = i;
  }
  
  memset(&hourAccum, 0, sizeof(hourAccum));
  hourAccum.lastMinute = 255;
}

// ===========================================
// HOURLY DATA AGGREGATION
// ===========================================

/**
 * Accumulate sensor readings for the current hour.
 * Called every second to build up hourly statistics. Tracks running sums
 * for averages, peak values, and minutes spent in high-stress state.
 * Only operates after calibration is complete.
 */
void updateHourlyAccumulator() {
  if (!calibrationComplete) return;
  
  hourAccum.stressSum += (uint32_t)stressIndex;
  hourAccum.gsrSum += (uint32_t)currentGSR;
  
  if (hrSensorActive && currentHR > 0) {
    hourAccum.hrSum += (uint32_t)currentHR;
    hourAccum.hrvSum += (uint32_t)currentHRV;
    hourAccum.hrSampleCount++;
  }
  
  hourAccum.activitySum += (uint32_t)currentActivity;
  hourAccum.sampleCount++;
  
  if ((uint8_t)stressIndex > hourAccum.peakStress) {
    hourAccum.peakStress = (uint8_t)stressIndex;
  }
  
  // Track minutes spent in high-stress state (>70% threshold)
  uint8_t currentMinute;
  if (syncedTime.isValid) {
    uint8_t h, m, s;
    getCurrentTime(h, m, s);
    currentMinute = m;
  } else {
    // Fallback to millis() if time not synced
    unsigned long currentMillis = millis();
    currentMinute = (currentMillis / 60000) % 60;
  }
  
  if (currentMinute != hourAccum.lastMinute) {
    if (hourAccum.highStressThisMinute) {
      hourAccum.highStressMins++;
    }
    hourAccum.highStressThisMinute = false;
    hourAccum.lastMinute = currentMinute;
  }
  
  if (stressIndex > 70) {
    hourAccum.highStressThisMinute = true;
  }
}

/**
 * Check if hour has changed and handle data rollover.
 * Uses synced time if available (from BLE), otherwise falls back to millis()-based clock.
 * When hour changes, saves accumulated data and resets accumulator. Handles day rollover at midnight.
 */
void checkHourChange() {
  int newHour;
  
  if (syncedTime.isValid) {
    // Use synced time (accurate, synced from app)
    uint8_t h, m, s;
    getCurrentTime(h, m, s);
    newHour = h;
  } else {
    // Fallback to millis() if time not synced yet
    unsigned long currentMillis = millis();
    newHour = (currentMillis / 3600000) % 24;
    
    #ifdef DEBUG_FAST_HOURS
    newHour = (currentMillis / 300000) % 24;
    #endif
  }
  
  if (currentHour == -1) {
    currentHour = newHour;
  } else if (newHour != currentHour) {
    int oldHour = currentHour;
    
    saveHourlyData(currentHour);
    bleHistoryDirty = true;
    
    memset(&hourAccum, 0, sizeof(hourAccum));
    hourAccum.lastMinute = 255;
    
    currentHour = newHour;
    
    // Handle day rollover (midnight transition)
    // Check if we crossed midnight (23 -> 0) or if synced time shows different day
    bool dayRollover = false;
    
    if (syncedTime.isValid) {
      // Use synced time to detect day change
      if (syncedTime.day != lastSyncedDay) {
        dayRollover = true;
        lastSyncedDay = syncedTime.day;
      }
    } else {
      // Fallback: detect day rollover from hour change (23 -> 0)
      if (newHour == 0 && oldHour == 23) {
        dayRollover = true;
      }
    }
    
    if (dayRollover) {
      currentDay = (currentDay + 1) % DAYS_TO_STORE;
      preferences.putUChar("currentDay", currentDay);
      
      memset(todayData, 0, sizeof(todayData));
      for (int i = 0; i < HOURS_PER_DAY; i++) {
        todayData[i].hour = i;
      }
    }
  }
}

// ===========================================
// MAIN LOOP
// ===========================================

/**
 * Main program loop - runs continuously after setup().
 * Handles calibration, sensor updates, stress calculation, BLE communication,
 * and display rendering. All timing uses non-blocking millis() checks.
 */
void loop() {
  unsigned long currentMillis = millis();

  // GSR calibration: establish baseline over 5 seconds at startup
  if (!calibrationComplete) {
    if (currentMillis - calibrationStartTime < 5000) {
      if (currentMillis - lastGSRSampleTime >= 20) {
        rawGSR = analogRead(GSR_PIN);
        calibrationSum += rawGSR;
        calibrationReadings++;
        lastGSRSampleTime = currentMillis;
      }
    } else {
      if (calibrationReadings > 0) {
        baselineGSR = (float)calibrationSum / calibrationReadings;
      }
      calibrationComplete = true;
      systemReady = true;
      delay(500);
    }
  }

  // Button handling with debouncing: short press = mode change, 10-second hold = info screen or power off
  if (systemReady) {
    int reading = digitalRead(BUTTON_PIN);
    
    // Detect state change
    if (reading != lastButtonState) {
      lastDebounceTime = currentMillis;
    }
    
    // Only process after debounce period (50ms)
    if ((currentMillis - lastDebounceTime) > 50) {
      
      // Button state has stabilized and changed
      if (reading != buttonState) {
        buttonState = reading;
        
        // Button just pressed (after debounce)
        if (buttonState == LOW) {
          buttonPressStartTime = currentMillis;
          buttonHeldForPowerOff = false;
        }
        
        // Button just released (after debounce)
        if (buttonState == HIGH) {
          unsigned long holdDuration = currentMillis - buttonPressStartTime;
          
          // Short press (less than 10 seconds) = mode change
          if (holdDuration < 10000 && !devicePoweredOff) {
            if (currentState == INFO) {
              // From INFO screen, short press returns to DASHBOARD
              currentState = DASHBOARD;
            } else {
              // From DASHBOARD or BREATHE, cycle between them only (not INFO)
              currentState = (currentState == DASHBOARD) ? BREATHE : DASHBOARD;
            }
          }
        }
      }
      
      // Check for 10-second hold (while button is stable and held)
      if (buttonState == LOW) {
        unsigned long holdDuration = currentMillis - buttonPressStartTime;
        
        if (holdDuration >= 10000 && !buttonHeldForPowerOff) {
          buttonHeldForPowerOff = true;
          
          if (devicePoweredOff) {
            // Wake up from power off
            wakeFromPowerOff();
          } else if (currentState == INFO) {
            // From INFO screen, 10-second hold powers off
            enterPowerOff();
          } else {
            // From DASHBOARD or BREATHE, 10-second hold goes to INFO screen
            currentState = INFO;
          }
        }
      }
    }
    
    lastButtonState = reading;
  } else {
    digitalRead(BUTTON_PIN);
  }

  // Skip sensor updates when powered off
  if (!devicePoweredOff) {
    if (mpuReady && calibrationComplete) {
      updateMotion();
      updateActivityLevel();
    }

    if (hrSensorActive && calibrationComplete) {
      updateHeartRate();
    }

    if (calibrationComplete) {
      updateGSR();
      stressIndex = calculateStressIndex();  // Returns data value, also sets stressIndexDisplay
      
      // Haptic feedback for high stress (>80%) at 25% strength - use display value
      analogWrite(VIBRO_MOTOR_PIN, (stressIndexDisplay > 80) ? 64 : 0);  // 25% strength
      
      static unsigned long lastAccumUpdate = 0;
      if (currentMillis - lastAccumUpdate >= 1000) {
        updateHourlyAccumulator();
        lastAccumUpdate = currentMillis;
      }
      
      if (deviceConnected && (currentMillis - lastBLENotify >= 1000)) {
        updateBLEData();
        lastBLENotify = currentMillis;
      }
      
      // Re-advertise when client disconnects
      if (!deviceConnected && oldDeviceConnected) {
        delay(500);
        BLEDevice::startAdvertising();
        oldDeviceConnected = deviceConnected;
      }
      if (deviceConnected && !oldDeviceConnected) {
        oldDeviceConnected = deviceConnected;
      }
    }
  }

  // Check hour transitions once per minute
  if (currentMillis - lastHourCheck >= 60000) {
    checkHourChange();
    lastHourCheck = currentMillis;
  }

  // Only update display if not powered off
  if (!devicePoweredOff) {
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    
    if (!calibrationComplete) {
      display.setCursor(25, 25);
      display.print("CALIBRATING...");
      display.drawRect(20, 40, 88, 6, WHITE);
      display.fillRect(
        20, 40,
        map(currentMillis - calibrationStartTime, 0, 5000, 0, 88),
        6, WHITE
      );
    } else {
      switch (currentState) {
        case DASHBOARD: drawDashboard(); break;
        case BREATHE:   drawBreatheMode(); break;
        case INFO:      drawInfoScreen(); break;
      }
    }
    display.display();
  }
}

// ===========================================
// HRV CALCULATION
// ===========================================

/**
 * Add a new RR interval (time between heartbeats) to the buffer.
 * Filters out outlier beats (>20% deviation) which are likely noise or ectopic beats.
 * Updates HRV calculation and adaptive baseline once sufficient data is collected.
 * 
 * @param rrIntervalMs RR interval in milliseconds
 */
void addRRInterval(int rrIntervalMs) {
  // Reject outlier beats - >20% deviation from previous beat indicates noise/ectopic
  if (count > 0) {
    int prevBeat = rrBuffer[(head - 1 + BUFFER_SIZE) % BUFFER_SIZE];
    if (abs(rrIntervalMs - prevBeat) / (float)prevBeat > 0.20)
      rrIntervalMs = prevBeat;
  }

  rrBuffer[head] = rrIntervalMs;
  head = (head + 1) % BUFFER_SIZE;
  if (count < BUFFER_SIZE) count++;

  if (count >= HRV_WARMUP_COUNT) {
    currentHRV = calculateRMSSD();
    
    // Exponential moving average adapts to user's personal HRV baseline
    longTermHRV =
      (hrvLearningRate * currentHRV) +
      ((1.0 - hrvLearningRate) * longTermHRV);
  }
}

/**
 * Calculate RMSSD (Root Mean Square of Successive Differences) from RR intervals.
 * RMSSD is a time-domain measure of heart rate variability. Higher values
 * indicate better autonomic nervous system function and lower stress.
 * 
 * @return RMSSD value in milliseconds, or 0 if insufficient data
 */
float calculateRMSSD() {
  if (count < 2) return 0;
  long sumSq = 0;

  // Calculate sum of squared differences between consecutive RR intervals
  for (int i = 0; i < count - 1; i++) {
    int cur = (head - count + i + BUFFER_SIZE) % BUFFER_SIZE;
    int nxt = (head - count + i + 1 + BUFFER_SIZE) % BUFFER_SIZE;
    int diff = rrBuffer[nxt] - rrBuffer[cur];
    sumSq += (long)diff * diff;
  }

  return sqrt(sumSq / (float)(count - 1));
}

// ===========================================
// BPM CALCULATION
// ===========================================

/**
 * Update heart rate detection from MAX30102 IR sensor.
 * Reads IR signal at 50Hz (every 20ms) for reliable peak detection.
 * Maintains adaptive baseline and signal range tracking. Detects beats
 * and calculates BPM using peak interval method.
 */
void updateHeartRate() {
  static unsigned long lastIRRead = 0;
  unsigned long currentMillis = millis();
  
  if (currentMillis - lastIRRead >= 20) {
    long irValue = particleSensor.getIR();
    rawIR = irValue;  // Store for display
    lastIRRead = currentMillis;
    
    // Print raw IR to Serial Monitor
    Serial.print("IR:");
    Serial.println(irValue);
    
    // Store value in buffer
    irBuffer[irBufferIndex] = irValue;
    irBufferIndex = (irBufferIndex + 1) % IR_BUFFER_SIZE;
    
    // Calculate min and max values in current buffer
    maxValue = irBuffer[0];
    minValue = irBuffer[0];
    
    for(int i = 0; i < IR_BUFFER_SIZE; i++) {
      if(irBuffer[i] > maxValue) maxValue = irBuffer[i];
      if(irBuffer[i] < minValue && irBuffer[i] > 0) minValue = irBuffer[i];
    }
    
    // Prevent division by zero
    if(maxValue == minValue) {
      maxValue = minValue + 1;
    }
    
    // Detect peaks and calculate BPM
    detectPeakAndCalculateBPM(irValue);
    
    // Update currentHR from calculated BPM
    currentHR = (uint8_t)currentBPM;
  }
}

/**
 * Detect peaks and calculate BPM from IR signal using adaptive threshold method.
 * Uses derivative-based peak detection with 60% threshold above minimum.
 * Also extracts RR intervals for HRV calculation.
 * 
 * @param irValue Current IR sensor reading
 */
void detectPeakAndCalculateBPM(long irValue) {
  unsigned long currentTime = millis();
  
  // Update running average for adaptive threshold
  runningAvg = (runningAvg * sampleCount + irValue) / (sampleCount + 1);
  sampleCount++;
  if(sampleCount > 100) sampleCount = 100; // Prevent overflow
  
  // Calculate adaptive threshold (60% of the range above minimum)
  peakThreshold = minValue + (maxValue - minValue) * 0.6;
  
  // Peak detection using derivative method
  // A peak is when: current > last AND current > threshold AND enough time passed
  if(irValue > lastValue && 
     irValue > peakThreshold && 
     !peakDetected &&
     (currentTime - lastPeakTime) > 300) { // Minimum 300ms between peaks (max 200 BPM)
    
    peakDetected = true;
    lastPeakTime = currentTime;
    
    // Extract RR interval for HRV calculation
    if (lastBeatTime > 0) {
      unsigned long rrInterval = currentTime - lastBeatTime;
      
      // Validate RR interval is within physiological range (30-200 BPM)
      if (rrInterval >= 300 && rrInterval <= 2000) {
        addRRInterval((int)rrInterval);
      }
    }
    lastBeatTime = currentTime;
    
    // Store peak time
    peakTimes[peakIndex] = currentTime;
    peakIndex = (peakIndex + 1) % PEAK_BUFFER_SIZE;
    if(peakCount < PEAK_BUFFER_SIZE) peakCount++;
    
    // Calculate BPM from last few peaks
    if(peakCount >= 3) {
      // Calculate average interval between peaks
      unsigned long totalInterval = 0;
      int validIntervals = 0;
      
      for(int i = 1; i < peakCount; i++) {
        int prevIndex = (peakIndex - i - 1 + PEAK_BUFFER_SIZE) % PEAK_BUFFER_SIZE;
        int currIndex = (peakIndex - i + PEAK_BUFFER_SIZE) % PEAK_BUFFER_SIZE;
        
        unsigned long interval = peakTimes[currIndex] - peakTimes[prevIndex];
        
        // Only use intervals in valid range (250ms to 2000ms = 30-240 BPM)
        if(interval > 250 && interval < 2000) {
          totalInterval += interval;
          validIntervals++;
        }
      }
      
      if(validIntervals > 0) {
        float avgInterval = (float)totalInterval / validIntervals;
        currentBPM = 60000.0 / avgInterval; // Convert ms to BPM
        
        // Constrain to realistic range
        if(currentBPM < 40) currentBPM = 0;
        if(currentBPM > 200) currentBPM = 0;
      }
    }
  }
  
  // Reset peak detection flag when signal drops
  if(irValue < lastValue) {
    peakDetected = false;
  }
  
  lastValue = irValue;
}

// ===========================================
// GSR MONITORING
// ===========================================

/**
 * Update galvanic skin response (GSR) reading and baseline.
 * Reads raw ADC value, applies rolling average for noise reduction,
 * and slowly adapts baseline to account for long-term drift from
 * temperature changes and hydration levels.
 */
void updateGSR() {
  rawGSR = analogRead(GSR_PIN);
  
  gsrBuffer[gsrHead] = rawGSR;
  gsrHead = (gsrHead + 1) % GSR_BUFFER_SIZE;
  if (gsrCount < GSR_BUFFER_SIZE) gsrCount++;

  long sum = 0;
  for (int i = 0; i < gsrCount; i++) sum += gsrBuffer[i];
  currentGSR = sum / (float)gsrCount;

  // Exponential moving average with very low alpha (0.01) for slow baseline tracking
  // Compensates for environmental factors without masking stress responses
  baselineGSR =
    (GSR_ALPHA * currentGSR) +
    ((1.0 - GSR_ALPHA) * baselineGSR);
}

/**
 * Calculate composite stress index from HRV and GSR sensors with motion awareness.
 * Combines two physiological signals with activity context:
 * - HRV: Lower variability indicates higher stress (more reliable)
 * - GSR: Deviation from baseline indicates sympathetic arousal
 * - Motion: Used to distinguish stress from physical activity
 * 
 * Uses activity-stratified baselines and Physiological-to-Motion Ratio (PMR)
 * to differentiate psychological stress from exercise-induced changes.
 * 
 * @return Stress index 0-100 (0 = relaxed, 100 = high stress)
 */
float calculateStressIndex() {
  float hrvScore = 0;

  // Calculate activity-adjusted HRV baseline
  // HRV naturally decreases during physical activity, so adjust expected baseline
  float activityAdjustedHRVBaseline = longTermHRV * HRV_ACTIVITY_MULTIPLIER[currentActivity];

  // HRV component: maps current HRV to activity-adjusted baseline range
  // Lower HRV relative to baseline = higher stress score
  if (hrSensorActive && count >= HRV_WARMUP_COUNT) {
    hrvScore = constrain(
      mapFloat(currentHRV, activityAdjustedHRVBaseline * 0.4, activityAdjustedHRVBaseline, 100, 0),
      0, 100
    );
  }

  // GSR component: absolute deviation from baseline indicates arousal
  float gsrDiff = abs(currentGSR - baselineGSR);
  
  // Adaptively track user's maximum GSR swing for normalization
  if (gsrDiff > gsrMaxSwing)
    gsrMaxSwing = (0.1 * gsrDiff) + (0.9 * gsrMaxSwing);

  float gsrScore = constrain((gsrDiff / gsrMaxSwing) * 100, 0, 100);
  
  // Calculate Physiological-to-Motion Ratio (PMR)
  // High PMR = physiological elevation without proportional motion = stress
  // Low PMR = physiological elevation with motion = exercise
  float hrChange = abs((float)currentHR - previousHR);
  float gsrChange = abs(currentGSR - previousGSR);
  
  // Normalize motion variance (add small epsilon to avoid division by zero)
  float normalizedMotion = motionVariance + 0.001;
  
  // PMR calculation: (HR change + GSR change) / motion variance
  // Higher ratio indicates stress (physiological change without motion)
  if (normalizedMotion > 0.001) {
    physiologicalToMotionRatio = (hrChange * 0.5 + gsrChange * 0.5) / normalizedMotion;
    // Cap PMR to reasonable range (0-1000)
    physiologicalToMotionRatio = constrain(physiologicalToMotionRatio, 0, 1000);
  } else {
    // Very low motion - if there's any physiological change, it's likely stress
    physiologicalToMotionRatio = (hrChange + gsrChange) * 10.0;
  }
  
  // Update previous values for next calculation
  previousHR = (float)currentHR;
  previousGSR = currentGSR;
  
  // Calculate base stress score
  static float smoothedStressData = 0;      // Data recording path (alpha=0.90)
  static float smoothedStressDisplay = 0;   // Display path (alpha=0.40, switches to 0.90 on anxiety)
  static float previousAdjustedStress = 0;   // For anxiety detection
  float rawStress;
  
  if (hrSensorActive && count >= HRV_WARMUP_COUNT)
    rawStress = (0.6 * hrvScore) + (0.4 * gsrScore);
  else
    rawStress = gsrScore;
  
  // Apply activity-dependent weighting based on PMR and activity level
  // During exercise, reduce stress score (elevated HR/HRV is expected)
  // During rest with high PMR, maintain or slightly increase stress score
  float activityWeight = 1.0;
  
  if (currentActivity == EXERCISE) {
    // During exercise, significantly reduce stress score
    // High PMR during exercise might indicate stress, but weight it lower
    if (physiologicalToMotionRatio > 50.0) {
      activityWeight = 0.4;  // Some stress component, but mostly exercise
    } else {
      activityWeight = 0.3;  // Mostly exercise response
    }
  } else if (currentActivity == ACTIVE) {
    // Moderate activity - reduce stress score proportionally
    if (physiologicalToMotionRatio > 30.0) {
      activityWeight = 0.6;  // Some stress component
    } else {
      activityWeight = 0.5;  // Mostly activity response
    }
  } else if (currentActivity == LIGHT) {
    // Light activity - slight reduction
    if (physiologicalToMotionRatio > 20.0) {
      activityWeight = 0.9;  // Mostly stress
    } else {
      activityWeight = 0.8;  // Some activity influence
    }
  } else {
    // STILL - full stress score, but boost if PMR is very high
    // High PMR while still = strong stress indicator
    if (physiologicalToMotionRatio > 15.0) {
      activityWeight = 1.1;  // Boost stress score (cap at 100)
    } else {
      activityWeight = 1.0;  // Normal stress score
    }
  }
  
  // Apply activity weight to raw stress
  float adjustedStress = rawStress * activityWeight;
  adjustedStress = constrain(adjustedStress, 0, 100);
  
  // DATA RECORDING PATH: Always use fast smoothing (alpha=0.90) for accurate data collection
  const float DATA_ALPHA = 0.90;
  smoothedStressData = (DATA_ALPHA * adjustedStress) + ((1.0 - DATA_ALPHA) * smoothedStressData);
  
  // DISPLAY PATH: Adaptive smoothing - fast during anxiety, smooth normally
  // Detect anxiety/panic: high stress + rapid increase
  float changeRate = abs(adjustedStress - smoothedStressDisplay);
  float changeAcceleration = abs(adjustedStress - previousAdjustedStress);
  previousAdjustedStress = adjustedStress;
  
  bool anxietyDetected = (adjustedStress > 60.0) && 
                         (changeRate > 10.0) && 
                         (changeAcceleration > 6.0);
  
  // Use fast smoothing during anxiety, normal smoothing otherwise
  float displayAlpha = anxietyDetected ? 0.90 : 0.40;
  smoothedStressDisplay = (displayAlpha * adjustedStress) + ((1.0 - displayAlpha) * smoothedStressDisplay);
  
  // Update global display value for UI
  stressIndexDisplay = smoothedStressDisplay;
  
  // Return data value (for recording)
  return smoothedStressData;
}

// ===========================================
// UI RENDERING
// ===========================================

/**
 * Draw main dashboard screen showing current stress level.
 * Displays stress percentage, visual bar, and BLE connection status.
 */
void drawDashboard() {
  if (deviceConnected) {
    display.fillCircle(5, 5, 3, WHITE);
  } else {
    display.drawCircle(5, 5, 3, WHITE);
  }

  display.setTextSize(1);
  display.setCursor(35, 10);
  display.print("STRESS %");

  display.setTextSize(2);
  display.setCursor(45, 22);
  display.print((int)stressIndexDisplay);

  display.setTextSize(1);
  display.drawRect(10, 50, 108, 10, WHITE);
  display.fillRect(
    10, 50,
    map((int)constrain(stressIndexDisplay, 0, 100), 0, 100, 0, 108),
    10, WHITE
  );
}

/**
 * Draw breathing exercise mode with animated circle.
 * Uses 4-7-8 breathing technique timing (4s inhale, 7s hold, 8s exhale).
 * Circle expands and contracts to guide breathing pace.
 */
void drawBreatheMode() {
  display.setTextSize(1);
  display.setCursor(40, 5);
  display.print("BREATH");

  int r = 4 + (sin(millis() / 1500.0) * 5 + 5);
  display.drawCircle(64, 32, r, WHITE);
  
  display.setTextSize(1);
  display.setCursor(30, 55);
  if (r > 9) {
    display.print("Breathe In...");
  } else {
    display.print("Breathe Out...");
  }
}

/**
 * Draw diagnostic information screen for debugging.
 * Shows raw sensor values, motion data, activity classification,
 * and system status flags. Useful for development and troubleshooting.
 */
void drawInfoScreen() {
  display.setTextSize(1);
  
  display.setCursor(0, 0);
  display.print("HRV:");
  display.print(currentHRV, 0);
  
  display.setCursor(64, 0);
  display.print("BPM:");
  if(currentBPM > 0) {
    display.print((int)currentBPM);
  } else {
    display.print("--");
  }

  display.setCursor(0, 9);
  display.print("GSR:");
  display.print(rawGSR);

  display.setCursor(64, 9);
  display.print("IR:");
  display.print(rawIR);

  display.setCursor(0, 18);
  display.print("A:");
  display.print(mpu.getAccX(), 1);
  display.setCursor(43, 18);
  display.print(mpu.getAccY(), 1);
  display.setCursor(86, 18);
  display.print(mpu.getAccZ(), 1);

  display.setCursor(0, 27);
  display.print("G:");
  display.print(mpu.getGyroX(), 0);
  display.setCursor(43, 27);
  display.print(mpu.getGyroY(), 0);
  display.setCursor(86, 27);
  display.print(mpu.getGyroZ(), 0);

  display.setCursor(0, 36);
  display.print("Act:");
  const char* actNames[] = {"STILL", "LIGHT", "ACTIV", "EXER"};
  display.print(mpuReady ? actNames[currentActivity] : "N/A");
  display.setCursor(64, 36);
  display.print("Var:");
  display.print(motionVariance, 2);

  display.setCursor(0, 45);
  display.print("Mot:");
  display.print(motionDetected ? "Y" : "N");
  display.setCursor(40, 45);
  display.print("MPU:");
  display.print(mpuReady ? "OK" : "NO");
  display.setCursor(80, 45);
  display.print("HR:");
  display.print(hrSensorActive ? "OK" : "NO");

  display.setCursor(0, 54);
  display.print("HRV Beats:");
  display.print(count);
}

// ===========================================
// BLE INITIALIZATION
// ===========================================

/**
 * Initialize Bluetooth Low Energy service and characteristics.
 * Sets up four characteristics:
 * - Live: Real-time sensor data notifications (7 bytes)
 * - Today: 24-hour hourly summaries (240 bytes, on-demand read)
 * - Week: 7-day daily summaries (70 bytes, on-demand read)
 * - Command: App control commands (write-only)
 * 
 * Pre-populates read buffers to prevent connection errors on first read.
 */
void initBLE() {
  BLEDevice::init("StressView");
  
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());
  
  BLEService* pService = pServer->createService(SERVICE_UUID);
  
  pLiveChar = pService->createCharacteristic(
    CHAR_LIVE_UUID,
    BLECharacteristic::PROPERTY_NOTIFY
  );
  pLiveChar->addDescriptor(new BLE2902());
  
  pTodayChar = pService->createCharacteristic(
    CHAR_TODAY_UUID,
    BLECharacteristic::PROPERTY_READ
  );
  pTodayChar->setCallbacks(new TodayReadCallback());
  
  // Initialize buffer with invalid flags to prevent errors on first read
  memset(bleTodayBuffer, 0, 240);
  for (int i = 0; i < HOURS_PER_DAY; i++) {
    bleTodayBuffer[i * 10] = i;
    bleTodayBuffer[i * 10 + 9] = 0x00;
  }
  pTodayChar->setValue(bleTodayBuffer, 240);
  
  pWeekChar = pService->createCharacteristic(
    CHAR_WEEK_UUID,
    BLECharacteristic::PROPERTY_READ
  );
  pWeekChar->setCallbacks(new WeekReadCallback());
  
  memset(bleWeekBuffer, 0, 70);
  for (int d = 0; d < DAYS_TO_STORE; d++) {
    bleWeekBuffer[d * 10] = d;
    bleWeekBuffer[d * 10 + 9] = 0x00;
  }
  pWeekChar->setValue(bleWeekBuffer, 70);
  
  pCommandChar = pService->createCharacteristic(
    CHAR_COMMAND_UUID,
    BLECharacteristic::PROPERTY_WRITE
  );
  pCommandChar->setCallbacks(new CommandCallbacks());
  
  pService->start();
  
  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMaxPreferred(0x12);
  BLEDevice::startAdvertising();
}

/**
 * Send live sensor data via BLE notification.
 * Packs current sensor readings into 7-byte packet format.
 * Called at 1Hz when device is connected. Format matches parser.js.
 * 
 * Packet format:
 *   [0] stress index (0-100)
 *   [1] heart rate BPM (0-255)
 *   [2-3] HRV in ms (16-bit little-endian)
 *   [4-5] GSR raw value (16-bit little-endian)
 *   [6] status byte (bit flags for sensor states)
 */
void updateBLEData() {
  if (!deviceConnected) return;
  
  uint8_t buffer[7];
  buffer[0] = (uint8_t)constrain(stressIndex, 0, 100);
  buffer[1] = currentHR;
  buffer[2] = (uint8_t)((uint16_t)currentHRV & 0xFF);
  buffer[3] = (uint8_t)(((uint16_t)currentHRV >> 8) & 0xFF);
  buffer[4] = (uint8_t)((uint16_t)currentGSR & 0xFF);
  buffer[5] = (uint8_t)(((uint16_t)currentGSR >> 8) & 0xFF);
  buffer[6] = (hrSensorActive ? 0x01 : 0x00) |
              (calibrationComplete ? 0x02 : 0x00) |
              (motionDetected ? 0x04 : 0x00) |
              ((currentActivity & 0x03) << 3) |
              (mpuReady ? 0x80 : 0x00);
  
  pLiveChar->setValue(buffer, 7);
  pLiveChar->notify();
}

/**
 * Pack today's 24 hourly summaries into BLE buffer.
 * Each hour uses 10 bytes: hour, stress stats, HR/HRV, GSR, activity.
 * Called on-demand when app reads the Today characteristic.
 * 
 * @param buffer Output buffer (must be 240 bytes)
 */
void packTodayData(uint8_t* buffer) {
  for (int i = 0; i < HOURS_PER_DAY; i++) {
    int offset = i * 10;
    buffer[offset + 0] = todayData[i].hour;
    buffer[offset + 1] = todayData[i].avgStress;
    buffer[offset + 2] = todayData[i].peakStress;
    buffer[offset + 3] = todayData[i].highStressMins;
    buffer[offset + 4] = todayData[i].avgHR;
    buffer[offset + 5] = (uint8_t)(todayData[i].avgHRV & 0xFF);
    buffer[offset + 6] = (uint8_t)((todayData[i].avgHRV >> 8) & 0xFF);
    buffer[offset + 7] = (uint8_t)(todayData[i].avgGSR & 0xFF);
    buffer[offset + 8] = (uint8_t)((todayData[i].avgGSR >> 8) & 0xFF);
    buffer[offset + 9] = ((todayData[i].sampleCount > 0) ? 0x01 : 0x00) |
                         ((todayData[i].avgActivityLevel & 0x03) << 1);
  }
}

/**
 * Pack 7-day weekly summaries into BLE buffer.
 * Aggregates hourly data from each day into daily averages and peaks.
 * Each day uses 10 bytes. Called on-demand when app reads Week characteristic.
 * 
 * @param buffer Output buffer (must be 70 bytes)
 */
void packWeekData(uint8_t* buffer) {
  for (int d = 0; d < DAYS_TO_STORE; d++) {
    int offset = d * 10;
    
    String key = "day" + String(d);
    HourlySummary dayData[HOURS_PER_DAY];
    size_t len = preferences.getBytesLength(key.c_str());
    
    uint32_t stressSum = 0, hrSum = 0, hrvSum = 0;
    uint8_t peakStress = 0, peakHour = 0, highMins = 0;
    int validHours = 0;
    
    if (len == sizeof(dayData)) {
      preferences.getBytes(key.c_str(), dayData, sizeof(dayData));
      
      // Aggregate all valid hours into daily statistics
      for (int h = 0; h < HOURS_PER_DAY; h++) {
        if (dayData[h].sampleCount > 0) {
          stressSum += dayData[h].avgStress;
          hrSum += dayData[h].avgHR;
          hrvSum += dayData[h].avgHRV;
          highMins += dayData[h].highStressMins;
          validHours++;
          
          if (dayData[h].peakStress > peakStress) {
            peakStress = dayData[h].peakStress;
            peakHour = h;
          }
        }
      }
    }
    
    buffer[offset + 0] = d;
    buffer[offset + 1] = validHours > 0 ? (stressSum / validHours) : 0;
    buffer[offset + 2] = peakStress;
    buffer[offset + 3] = peakHour;
    buffer[offset + 4] = highMins;
    buffer[offset + 5] = validHours > 0 ? (hrSum / validHours) : 0;
    buffer[offset + 6] = validHours > 0 ? ((hrvSum / validHours) & 0xFF) : 0;
    buffer[offset + 7] = validHours > 0 ? (((hrvSum / validHours) >> 8) & 0xFF) : 0;
    buffer[offset + 8] = 0;
    buffer[offset + 9] = validHours > 0 ? 0x01 : 0x00;
  }
}

// ===========================================
// MOTION SENSING (MPU6050)
// ===========================================

/**
 * Initialize MPU6050 motion sensor with calibration.
 * Tries alternate I2C address (0x69) first, falls back to default (0x68).
 * Performs gyroscope calibration which requires device to be stationary.
 * Initializes motion buffer to 1g (resting gravitational acceleration).
 */
void initMPU() {
  mpu.setAddress(0x69);
  
  byte status = mpu.begin();
  
  if (status != 0) {
    mpu.setAddress(0x68);
    status = mpu.begin();
  }
  
  if (status != 0) {
    mpuReady = false;
    return;
  }
  
  display.clearDisplay();
  display.setCursor(20, 25);
  display.print("Calibrating IMU...");
  display.display();
  
  mpu.calcOffsets();
  
  for (int i = 0; i < MOTION_BUFFER_SIZE; i++) {
    motionBuffer[i] = 1.0;
  }
  
  mpuReady = true;
}

/**
 * Update motion detection from MPU6050 accelerometer.
 * Calculates acceleration magnitude and variance over 1-second rolling window.
 * Variance indicates activity level - higher variance = more movement.
 * Updates at 50Hz (every 20ms) for responsive detection.
 */
void updateMotion() {
  unsigned long currentMillis = millis();
  
  if (currentMillis - lastMotionUpdate < 20) return;
  lastMotionUpdate = currentMillis;
  
  mpu.update();
  
  // Calculate total acceleration magnitude (3D vector length)
  float ax = mpu.getAccX();
  float ay = mpu.getAccY();
  float az = mpu.getAccZ();
  float accelMag = sqrt(ax*ax + ay*ay + az*az);
  
  motionBuffer[motionBufferIndex] = accelMag;
  motionBufferIndex = (motionBufferIndex + 1) % MOTION_BUFFER_SIZE;
  
  // Calculate variance over 1-second window (50 samples at 50Hz)
  // Variance = E[X²] - (E[X])²
  float sum = 0, sumSq = 0;
  for (int i = 0; i < MOTION_BUFFER_SIZE; i++) {
    sum += motionBuffer[i];
    sumSq += motionBuffer[i] * motionBuffer[i];
  }
  float mean = sum / MOTION_BUFFER_SIZE;
  motionVariance = (sumSq / MOTION_BUFFER_SIZE) - (mean * mean);
  
  // Binary motion flag (used to indicate HR reading reliability)
  // Threshold 0.02 tuned for wrist-worn device placement
  motionDetected = (motionVariance > 0.02);
}

/**
 * Classify activity level from motion variance.
 * Four-level system based on acceleration variance thresholds.
 * Thresholds empirically tuned for wrist-worn device placement.
 * Used to contextualize stress readings (exercise vs rest).
 */
void updateActivityLevel() {
  if (motionVariance < 0.005) {
    currentActivity = STILL;
  } else if (motionVariance < 0.03) {
    currentActivity = LIGHT;
  } else if (motionVariance < 0.15) {
    currentActivity = ACTIVE;
  } else {
    currentActivity = EXERCISE;
  }
}

// ===========================================
// TIME MANAGEMENT
// ===========================================

/**
 * Get current time from BLE-synced timestamp + millis() offset.
 * Handles millis() rollover (occurs every ~49.7 days on ESP32).
 * Returns zeros if time has never been synced via BLE.
 * 
 * @param hour Output hour (0-23)
 * @param minute Output minute (0-59)
 * @param second Output second (0-59)
 */
void getCurrentTime(uint8_t &hour, uint8_t &minute, uint8_t &second) {
  if (!syncedTime.isValid) {
    hour = 0;
    minute = 0;
    second = 0;
    return;
  }
  
  unsigned long currentMillis = millis();
  unsigned long elapsedMillis;
  
  // Handle millis() rollover (unsigned subtraction handles it correctly)
  if (currentMillis >= syncedTime.millisAtSync) {
    elapsedMillis = currentMillis - syncedTime.millisAtSync;
  } else {
    elapsedMillis = (0xFFFFFFFF - syncedTime.millisAtSync) + currentMillis + 1;
  }
  
  unsigned long elapsedSeconds = elapsedMillis / 1000;
  
  unsigned long totalSeconds = syncedTime.second + elapsedSeconds;
  second = totalSeconds % 60;
  
  unsigned long totalMinutes = syncedTime.minute + (totalSeconds / 60);
  minute = totalMinutes % 60;
  
  unsigned long totalHours = syncedTime.hour + (totalMinutes / 60);
  hour = totalHours % 24;
}

// ===========================================
// POWER MANAGEMENT
// ===========================================

/**
 * Enter power-off mode - turns off all peripherals to save battery.
 * User can wake by holding button for 5 seconds again.
 */
void enterPowerOff() {
  // Visual feedback - show "POWERING OFF" message
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(20, 25);
  display.print("POWERING OFF...");
  display.display();
  delay(1000);
  
  // Turn off MAX30102 (biggest power consumer)
  if (hrSensorActive) {
    particleSensor.shutDown();
  }
  
  // Turn off display
  display.clearDisplay();
  display.display();
  display.ssd1306_command(SSD1306_DISPLAYOFF);
  
  // Turn off vibration motor
  analogWrite(VIBRO_MOTOR_PIN, 0);
  
  // Stop BLE advertising to save power
  if (deviceConnected) {
    pServer->disconnect(pServer->getConnId());
  }
  BLEDevice::stopAdvertising();
  
  // Save current hour data before shutting down
  if (currentHour >= 0) {
    saveHourlyData(currentHour);
  }
  
  devicePoweredOff = true;
  
  // Haptic feedback - 3 short pulses at 25% strength
  for (int i = 0; i < 3; i++) {
    analogWrite(VIBRO_MOTOR_PIN, 64);  // 25% strength
    delay(100);
    analogWrite(VIBRO_MOTOR_PIN, 0);
    delay(100);
  }
}

/**
 * Wake from power-off mode - restarts all peripherals.
 */
void wakeFromPowerOff() {
  devicePoweredOff = false;
  
  // Turn on display
  display.ssd1306_command(SSD1306_DISPLAYON);
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(25, 25);
  display.print("WAKING UP...");
  display.display();
  
  // Restart MAX30102
  if (hrSensorActive) {
    particleSensor.wakeUp();
    delay(100);
    
    // Reset heart rate detection variables
    memset(irBuffer, 0, sizeof(irBuffer));
    irBufferIndex = 0;
    maxValue = 0;
    minValue = 100000;
    
    memset(peakTimes, 0, sizeof(peakTimes));
    peakIndex = 0;
    peakCount = 0;
    currentBPM = 0;
    lastPeakTime = 0;
    lastValue = 0;
    peakThreshold = 0;
    peakDetected = false;
    
    runningAvg = 0;
    sampleCount = 0;
    
    lastBeatTime = 0;
    currentHR = 0;
  }
  
  // Restart BLE advertising
  BLEDevice::startAdvertising();
  
  // Haptic feedback - 2 short pulses at 25% strength
  for (int i = 0; i < 2; i++) {
    analogWrite(VIBRO_MOTOR_PIN, 64);  // 25% strength
    delay(100);
    analogWrite(VIBRO_MOTOR_PIN, 0);
    delay(100);
  }
  
  delay(500);
}