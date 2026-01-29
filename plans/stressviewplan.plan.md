# StressView Implementation Plan

## Current Status

| Phase | Status | Details |

|-------|--------|---------|

| Phase 1: ESP32 BLE | ✅ Complete | BLE server + sensors in [DeviceCode.cpp](../DeviceCode.cpp) - Pulse Sensor Amped, GSR, MPU6050 |

| Phase 2: Web Setup | ✅ Complete | Vite + Tailwind v4 + ApexCharts in [package.json](stressview-web/package.json) |

| Phase 3: Router/Nav | ✅ Complete | Hash router in [router.js](stressview-web/src/router.js), nav in [nav.js](stressview-web/src/components/nav.js) |

| Phase 4: Bluetooth | ⚠️ Verification | `bluetooth.js` + `parser.js` implemented; needs ESP32 run-through |

| Phase 5: Storage | ✅ Complete | IndexedDB wrapper (`storage.js`) powering seed data + history sync |

| Phase 6: Pages | ✅ Complete | All SPA pages implemented; Settings wired to BLE/state |

| Phase 7: Charts | ✅ Complete | `chart-line`, `chart-bar`, breathing circle power Today/Trends/Breathe |

| Phase 8: Polish | ✅ Complete | Loading screen fixes, icon config, ES module config, debug cleanup done |

### Page Status

| Page | File | Status |

|------|------|--------|

| Home | `src/pages/home.js` | ✅ Complete |

| Breathe | `src/pages/breathe.js` | ✅ Complete (guided programs + breathing circle) |

| Today | `src/pages/today.js` | ✅ Complete (line chart + annotations) |

| Trends | `src/pages/trends.js` | ✅ Complete (weekly stats + insights) |

| Learn | `src/pages/learn.js` | ✅ Complete (articles + accordion UI) |

| Settings | `src/pages/settings.js` | ✅ Complete (connect/disconnect, sync, clear data, seed mock data) |

### Lib Modules

| File | Status |

|------|--------|

| `src/lib/state.js` | ✅ Complete |

| `src/lib/bluetooth.js` | ✅ Complete (connect, subscribe, history, commands) w/ debug instrumentation |

| `src/lib/parser.js` | ✅ Complete (live/hourly/daily decoders) w/ error handling |

| `src/lib/storage.js` | ✅ Complete (IndexedDB stores + seeding helpers) |

### Content

| File | Status |

|------|--------|

| `src/content/articles.js` | ✅ Complete |

**Current position: Awaiting Pulse Sensor Amped delivery for final hardware verification**

---

## Architecture Overview

```
┌─────────────────────────────────────┐
│      ESP32-C3 Device                │
│  ┌─────────────────────────┐        │
│  │ Sensors:                │        │
│  │ • Pulse Sensor (Analog) │        │
│  │ • GSR Sensor (Analog)   │        │
│  │ • MPU6050 Accel (I2C)   │        │
│  └──────┬──────────────────┘        │
│         │                           │
│  ┌──────▼──────────┐                │
│  │ BLE GATT Server │                │
│  └──────┬──────────┘                │
│         │                           │
│  ┌──────▼──────┐                    │
│  │ Flash       │                    │
│  │ Storage     │                    │
│  └─────────────┘                    │
└───────────┬─────────────────────────┘
            │ LiveData, History
            │ (BLE)
┌───────────▼─────────────────────────┐
│      Web App - Browser              │
│  ┌──────────────────────┐           │
│  │ Web Bluetooth API    │           │
│  └──────────┬───────────┘           │
│             │                       │
│  ┌──────────▼───────────┐           │
│  │ App State            │◄────────┐ │
│  └──────────┬───────────┘         │ │
│             │                     │ │
│  ┌──────────▼───────────┐         │ │
│  │ SPA Router           │         │ │
│  └──────────┬───────────┘         │ │
│             │                     │ │
│  ┌──────────▼───────────┐         │ │
│  │ Pages:               │         │ │
│  │ • Home               │         │ │
│  │ • Breathe            │         │ │
│  │ • Today              │         │ │
│  │ • Trends             │         │ │
│  │ • Learn              │         │ │
│  └──────────────────────┘         │ │
│                                    │ │
│  ┌──────────────────────┐         │ │
│  │ IndexedDB            │─────────┘ │
│  └──────────────────────┘           │
└─────────────────────────────────────┘
```

## Data Flow

```
User          WebApp         Web Bluetooth    ESP32
 │              │                 │            │
 │─Open app────>│                 │            │
 │              │                 │            │
 │─Click Connect>│                 │            │
 │              │─requestDevice()─>│            │
 │              │                 │─Connect───>│
 │              │                 │<─Connected─│
 │              │                 │            │
 │              │                 │            │
 │              │                 │            │
 │              │  ┌─────────────────────────┐ │
 │              │  │ Every 1 second (loop)   │ │
 │              │  │                         │ │
 │              │  │  <─LiveData notification│
 │              │  │─Parse binary data──────>│
 │              │  │─Update UI───────────────>│
 │              │  │─Store in IndexedDB──────>│
 │              │  │                         │ │
 │              │  └─────────────────────────┘ │
 │              │                 │            │
 │─View Trends─>│                 │            │
 │              │─Read WeekDaily──>│            │
 │              │                 │─Read──────>│
 │              │                 │<─70 bytes─│
 │              │<─Parse & display─│            │
 │              │                 │            │
```

---

## Phase 1: ESP32 BLE Server ✅

BLE GATT server implemented in [DeviceCode.cpp](../DeviceCode.cpp).

### Sensors

| Sensor | Type | Purpose | Interface |
|--------|------|---------|-----------|
| **Pulse Sensor Amped** | Optical PPG | Heart rate & HRV detection | Analog (GPIO4) |
| **GSR Sensor** | Galvanic Skin Response | Sweat/stress measurement | Analog (GPIO2) |
| **MPU6050** | 6-axis IMU | Motion & activity detection | I2C (0x69) |
| **SSD1306 OLED** | 128x64 Display | User interface | I2C (0x3C) |

### Device Features

- **3 Display Modes:** Dashboard, Breathe, Info (cycle with button)
- **Heart Rate Detection:** Adaptive threshold algorithm at 500Hz sampling
- **HRV Calculation:** RMSSD from inter-beat intervals
- **Stress Index:** Combined HRV + GSR analysis (0-100 scale)
- **Activity Detection:** Still, Light, Active, Exercise levels from accelerometer
- **Vibration Alert:** Triggers when stress > 80%
- **Data Storage:** Hourly summaries stored in flash (7 days)
- **BLE Sync:** Real-time notifications + historical data transfer

### Hardware Wiring (XIAO ESP32-C3)

#### XIAO ESP32-C3 Pinout

**Left Side Pins (top to bottom):**
- **GPIO2 (A0)** - Analog Input 0 / Digital I/O
- **GPIO3 (A1)** - Analog Input 1 / Digital I/O
- **GPIO4 (A2)** - Analog Input 2 / Digital I/O
- **GPIO5 (A3)** - Analog Input 3 / Digital I/O (⚠️ may have limitations)
- **GPIO6 (SDA, D4)** - I2C Data / Digital Pin 4
- **GPIO7 (SCL, D5)** - I2C Clock / Digital Pin 5
- **GPIO21 (TX, D6)** - UART Transmit / Digital Pin 6

**Right Side Pins (top to bottom):**
- **5V** - Power supply output (5 Volts)
- **GND** - Ground connection
- **3V3** - Power supply output (3.3 Volts)
- **GPIO10 (D10, MOSI)** - Digital Pin 10 / SPI MOSI
- **GPIO9 (D9, MISO)** - Digital Pin 9 / SPI MISO
- **GPIO8 (D8, SCK)** - Digital Pin 8 / SPI Serial Clock
- **GPIO20 (D7, RX)** - Digital Pin 7 / UART Receive

**Board Features:**
- USB-C connector (top edge)
- Two buttons (bottom edge): Reset (black) and Boot (yellow)
- Brand: Seeed Studio
- Certifications: FCC, CE

#### Component Wiring Table

| Component | Component Pin | XIAO Label | GPIO Number | Connection Type |
|-----------|---------------|------------|------------|----------------|
| OLED Screen | SDA | D4 | 6 | I2C Data |
| OLED Screen | SCL | D5 | 7 | I2C Clock |
| OLED Screen | VCC | 3V3 | - | Power (3.3V) |
| OLED Screen | GND | GND | - | Common Ground |
| Pulse Sensor Amped | RED wire (VCC) | 3V3 | - | Power (3.3V) |
| Pulse Sensor Amped | BLACK wire (GND) | GND | - | Common Ground |
| Pulse Sensor Amped | PURPLE wire (Signal) | A2 | 4 | Analog Pulse Signal |
| MPU6050 | SDA | D4 | 6 | I2C Data (Shared) |
| MPU6050 | SCL | D5 | 7 | I2C Clock (Shared) |
| MPU6050 | VCC | 3V3 | - | Power (3.3V) |
| MPU6050 | GND | GND | - | Common Ground |
| GSR Sensor | SIG | A0 | 2 | Analog Sweat Signal |
| GSR Sensor | VCC | 3V3 | - | Power (3.3V) |
| GSR Sensor | GND | GND | - | Common Ground |
| Push Button | Pin 1 | A1 | 3 | Digital Input |
| Push Button | Pin 2 | GND | - | Ground (Pull-up) |
| Vibration Motor | Pos (+) | D10 | 10 | Digital Output |
| Vibration Motor | Neg (-) | GND | - | Ground |

**Pulse Sensor Amped Notes (from official documentation):**
- Operating voltage: 3V to 5.5V (3.3V recommended for ESP32)
- Signal output: Analog, centered at Vdd/2 (~1.65V at 3.3V)
- Sample rate: 500Hz (every 2ms) for accurate beat detection
- Apply moderate pressure when placing on fingertip - excessive pressure restricts blood flow
- Use provided transparent vinyl stickers to insulate sensor front from skin oils/sweat
- **Safety:** Avoid connecting sensor to body while powered from mains AC - use battery power

**General Notes:**
- OLED Screen and MPU6050 share the I2C bus (SDA/SCL on GPIO 6/7)
- MPU6050 is at I2C address 0x69 (AD0 pin HIGH)
- GPIO5 (A3) may have limitations - avoid if possible
- All sensors use 3.3V power supply
- GSR sensor reads analog values on GPIO2 (A0)
- Pulse Sensor reads analog values on GPIO4 (A2)

### Service UUID

`0000ff00-0000-1000-8000-00805f9b34fb`

### Characteristics

| Name | UUID | Properties | Size |

|------|------|------------|------|

| LiveData | `0000ff01-...` | Notify | 7 bytes |

| TodayHourly | `0000ff02-...` | Read | 240 bytes |

| WeekDaily | `0000ff03-...` | Read | 70 bytes |

| Command | `0000ff04-...` | Write | 1 byte |

### LiveData Format (7 bytes)

```
[0] stress (0-100)
[1] hr (0-255 BPM)
[2] hrv low byte
[3] hrv high byte
[4] gsr low byte
[5] gsr high byte
[6] status bits:
    bit 0: hrSensorActive
    bit 1: calibrationComplete
    bit 2: motionDetected
    bits 3-4: activityLevel (0-3)
    bit 7: mpuReady
```

### Hourly Record Format (10 bytes × 24 = 240 bytes)

```
[0] hour (0-23)
[1] avgStress
[2] peakStress
[3] highStressMins
[4] avgHR
[5-6] avgHRV (16-bit LE)
[7-8] avgGSR (16-bit LE)
[9] flags: bit 0=valid, bits 1-2=activityLevel
```

### Daily Summary Format (10 bytes × 7 = 70 bytes)

```
[0] day index (0-6)
[1] avgStress
[2] peakStress
[3] peakHour
[4] highStressMins
[5] avgHR
[6-7] avgHRV (16-bit LE)
[8] reserved
[9] valid flag
```

### Command Values

- `0x01` - Sync complete acknowledgment
- `0x02` - Force history refresh

---

## Phase 2: Web Project Setup ✅

Project initialized in `stressview-web/`.

### Structure

```
stressview-web/
├── index.html
├── package.json
├── postcss.config.js
└── src/
    ├── main.js
    ├── router.js
    ├── style.css
    ├── components/
    │   └── nav.js
    ├── lib/
    │   └── state.js
    ├── pages/
    │   ├── home.js
    │   ├── breathe.js
    │   ├── today.js
    │   ├── trends.js
    │   ├── learn.js
    │   └── settings.js
    └── content/
```

### Dependencies

- **Vite** - Build tool
- **Tailwind CSS v4** - Styling
- **ApexCharts** - Charts
- **idb** - IndexedDB wrapper

---

## Phase 3: SPA Router and Navigation ✅

### Router (`src/router.js`)

- Hash-based routing
- Lazy page loading
- Mount/unmount lifecycle
- Active state management

### Navigation (`src/components/nav.js`)

- 5 tabs: Home, Breathe, Today, Trends, Learn
- Bottom fixed position
- SVG icons

---

## Phase 4: Bluetooth Module ⚠️ Verification

### `src/lib/bluetooth.js` ✅

- Implements `connect`, `disconnect`, `subscribe`, `readTodayData`, `readWeekData`, `readHistory`, and `sendCommand`.
- Handles permission prompts inside Electron (auto-pairing + device selection), manages disconnect callbacks, and routes notifications into app state/storage.
- Debug instrumentation present (to be cleaned up in Phase 8).

### `src/lib/parser.js` ✅

- Decodes the ESP32 payloads (live: 7 bytes, hourly: 240 bytes, daily: 70 bytes) and normalizes them for state/storage consumers.
- Error handling and validation for malformed packets.
- Debug instrumentation present (to be cleaned up in Phase 8).

**Next actions:** Hardware verification with ESP32 device to confirm end-to-end BLE communication.

---

## Phase 5: Data Storage ✅

### `src/lib/storage.js`

- Ships with a working `StressViewDB` (via `idb`) that exposes readings, hourly summaries, annotations, and breathing sessions stores.
- Provides helpers for seeding mock data, persisting annotations, retrieving 7-day windows, and clearing all data.
- IndexedDB init is instrumented so Electron-origin problems surface quickly; mock seeding now succeeds via Settings → "Seed Test Data".

### Sync Logic (implemented)

- Upon BLE history sync we batch-save hourly summaries + daily rollups, then push them into state for the Today/Trends views.
- Live readings are timestamped, pruned to 24h, and feed annotations + breathing session summaries.

---

## Phase 6: Pages ✅

### Home Page ✅ (`src/pages/home.js`)

- Stress indicator with zone coloring
- Secondary metrics (HR, HRV)
- Connection status badge
- "Start Breathing" button
- Today summary teaser

Stress zones:

- 0-25: "Calm" (green)
- 26-50: "Balanced" (teal)
- 51-70: "Elevated" (amber)
- 71-100: "High" (coral)

### Breathe Page ✅ (`src/pages/breathe.js`)

- Technique selector (Calm/Focus/Quick Reset)
- Animated breathing circle
- Phase indicator text
- Timer display
- Session summary

Breathing patterns:

- **Calm (4-7-8)**: inhale 4s, hold 7s, exhale 8s
- **Focus (Box)**: 4-4-4-4
- **Quick Reset**: deep inhale, double exhale (3-5 cycles)

### Today Page ✅ (`src/pages/today.js`)

- Date header
- Summary stats (avg stress, high stress minutes)
- ApexCharts smooth line chart (24 hours)
- Annotation list
- Tap-to-annotate

### Trends Page ✅ (`src/pages/trends.js`)

- Weekly bar chart (7 days)
- Week summary stats
- Insights text (best day, worst time, patterns)
- Week navigation

### Learn Page ✅ (`src/pages/learn.js`)

5 expandable article cards:

1. "What is Stress, Really?"
2. "Understanding Your Stress Score"
3. "The Power of Breathing"
4. "Quick Stress Relievers"
5. "Building Stress Resilience"

### Settings Page ✅ (`src/pages/settings.js`)

- Connect/Disconnect + Sync buttons call into `bluetooth.js` with progress states
- Auto-sync history on connection
- BLE disconnect errors bubble into UI
- Clear data and seed mock data actions wired to IndexedDB helpers
- Device status display with connection state

---

## Phase 7: Charts ✅

### Line Chart (`src/components/chart-line.js`)

- ApexCharts area/line
- Smooth curves (spline)
- Wellness color gradient
- Responsive

### Bar Chart (`src/components/chart-bar.js`)

- ApexCharts bar
- Daily averages
- Color by stress level

### Breathing Animation (`src/components/breathing-circle.js`)

- CSS/JS animated circle
- Phase-aware sizing
- Smooth easing

---

## Phase 8: Polish and Deploy ✅ Complete

### Completed ✅

- **Loading screen improvements**
  - Fixed logo flash issue (added inline `width: 48px; height: 48px` styles)
  - Added hourglass animation indicator
  - Smooth fade-out transition
  
- **Icon configuration**
  - Generated PNG icons (256px, 512px) from SVG
  - Updated `electron/main.js` to use PNG in production
  - Configured `electron-builder` with `icon: "public/icons/icon-256.png"` for Windows .ico generation
  
- **Package configuration**
  - Added `"type": "module"` to `package.json` (fixes ES module warnings)

- **Debug instrumentation cleanup**
  - Removed all debug logging from ESP32 firmware
  - Code cleaned and production-ready

- **Hardware changes**
  - Replaced MAX30105 (I2C) with Pulse Sensor Amped (Analog) - more reliable
  - Removed tap detection feature (unreliable with MPU6050 software detection)
  - Updated Info screen with raw accelerometer/gyroscope coordinates
  - Made breathing circle animation smaller

### Testing

- Chrome desktop BLE
- Android Chrome
- Offline behavior
- Mock data fallback
- ESP32 hardware verification (pending Pulse Sensor arrival)

### Deploy

- Production build with Vite
- Electron packaging verification
- GitHub Pages or Vercel (optional)

---

## File Summary

| File | Purpose |

|------|---------|

| `DeviceCode.cpp` | ESP32 firmware (sensors, BLE, display) |

| `src/main.js` | App entry, router init |

| `src/router.js` | SPA hash router |

| `src/style.css` | Tailwind + custom styles |

| `src/lib/bluetooth.js` | Web Bluetooth wrapper |

| `src/lib/storage.js` | IndexedDB wrapper |

| `src/lib/parser.js` | Binary data parsing |

| `src/lib/state.js` | Reactive state |

| `src/pages/*.js` | 6 page modules |

| `src/components/*.js` | Reusable UI components |

| `src/content/articles.js` | Learn page content |