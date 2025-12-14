'use strict';

const Bonjour = require('bonjour-service');
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

/**
 * SpotifyZeroConfService handles:
 * 1. Broadcasting as a fake Spotify Connect device to capture credentials
 * 2. Discovering real Spotify Connect devices on the network
 * 3. Waking devices using stored credentials
 */
class SpotifyZeroConfService {

  constructor(homey) {
    this.homey = homey;
    this.bonjour = null;
    this.httpServer = null;
    this.browser = null;
    this.discoveredDevices = new Map();

    // Generate a stable device ID for this Homey instance
    this.deviceId = this._generateDeviceId();

    // DH key pair for encryption
    this.dhKeys = null;
  }

  /**
   * Generate a stable device ID based on Homey's cloud ID or a random UUID
   */
  _generateDeviceId() {
    // Try to get a stable ID from Homey settings, or generate one
    let deviceId = this.homey.settings.get('zeroconf_device_id');
    if (!deviceId) {
      deviceId = crypto.randomBytes(16).toString('hex');
      this.homey.settings.set('zeroconf_device_id', deviceId);
    }
    return deviceId;
  }

  /**
   * Generate DH key pair for the ZeroConf handshake
   */
  _generateDHKeys() {
    const dh = crypto.createDiffieHellman(2048);
    dh.generateKeys();
    return {
      dh,
      publicKey: dh.getPublicKey('base64'),
      privateKey: dh.getPrivateKey('base64')
    };
  }

  /**
   * Start broadcasting as a Spotify Connect device
   * This allows users to "connect" to Homey from their Spotify app
   */
  async startPairingMode(deviceName = 'Homey Spotify') {
    this.homey.log('Starting ZeroConf pairing mode...');

    // Generate new DH keys for this pairing session
    this.dhKeys = this._generateDHKeys();

    // Find an available port
    const port = await this._findAvailablePort(5555);

    // Start HTTP server for ZeroConf endpoints
    await this._startHttpServer(port, deviceName);

    // Initialize Bonjour
    this.bonjour = new Bonjour.default();

    // Advertise as Spotify Connect device
    this.service = this.bonjour.publish({
      name: deviceName,
      type: 'spotify-connect',
      port: port,
      txt: {
        CPath: '/zeroconf',
        VERSION: '1.0',
        Stack: 'SP'
      }
    });

    this.homey.log(`ZeroConf pairing started on port ${port}`);

    return { port, deviceId: this.deviceId };
  }

  /**
   * Stop pairing mode
   */
  async stopPairingMode() {
    if (this.service) {
      this.service.stop();
      this.service = null;
    }

    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }

    this.homey.log('ZeroConf pairing stopped');
  }

  /**
   * Start HTTP server for ZeroConf endpoints
   */
  async _startHttpServer(port, deviceName) {
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer((req, res) => {
        this._handleHttpRequest(req, res, deviceName);
      });

      this.httpServer.listen(port, () => {
        resolve();
      });

      this.httpServer.on('error', reject);
    });
  }

  /**
   * Handle incoming ZeroConf HTTP requests
   */
  _handleHttpRequest(req, res, deviceName) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const action = url.searchParams.get('action');

    this.homey.log(`ZeroConf request: ${action}`);

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    if (action === 'getInfo') {
      // Return device info with our public key
      const info = {
        status: 101,
        statusString: 'OK',
        spotifyError: 0,
        version: '2.7.1',
        deviceID: this.deviceId,
        remoteName: deviceName,
        activeUser: '',
        publicKey: this.dhKeys.publicKey,
        deviceType: 'SPEAKER',
        libraryVersion: '1.0.0',
        accountReq: 'PREMIUM',
        brandDisplayName: 'Homey',
        modelDisplayName: 'Spotify Connect'
      };

      res.writeHead(200);
      res.end(JSON.stringify(info));

    } else if (action === 'addUser') {
      // Collect POST data
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });

      req.on('end', () => {
        try {
          // Parse the form data
          const params = new URLSearchParams(body);
          const userName = params.get('userName');
          const blob = params.get('blob');
          const clientKey = params.get('clientKey');

          this.homey.log(`Received credentials for user: ${userName}`);

          // Store the credentials
          this._storeCredentials(userName, blob, clientKey);

          // Respond with success
          const response = {
            status: 101,
            statusString: 'OK',
            spotifyError: 0
          };

          res.writeHead(200);
          res.end(JSON.stringify(response));

          // Emit event for credential capture
          this.homey.emit('spotify_credentials_captured', { userName });

        } catch (error) {
          this.homey.error('Error processing addUser:', error);
          res.writeHead(500);
          res.end(JSON.stringify({ status: 0, statusString: 'ERROR' }));
        }
      });

    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ status: 0, statusString: 'Unknown action' }));
    }
  }

  /**
   * Store captured credentials in Homey settings
   */
  _storeCredentials(userName, blob, clientKey) {
    const credentials = {
      userName,
      blob,
      clientKey,
      capturedAt: Date.now(),
      deviceId: this.deviceId
    };

    this.homey.settings.set('spotify_zeroconf_credentials', credentials);
    this.homey.log('Credentials stored successfully');
  }

  /**
   * Get stored credentials
   */
  getStoredCredentials() {
    return this.homey.settings.get('spotify_zeroconf_credentials');
  }

  /**
   * Check if we have stored credentials
   */
  hasCredentials() {
    const creds = this.getStoredCredentials();
    return creds && creds.userName && creds.blob;
  }

  /**
   * Start discovering Spotify Connect devices on the network
   */
  startDiscovery() {
    if (!this.bonjour) {
      this.bonjour = new Bonjour.default();
    }

    this.homey.log('Starting Spotify Connect device discovery...');

    this.browser = this.bonjour.find({ type: 'spotify-connect' }, (service) => {
      this._handleDiscoveredDevice(service);
    });

    return this.browser;
  }

  /**
   * Handle a discovered Spotify Connect device
   */
  _handleDiscoveredDevice(service) {
    const device = {
      name: service.name,
      host: service.host,
      port: service.port,
      addresses: service.addresses,
      txt: service.txt,
      discoveredAt: Date.now()
    };

    this.discoveredDevices.set(service.name, device);
    this.homey.log(`Discovered Spotify device: ${service.name} at ${service.host}:${service.port}`);

    // Emit event
    this.homey.emit('spotify_device_discovered', device);
  }

  /**
   * Get list of discovered devices
   */
  getDiscoveredDevices() {
    return Array.from(this.discoveredDevices.values());
  }

  /**
   * Stop discovery
   */
  stopDiscovery() {
    if (this.browser) {
      this.browser.stop();
      this.browser = null;
    }
  }

  /**
   * Wake a Spotify Connect device using stored credentials
   */
  async wakeDevice(deviceName) {
    const credentials = this.getStoredCredentials();
    if (!credentials) {
      throw new Error('No stored credentials. Please pair first.');
    }

    const device = this.discoveredDevices.get(deviceName);
    if (!device) {
      throw new Error(`Device "${deviceName}" not found. Try running discovery first.`);
    }

    const address = device.addresses[0] || device.host;
    const port = device.port;
    const cpath = device.txt?.CPath || '/zeroconf';

    this.homey.log(`Waking device ${deviceName} at ${address}:${port}`);

    // First, get the device's public key
    const deviceInfo = await this._getDeviceInfo(address, port, cpath);

    // Send addUser request to wake the device
    await this._sendAddUser(address, port, cpath, credentials, deviceInfo.publicKey);

    this.homey.log(`Device ${deviceName} wake request sent`);
  }

  /**
   * Get device info (including public key) from a Spotify Connect device
   */
  async _getDeviceInfo(host, port, cpath) {
    return new Promise((resolve, reject) => {
      const url = `http://${host}:${port}${cpath}?action=getInfo`;

      http.get(url, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Invalid response from device'));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Send addUser request to a device
   */
  async _sendAddUser(host, port, cpath, credentials, devicePublicKey) {
    return new Promise((resolve, reject) => {
      // Prepare the form data
      const formData = new URLSearchParams({
        userName: credentials.userName,
        blob: credentials.blob,
        clientKey: credentials.clientKey
      }).toString();

      const options = {
        hostname: host,
        port: port,
        path: `${cpath}?action=addUser`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(formData)
        }
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            if (response.status === 101) {
              resolve(response);
            } else {
              reject(new Error(`Device rejected credentials: ${response.statusString}`));
            }
          } catch (e) {
            reject(new Error('Invalid response from device'));
          }
        });
      });

      req.on('error', reject);
      req.write(formData);
      req.end();
    });
  }

  /**
   * Find an available port
   */
  async _findAvailablePort(startPort) {
    return new Promise((resolve) => {
      const server = http.createServer();
      server.listen(startPort, () => {
        const port = server.address().port;
        server.close(() => resolve(port));
      });
      server.on('error', () => {
        resolve(this._findAvailablePort(startPort + 1));
      });
    });
  }

  /**
   * Cleanup
   */
  destroy() {
    this.stopPairingMode();
    this.stopDiscovery();
    if (this.bonjour) {
      this.bonjour.destroy();
      this.bonjour = null;
    }
  }

}

module.exports = SpotifyZeroConfService;
