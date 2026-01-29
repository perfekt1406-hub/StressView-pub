const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

const isDev = process.env.NODE_ENV === 'development';

// Enable Web Bluetooth in Electron
// These flags are required for Web Bluetooth to work properly
app.commandLine.appendSwitch('enable-web-bluetooth', 'true');
app.commandLine.appendSwitch('enable-experimental-web-platform-features');

// Production server for serving static files with proper HTTP origin
// This ensures IndexedDB and other web APIs work correctly
let server = null;
let serverPort = 0;

function startLocalServer() {
  return new Promise((resolve) => {
    const distPath = path.join(__dirname, '../dist');
    
    // MIME types for common file extensions
    const mimeTypes = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
    };
    
    server = http.createServer((req, res) => {
      let filePath = req.url.split('?')[0].split('#')[0];
      
      // Default to index.html
      if (filePath === '/') {
        filePath = '/index.html';
      }
      
      const fullPath = path.join(distPath, filePath);
      const ext = path.extname(fullPath).toLowerCase();
      
      // Try to serve the file
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(fullPath).pipe(res);
      } else if (!ext || ext === '.html') {
        // SPA fallback for routes without extension
        const indexPath = path.join(distPath, 'index.html');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        fs.createReadStream(indexPath).pipe(res);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });
    
    // Listen on random available port
    server.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      console.log(`Local server started on port ${serverPort}`);
      resolve(serverPort);
    });
  });
}

function stopLocalServer() {
  if (server) {
    server.close();
    server = null;
  }
}

// Store reference to main window for Bluetooth device selection
let mainWindow = null;
let bluetoothDeviceCallback = null;
let bluetoothDevices = [];  // Accumulate devices across multiple event fires
let bluetoothScanTimeout = null;  // Timer to wait for devices

async function createWindow() {
  // Determine icon path based on environment
  // Windows prefers PNG/ICO over SVG for window icons
  let iconPath;
  if (isDev) {
    // In dev, try PNG first, fallback to SVG
    const devPngPath = path.join(__dirname, '../public/icons/icon-256.png');
    const devSvgPath = path.join(__dirname, '../public/icons/icon.svg');
    iconPath = fs.existsSync(devPngPath) ? devPngPath : devSvgPath;
  } else {
    // In production, use PNG (better Windows support)
    // When packaged, __dirname points to resources/app or resources/app.asar
    const pngPath = path.join(__dirname, '../dist/icons/icon-256.png');
    const svgPath = path.join(__dirname, '../dist/icons/icon.svg');
    iconPath = fs.existsSync(pngPath) ? pngPath : svgPath;
  }
  
  // Normalize path for Windows
  if (iconPath) {
    iconPath = path.normalize(iconPath);
    console.log('Using icon:', iconPath, 'exists:', fs.existsSync(iconPath));
  }

  mainWindow = new BrowserWindow({
    width: 420,
    height: 800,
    minWidth: 320,
    minHeight: 600,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
    autoHideMenuBar: true,
    titleBarStyle: 'default',
    title: 'StressView',
    backgroundColor: '#f8fafc',
  });
  
  // Clear reference on close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  
  // Allow Bluetooth and storage permissions
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    // Allow bluetooth permissions
    if (permission === 'bluetooth') {
      callback(true);
      return;
    }
    callback(true);
  });
  
  // Handle Bluetooth permission check
  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'bluetooth') {
      return true;
    }
    return true;
  });
  
  // Handle Web Bluetooth device selection
  // This event fires MULTIPLE TIMES as devices are discovered during scanning
  // We need to accumulate devices and wait before making a selection
  mainWindow.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    
    // Store callback (we'll call it later after accumulating devices)
    bluetoothDeviceCallback = callback;
    
    // Accumulate new devices (avoid duplicates by deviceId)
    // Update existing entries if new scan has a better name
    for (const device of devices) {
      const existingIndex = bluetoothDevices.findIndex(d => d.deviceId === device.deviceId);
      if (existingIndex === -1) {
        // New device
        bluetoothDevices.push(device);
        console.log('New BLE device found:', device.deviceName || '(unnamed)', device.deviceId);
      } else if (device.deviceName && !device.deviceName.includes('Unknown')) {
        // Update existing device if new scan has a real name (not "Unknown or Unsupported")
        bluetoothDevices[existingIndex] = device;
        console.log('Updated device name:', device.deviceName, device.deviceId);
      }
    }
    
    // Check if StressView is already in the accumulated list
    const stressViewDevice = bluetoothDevices.find(device => {
      const name = device.deviceName || '';
      return name.toLowerCase().includes('stressview');
    });
    
    // If we found StressView, select it immediately
    if (stressViewDevice) {
      console.log('Found StressView! Selecting:', stressViewDevice.deviceName);
      // Clear state and call callback
      if (bluetoothScanTimeout) clearTimeout(bluetoothScanTimeout);
      bluetoothDevices = [];
      callback(stressViewDevice.deviceId);
      return;
    }
    
    // If no StressView yet, wait for more devices (up to 5 seconds)
    // Clear any existing timeout and set a new one
    if (bluetoothScanTimeout) clearTimeout(bluetoothScanTimeout);
    
    bluetoothScanTimeout = setTimeout(() => {
      console.log('Bluetooth scan timeout. Total devices found:', bluetoothDevices.length);
      
      // Final check for StressView
      const finalStressView = bluetoothDevices.find(device => {
        const name = device.deviceName || '';
        return name.toLowerCase().includes('stressview');
      });
      
      if (finalStressView && bluetoothDeviceCallback) {
        console.log('Selecting StressView after timeout:', finalStressView.deviceName);
        bluetoothDeviceCallback(finalStressView.deviceId);
      } else if (bluetoothDevices.length > 0 && bluetoothDeviceCallback) {
        // Select first named device as fallback
        const namedDevice = bluetoothDevices.find(d => d.deviceName && d.deviceName.length > 0);
        if (namedDevice) {
          console.log('Selecting first named device:', namedDevice.deviceName);
          bluetoothDeviceCallback(namedDevice.deviceId);
        } else {
          console.log('No named devices, selecting first device');
          bluetoothDeviceCallback(bluetoothDevices[0].deviceId);
        }
      } else if (bluetoothDeviceCallback) {
        console.log('No Bluetooth devices found after timeout');
        bluetoothDeviceCallback('');
      }
      
      // Clear state
      bluetoothDevices = [];
      bluetoothDeviceCallback = null;
    }, 5000);  // Wait 5 seconds for devices to be discovered
  });

  // Load the app
  if (isDev) {
    // Development: load from Vite dev server
    mainWindow.loadURL('http://localhost:5173');
  } else {
    // Production: start local HTTP server for proper web API support
    const port = await startLocalServer();
    mainWindow.loadURL(`http://127.0.0.1:${port}`);
  }

  // Handle window title
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });
}

// App ready
app.whenReady().then(async () => {
  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  stopLocalServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Clean up on quit
app.on('will-quit', () => {
  stopLocalServer();
});

// Security: Disable navigation to external URLs
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    // Allow navigation within our local server and dev server
    if (navigationUrl.startsWith('http://127.0.0.1:') || 
        navigationUrl.startsWith('http://localhost:')) {
      return; // Allow
    }
    event.preventDefault();
  });
});
