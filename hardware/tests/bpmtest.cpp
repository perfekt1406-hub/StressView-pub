#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "MAX30105.h"

// OLED display settings
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// MAX30102 sensor
MAX30105 particleSensor;

// Graph settings
#define GRAPH_HEIGHT 40
#define GRAPH_Y_OFFSET 24
#define BUFFER_SIZE SCREEN_WIDTH

// Data buffer for the graph
long irBuffer[BUFFER_SIZE];
int bufferIndex = 0;
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

void setup() {
  Serial.begin(115200);
  Serial.println("MAX30102 Heart Rate Monitor");
  
  // Initialize I2C with custom pins
  Wire.begin(6, 7); // SDA = GPIO6, SCL = GPIO7
  
  // Initialize OLED display
  if(!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("SSD1306 allocation failed");
    for(;;);
  }
  
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("Initializing...");
  display.display();
  
  // Initialize MAX30102 sensor
  if (!particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("MAX30102 not found!");
    display.clearDisplay();
    display.setCursor(0, 0);
    display.println("Sensor Error!");
    display.display();
    while (1);
  }
  
  // Configure sensor
  particleSensor.setup();
  particleSensor.setPulseAmplitudeRed(0x0A);
  particleSensor.setPulseAmplitudeGreen(0);
  
  // Initialize buffers
  for(int i = 0; i < BUFFER_SIZE; i++) {
    irBuffer[i] = 0;
  }
  for(int i = 0; i < PEAK_BUFFER_SIZE; i++) {
    peakTimes[i] = 0;
  }
  
  Serial.println("Setup complete!");
  delay(1000);
}

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

void loop() {
  // Read IR value from sensor
  long irValue = particleSensor.getIR();
  
  // Output raw IR data to Serial Monitor
  Serial.print(irValue);
  Serial.print(",");
  Serial.println(currentBPM);
  
  // Store value in buffer
  irBuffer[bufferIndex] = irValue;
  bufferIndex = (bufferIndex + 1) % BUFFER_SIZE;
  
  // Calculate min and max values in current buffer
  maxValue = irBuffer[0];
  minValue = irBuffer[0];
  
  for(int i = 0; i < BUFFER_SIZE; i++) {
    if(irBuffer[i] > maxValue) maxValue = irBuffer[i];
    if(irBuffer[i] < minValue && irBuffer[i] > 0) minValue = irBuffer[i];
  }
  
  // Prevent division by zero
  if(maxValue == minValue) {
    maxValue = minValue + 1;
  }
  
  // Detect peaks and calculate BPM
  detectPeakAndCalculateBPM(irValue);
  
  // Draw on OLED
  display.clearDisplay();
  
  // Display BPM prominently at top
  display.setTextSize(2);
  display.setCursor(0, 0);
  display.print("BPM:");
  if(currentBPM > 0) {
    display.print((int)currentBPM);
  } else {
    display.print("--");
  }
  
  // Display current IR value
  display.setTextSize(1);
  display.setCursor(0, 16);
  display.print("IR:");
  display.print(irValue);
  
  // Draw the heartbeat graph
  for(int x = 0; x < SCREEN_WIDTH - 1; x++) {
    int currentIndex = (bufferIndex + x) % BUFFER_SIZE;
    int nextIndex = (bufferIndex + x + 1) % BUFFER_SIZE;
    
    // Scale values to fit graph height
    int y1 = map(irBuffer[currentIndex], minValue, maxValue, 
                 GRAPH_Y_OFFSET + GRAPH_HEIGHT - 1, GRAPH_Y_OFFSET);
    int y2 = map(irBuffer[nextIndex], minValue, maxValue, 
                 GRAPH_Y_OFFSET + GRAPH_HEIGHT - 1, GRAPH_Y_OFFSET);
    
    // Constrain to prevent overflow
    y1 = constrain(y1, GRAPH_Y_OFFSET, GRAPH_Y_OFFSET + GRAPH_HEIGHT - 1);
    y2 = constrain(y2, GRAPH_Y_OFFSET, GRAPH_Y_OFFSET + GRAPH_HEIGHT - 1);
    
    // Draw line between points
    display.drawLine(x, y1, x + 1, y2, SSD1306_WHITE);
  }
  
  // Draw graph border
  display.drawRect(0, GRAPH_Y_OFFSET, SCREEN_WIDTH, GRAPH_HEIGHT, SSD1306_WHITE);
  
  display.display();
  
  delay(20); // Adjust for desired refresh rate (~50 samples/sec)
}