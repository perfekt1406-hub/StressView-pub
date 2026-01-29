// ===========================================
// StressView BLE Connection Test (Fake Data)
// ===========================================
// This sketch tests the Bluetooth interface between the watch and the app
// without requiring real sensors. It generates fake data to validate:
// - BLE connection/disconnection
// - Live data notifications
// - Today/Week history reads
// - Command handling (sync/refresh)

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ===========================================
// BLE Configuration (must match DeviceCode.cpp & bluetooth.js)
// ===========================================
#define SERVICE_UUID        "0000ff00-0000-1000-8000-00805f9b34fb"
#define CHAR_LIVE_UUID      "0000ff01-0000-1000-8000-00805f9b34fb"
#define CHAR_TODAY_UUID     "0000ff02-0000-1000-8000-00805f9b34fb"
#define CHAR_WEEK_UUID      "0000ff03-0000-1000-8000-00805f9b34fb"
#define CHAR_COMMAND_UUID   "0000ff04-0000-1000-8000-00805f9b34fb"

// BLE objects
BLEServer* pServer = nullptr;
BLECharacteristic* pLiveChar = nullptr;
BLECharacteristic* pTodayChar = nullptr;
BLECharacteristic* pWeekChar = nullptr;
BLECharacteristic* pCommandChar = nullptr;

// Connection state
bool deviceConnected = false;
bool oldDeviceConnected = false;

// Timing
unsigned long lastNotify = 0;
const unsigned long NOTIFY_INTERVAL = 1000; // 1 second

// Fake data state (cycles to test different UI states)
uint8_t fakeStress = 45;
uint8_t fakeHR = 72;
uint16_t fakeHRV = 55;
uint16_t fakeGSR = 2048;
uint8_t fakeActivityLevel = 0; // 0=STILL, 1=LIGHT, 2=ACTIVE, 3=EXERCISE
bool fakeHrActive = true;
bool fakeCalibrated = true;
bool fakeMotionDetected = false;
bool fakeMpuReady = true;

// Data buffers (global to avoid stack issues)
uint8_t liveBuffer[7];
uint8_t todayBuffer[240];  // 24 hours × 10 bytes
uint8_t weekBuffer[70];    // 7 days × 10 bytes

// Flag to regenerate history on next read
bool historyDirty = true;

// ===========================================
// Fake Data Generators
// ===========================================

void generateFakeLiveData() {
  // Vary stress in a wave pattern (30-80)
  static int stressDirection = 1;
  fakeStress += stressDirection * 2;
  if (fakeStress >= 80) stressDirection = -1;
  if (fakeStress <= 30) stressDirection = 1;

  // Vary HR slightly (65-85)
  fakeHR = (uint8_t)(72 + random(-7, 8));

  // Vary HRV (40-70)
  fakeHRV = (uint16_t)(50 + random(-10, 21));

  // Vary GSR slightly
  fakeGSR = (uint16_t)(2048 + random(-100, 101));

  // Cycle activity level every 10 seconds
  static unsigned long lastActivityChange = 0;
  if (millis() - lastActivityChange > 10000) {
    fakeActivityLevel = (fakeActivityLevel + 1) % 4;
    lastActivityChange = millis();
    Serial.print("Activity level changed to: ");
    const char* actNames[] = {"STILL", "LIGHT", "ACTIVE", "EXERCISE"};
    Serial.println(actNames[fakeActivityLevel]);
  }

  // Toggle motion detected based on activity
  fakeMotionDetected = (fakeActivityLevel >= 2);
}

void packLiveData() {
  // Pack live data into 7-byte buffer matching DeviceCode.cpp format
  // [0] stress (0-100)
  // [1] hr (0-255)
  // [2] hrv low byte
  // [3] hrv high byte
  // [4] gsr low byte
  // [5] gsr high byte
  // [6] status bits:
  //     Bit 0: hrActive
  //     Bit 1: calibrated
  //     Bit 2: motionDetected
  //     Bit 3-4: activityLevel (0-3)
  //     Bit 5-6: reserved
  //     Bit 7: mpuReady

  liveBuffer[0] = fakeStress;
  liveBuffer[1] = fakeHR;
  liveBuffer[2] = (uint8_t)(fakeHRV & 0xFF);
  liveBuffer[3] = (uint8_t)((fakeHRV >> 8) & 0xFF);
  liveBuffer[4] = (uint8_t)(fakeGSR & 0xFF);
  liveBuffer[5] = (uint8_t)((fakeGSR >> 8) & 0xFF);
  liveBuffer[6] = (fakeHrActive ? 0x01 : 0x00) |
                  (fakeCalibrated ? 0x02 : 0x00) |
                  (fakeMotionDetected ? 0x04 : 0x00) |
                  ((fakeActivityLevel & 0x03) << 3) |
                  (fakeMpuReady ? 0x80 : 0x00);
}

void generateFakeTodayData() {
  // Generate 24 hourly records with realistic patterns
  // Higher stress mid-day, lower in morning/evening
  
  for (int h = 0; h < 24; h++) {
    int offset = h * 10;
    
    // Stress pattern: low morning, peak afternoon, low evening
    uint8_t baseStress;
    if (h < 6) baseStress = (uint8_t)(25 + random(0, 10));       // Night/early morning
    else if (h < 9) baseStress = (uint8_t)(35 + random(0, 15));  // Morning
    else if (h < 12) baseStress = (uint8_t)(50 + random(0, 15)); // Late morning
    else if (h < 15) baseStress = (uint8_t)(55 + random(0, 20)); // Afternoon peak
    else if (h < 18) baseStress = (uint8_t)(45 + random(0, 15)); // Late afternoon
    else if (h < 21) baseStress = (uint8_t)(35 + random(0, 10)); // Evening
    else baseStress = (uint8_t)(30 + random(0, 10));             // Night
    
    long peakVal = baseStress + random(10, 25);
    uint8_t peakStress = (uint8_t)(peakVal > 100 ? 100 : peakVal);
    uint8_t highMins = (uint8_t)((baseStress > 60) ? random(5, 20) : random(0, 5));
    uint8_t avgHR = (uint8_t)(65 + random(0, 20));
    uint16_t avgHRV = (uint16_t)(45 + random(0, 30));
    uint16_t avgGSR = (uint16_t)(1800 + random(0, 500));
    uint8_t activity = (uint8_t)((h >= 7 && h <= 20) ? random(0, 3) : 0);
    bool valid = true; // All hours valid for testing
    
    todayBuffer[offset + 0] = (uint8_t)h;                  // hour
    todayBuffer[offset + 1] = baseStress;                  // avgStress
    todayBuffer[offset + 2] = peakStress;                  // peakStress
    todayBuffer[offset + 3] = highMins;                    // highStressMins
    todayBuffer[offset + 4] = avgHR;                       // avgHR
    todayBuffer[offset + 5] = (uint8_t)(avgHRV & 0xFF);    // avgHRV low
    todayBuffer[offset + 6] = (uint8_t)((avgHRV >> 8) & 0xFF); // avgHRV high
    todayBuffer[offset + 7] = (uint8_t)(avgGSR & 0xFF);    // avgGSR low
    todayBuffer[offset + 8] = (uint8_t)((avgGSR >> 8) & 0xFF); // avgGSR high
    todayBuffer[offset + 9] = (uint8_t)((valid ? 0x01 : 0x00) | ((activity & 0x03) << 1)); // flags
  }
  
  Serial.println("Generated fake today data (24 hours)");
}

void generateFakeWeekData() {
  // Generate 7 daily summaries
  
  for (int d = 0; d < 7; d++) {
    int offset = d * 10;
    
    // Vary stress by day (weekends lower)
    uint8_t avgStress = (uint8_t)((d == 0 || d == 6) ? 35 + random(0, 10) : 45 + random(0, 15));
    long peakVal = avgStress + random(20, 35);
    uint8_t peakStress = (uint8_t)(peakVal > 100 ? 100 : peakVal);
    uint8_t peakHour = (uint8_t)(12 + random(0, 6)); // Peak usually afternoon
    uint8_t highMins = (uint8_t)(avgStress > 50 ? random(30, 90) : random(10, 40));
    uint8_t avgHR = (uint8_t)(68 + random(0, 12));
    uint16_t avgHRV = (uint16_t)(50 + random(0, 25));
    bool valid = true; // All days valid for testing
    
    weekBuffer[offset + 0] = (uint8_t)d;                   // day index
    weekBuffer[offset + 1] = avgStress;                    // avgStress
    weekBuffer[offset + 2] = peakStress;                   // peakStress
    weekBuffer[offset + 3] = peakHour;                     // peakHour
    weekBuffer[offset + 4] = highMins;                     // highStressMins
    weekBuffer[offset + 5] = avgHR;                        // avgHR
    weekBuffer[offset + 6] = (uint8_t)(avgHRV & 0xFF);     // avgHRV low
    weekBuffer[offset + 7] = (uint8_t)((avgHRV >> 8) & 0xFF); // avgHRV high
    weekBuffer[offset + 8] = 0;                            // reserved
    weekBuffer[offset + 9] = (uint8_t)(valid ? 0x01 : 0x00); // valid flag
  }
  
  Serial.println("Generated fake week data (7 days)");
}

// ===========================================
// BLE Callbacks
// ===========================================

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    Serial.println(">>> Device CONNECTED <<<");
  }
  
  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
    Serial.println(">>> Device DISCONNECTED <<<");
  }
};

class TodayReadCallback : public BLECharacteristicCallbacks {
  void onRead(BLECharacteristic* pCharacteristic) override {
    Serial.println("App reading TODAY data...");
    // Note: In ESP32 BLE, we need to set value BEFORE the read completes
    // The callback fires when read is requested, so we set the value here
    if (historyDirty) {
      generateFakeTodayData();
    }
    pCharacteristic->setValue(todayBuffer, 240);
    Serial.println("Sent 240 bytes (24 hourly records)");
  }
};

class WeekReadCallback : public BLECharacteristicCallbacks {
  void onRead(BLECharacteristic* pCharacteristic) override {
    Serial.println("App reading WEEK data...");
    if (historyDirty) {
      generateFakeWeekData();
      historyDirty = false;
    }
    pCharacteristic->setValue(weekBuffer, 70);
    Serial.println("Sent 70 bytes (7 daily records)");
  }
};

class CommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    String value = pCharacteristic->getValue();
    if (value.length() > 0) {
      uint8_t command = (uint8_t)value[0];
      
      Serial.print("Received command: 0x");
      Serial.println(command, HEX);
      
      if (command == 0x01) {
        // Sync acknowledgment
        Serial.println("  -> SYNC ACK received from app");
      } else if (command == 0x02) {
        // Refresh request - regenerate data on next read
        Serial.println("  -> REFRESH requested - marking history dirty");
        historyDirty = true;
      } else {
        Serial.print("  -> Unknown command: ");
        Serial.println(command);
      }
    }
  }
};

// ===========================================
// BLE Initialization
// ===========================================

void initBLE() {
  Serial.println("Initializing BLE...");
  
  BLEDevice::init("StressView");
  
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());
  
  BLEService* pService = pServer->createService(SERVICE_UUID);
  
  // Live data characteristic - Notify
  pLiveChar = pService->createCharacteristic(
    CHAR_LIVE_UUID,
    BLECharacteristic::PROPERTY_NOTIFY
  );
  pLiveChar->addDescriptor(new BLE2902());
  Serial.println("  Created LIVE characteristic (NOTIFY)");
  
  // Today hourly characteristic - Read
  pTodayChar = pService->createCharacteristic(
    CHAR_TODAY_UUID,
    BLECharacteristic::PROPERTY_READ
  );
  pTodayChar->setCallbacks(new TodayReadCallback());
  // Pre-set initial value so there's always data available
  pTodayChar->setValue(todayBuffer, 240);
  Serial.println("  Created TODAY characteristic (READ) - pre-loaded 240 bytes");
  
  // Week daily characteristic - Read
  pWeekChar = pService->createCharacteristic(
    CHAR_WEEK_UUID,
    BLECharacteristic::PROPERTY_READ
  );
  pWeekChar->setCallbacks(new WeekReadCallback());
  // Pre-set initial value so there's always data available
  pWeekChar->setValue(weekBuffer, 70);
  Serial.println("  Created WEEK characteristic (READ) - pre-loaded 70 bytes");
  
  // Command characteristic - Write
  pCommandChar = pService->createCharacteristic(
    CHAR_COMMAND_UUID,
    BLECharacteristic::PROPERTY_WRITE
  );
  pCommandChar->setCallbacks(new CommandCallbacks());
  Serial.println("  Created COMMAND characteristic (WRITE)");
  
  pService->start();
  
  // Start advertising
  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMaxPreferred(0x12);
  BLEDevice::startAdvertising();
  
  Serial.println("BLE initialized - advertising as 'StressView'");
  Serial.println("Waiting for connection...");
}

// ===========================================
// Setup
// ===========================================

void setup() {
  Serial.begin(115200);
  delay(500);
  
  Serial.println();
  Serial.println("=========================================");
  Serial.println("  StressView BLE Connection Test");
  Serial.println("  (Fake Data Mode)");
  Serial.println("=========================================");
  Serial.println();
  
  // Seed random number generator
  randomSeed(analogRead(0));
  
  // Pre-generate initial history data
  generateFakeTodayData();
  generateFakeWeekData();
  historyDirty = false;
  
  // Initialize BLE
  initBLE();
  
  Serial.println();
  Serial.println("Test Instructions:");
  Serial.println("1. Open the StressView web app in Chrome");
  Serial.println("2. Go to Settings and click 'Connect Device'");
  Serial.println("3. Select 'StressView' from the Bluetooth list");
  Serial.println("4. Verify live data updates on Home page");
  Serial.println("5. Check Today/Trends pages for history data");
  Serial.println("6. Watch this serial output for events");
  Serial.println();
}

// ===========================================
// Main Loop
// ===========================================

void loop() {
  // Handle connection state changes
  if (deviceConnected && !oldDeviceConnected) {
    // Just connected
    oldDeviceConnected = true;
    Serial.println("Connection established - starting notifications");
  }
  
  if (!deviceConnected && oldDeviceConnected) {
    // Just disconnected - restart advertising
    delay(500);
    pServer->startAdvertising();
    Serial.println("Restarted advertising after disconnect");
    oldDeviceConnected = false;
  }
  
  // Send live data notifications when connected
  if (deviceConnected) {
    unsigned long now = millis();
    
    if (now - lastNotify >= NOTIFY_INTERVAL) {
      lastNotify = now;
      
      // Generate and pack new fake data
      generateFakeLiveData();
      packLiveData();
      
      // Send notification
      pLiveChar->setValue(liveBuffer, 7);
      pLiveChar->notify();
      
      // Log to serial
      Serial.print("NOTIFY: stress=");
      Serial.print(fakeStress);
      Serial.print(" hr=");
      Serial.print(fakeHR);
      Serial.print(" hrv=");
      Serial.print(fakeHRV);
      Serial.print(" gsr=");
      Serial.print(fakeGSR);
      Serial.print(" activity=");
      Serial.print(fakeActivityLevel);
      Serial.print(" motion=");
      Serial.println(fakeMotionDetected ? "Y" : "N");
    }
  }
  
  delay(10); // Small delay to prevent watchdog issues
}
