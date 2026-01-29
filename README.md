# For MIT competition submission.
# StressView

A stress monitoring system that combines ESP32-C3 hardware sensors with a web-based dashboard for real-time stress tracking and guided breathing exercises.

## Features

- **Real-time Stress Monitoring**: Heart rate, HRV, and GSR sensors provide continuous stress level tracking
- **BLE Connectivity**: Wireless data transmission from ESP32 device to web app
- **Guided Breathing Exercises**: Multiple breathing techniques (4-7-8, Box Breathing, Quick Reset)
- **Data Visualization**: Charts and trends showing daily and weekly stress patterns
- **Offline Support**: Local data storage with IndexedDB
- **Cross-Platform**: Web app packaged as Electron desktop application

## Hardware

- **ESP32-C3** (XIAO) - Main microcontroller
- **Pulse Sensor Amped** - Heart rate detection
- **GSR Sensor** - Galvanic skin response (sweat/stress)
- **MPU6050** - 6-axis IMU for motion detection
- **SSD1306 OLED** - 128x64 display

## Project Structure

```
StressView/
├── hardware/          # ESP32 firmware (DeviceCode.cpp)
├── plans/             # Project documentation
└── WebsiteCode/       # Web application
    ├── src/           # Source code
    ├── public/        # Static assets
    ├── electron/      # Electron configuration
    └── package.json   # Dependencies
```

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Arduino IDE (for ESP32 firmware)
- ESP32 board support package

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/StressView.git
cd StressView
```

2. Install dependencies:
```bash
cd WebsiteCode
npm install
```

3. Build the project:
```bash
npm run build
```

4. Run in development mode:
```bash
npm run dev
```

### Building for Production

```bash
# Windows
npm run dist

# Linux
npm run dist:linux
```

## Usage

1. Flash the ESP32 firmware (`hardware/DeviceCode.cpp`) to your device
2. Open the web app or Electron application
3. Connect to the StressView device via Bluetooth
4. Start monitoring your stress levels in real-time

## Technology Stack

- **Frontend**: Vanilla JavaScript (ES modules), Tailwind CSS v4
- **Charts**: ApexCharts
- **Build Tool**: Vite
- **Desktop**: Electron
- **Storage**: IndexedDB (via idb library)
- **Hardware**: ESP32-C3, Arduino framework

## License

MIT License - see LICENSE file for details


