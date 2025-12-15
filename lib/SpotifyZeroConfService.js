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
   * Uses Spotify's exact DH parameters (from librespot)
   */
  _generateDHKeys() {
    // Spotify's exact 768-bit DH prime (from librespot core/src/diffie_hellman.rs)
    const prime = Buffer.from([
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
      0xc9, 0x0f, 0xda, 0xa2, 0x21, 0x68, 0xc2, 0x34,
      0xc4, 0xc6, 0x62, 0x8b, 0x80, 0xdc, 0x1c, 0xd1,
      0x29, 0x02, 0x4e, 0x08, 0x8a, 0x67, 0xcc, 0x74,
      0x02, 0x0b, 0xbe, 0xa6, 0x3b, 0x13, 0x9b, 0x22,
      0x51, 0x4a, 0x08, 0x79, 0x8e, 0x34, 0x04, 0xdd,
      0xef, 0x95, 0x19, 0xb3, 0xcd, 0x3a, 0x43, 0x1b,
      0x30, 0x2b, 0x0a, 0x6d, 0xf2, 0x5f, 0x14, 0x37,
      0x4f, 0xe1, 0x35, 0x6d, 0x6d, 0x51, 0xc2, 0x45,
      0xe4, 0x85, 0xb5, 0x76, 0x62, 0x5e, 0x7e, 0xc6,
      0xf4, 0x4c, 0x42, 0xe9, 0xa6, 0x3a, 0x36, 0x20,
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff
    ]);
    const generator = Buffer.from([0x02]);

    const dh = crypto.createDiffieHellman(prime, generator);
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

    try {
      // Generate new DH keys for this pairing session
      this.homey.log('Generating DH keys...');
      this.dhKeys = this._generateDHKeys();
      this.homey.log('DH keys generated');

      // Find an available port
      this.homey.log('Finding available port...');
      const port = await this._findAvailablePort(5555);
      this.homey.log(`Found port: ${port}`);

      // Start HTTP server for ZeroConf endpoints
      this.homey.log('Starting HTTP server...');
      await this._startHttpServer(port, deviceName);
      this.homey.log('HTTP server started');

      // Initialize Bonjour
      this.homey.log('Initializing Bonjour...');
      this.bonjour = new Bonjour.default();
      this.homey.log('Bonjour initialized');

      // Advertise as Spotify Connect device
      this.homey.log('Publishing mDNS service...');
      this.service = this.bonjour.publish({
        name: deviceName,
        type: 'spotify-connect',
        port: port,
        txt: {
          CPath: '/',
          VERSION: '1.0'
        }
      });
      this.homey.log('mDNS service published');

      this.homey.log(`ZeroConf pairing started on port ${port}`);

      return { port, deviceId: this.deviceId };
    } catch (error) {
      this.homey.error('Failed to start pairing mode:', error);
      throw error;
    }
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
    let action = url.searchParams.get('action');

    this.homey.log(`ZeroConf request: ${req.method} ${req.url}`);

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    if (action === 'getInfo') {
      // Return device info with our public key (matching librespot's response structure)
      const info = {
        status: 101,
        statusString: 'OK',
        spotifyError: 0,
        version: '2.9.0',
        deviceID: this.deviceId,
        remoteName: deviceName,
        activeUser: '',
        publicKey: this.dhKeys.publicKey,
        deviceType: 'SPEAKER',
        libraryVersion: '0.1.0',
        accountReq: 'PREMIUM',
        brandDisplayName: 'Homey',
        modelDisplayName: 'Spotify Connect',
        // Additional fields required by newer Spotify clients
        resolverVersion: '1',
        groupStatus: 'NONE',
        tokenType: 'default',
        clientID: this.deviceId,
        productID: 0,
        scope: 'streaming,client-authorization-universal',
        availability: '',
        supported_drm_media_formats: [],
        supported_capabilities: 1,
        aliases: []
      };

      this.homey.log('Responding to getInfo');
      res.writeHead(200);
      res.end(JSON.stringify(info));

    } else if (req.method === 'POST') {
      // For POST requests, action might be in the body
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });

      req.on('end', () => {
        try {
          this.homey.log(`POST body: ${body}`);

          // Parse the form data
          const params = new URLSearchParams(body);
          const postAction = params.get('action') || action;

          this.homey.log(`POST action: ${postAction}`);

          if (postAction === 'addUser') {
            const userName = params.get('userName');
            const blob = params.get('blob');
            const clientKey = params.get('clientKey');

            this.homey.log(`Received credentials for user: ${userName}`);
            this.homey.log(`Blob length: ${blob ? blob.length : 0}`);
            this.homey.log(`ClientKey length: ${clientKey ? clientKey.length : 0}`);

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
          } else {
            this.homey.log(`Unknown POST action: ${postAction}`);
            res.writeHead(404);
            res.end(JSON.stringify({ status: 0, statusString: 'Unknown action' }));
          }

        } catch (error) {
          this.homey.error('Error processing POST:', error);
          res.writeHead(500);
          res.end(JSON.stringify({ status: 0, statusString: 'ERROR' }));
        }
      });

    } else {
      this.homey.log(`Unknown request: ${req.method} ${req.url}`);
      res.writeHead(404);
      res.end(JSON.stringify({ status: 0, statusString: 'Unknown action' }));
    }
  }

  /**
   * Second layer decryption using deviceId
   * Algorithm from librespot authentication.rs:
   * 1. Derive key: PBKDF2-HMAC-SHA1(SHA1(deviceId), username, 256 iterations) -> 20 bytes, extend to 24
   * 2. Decrypt: AES-192-ECB
   * 3. XOR transformation
   */
  _decryptWithDeviceId(encryptedBlob, userName) {
    this.homey.log(`Decrypting with deviceId: ${this.deviceId}, userName: ${userName}`);

    // Step 1: Derive key from deviceId (from librespot authentication.rs)
    // secret = SHA1(deviceId)
    const secret = crypto.createHash('sha1').update(this.deviceId).digest();

    // PBKDF2 with 256 iterations to get 20 bytes (salt = username)
    const pbkdf2Output = crypto.pbkdf2Sync(secret, userName, 256, 20, 'sha1');

    // SHA1 the PBKDF2 output and use that as first 20 bytes
    const hashedKey = crypto.createHash('sha1').update(pbkdf2Output).digest();

    // Construct 24-byte key: SHA1 hash (20 bytes) + big-endian 20 (4 bytes)
    const key24 = Buffer.alloc(24);
    hashedKey.copy(key24, 0);
    key24.writeUInt32BE(20, 20);  // Write 20 as big-endian at offset 20

    this.homey.log(`Derived AES-192 key: ${key24.length} bytes`);

    // Step 2: Decrypt using AES-192-ECB
    const decipher = crypto.createDecipheriv('aes-192-ecb', key24, null);
    decipher.setAutoPadding(false);

    let decrypted;
    try {
      decrypted = Buffer.concat([decipher.update(encryptedBlob), decipher.final()]);
    } catch (err) {
      this.homey.error('AES-192-ECB decryption failed:', err.message);
      throw err;
    }

    this.homey.log(`AES-192-ECB decrypted: ${decrypted.length} bytes`);

    // Step 3: XOR transformation
    // for i in 0..l - 0x10 { data[l - i - 1] ^= data[l - i - 0x11]; }
    const l = decrypted.length;
    for (let i = 0; i < l - 0x10; i++) {
      decrypted[l - i - 1] ^= decrypted[l - i - 0x11];
    }

    this.homey.log(`After XOR transformation: ${decrypted.length} bytes`);
    this.homey.log(`First 20 bytes after deviceId decrypt: ${decrypted.slice(0, 20).toString('hex')}`);

    return decrypted;
  }

  /**
   * Decrypt the blob received from Spotify client
   * Algorithm from librespot:
   * 1. Compute shared secret using DH
   * 2. Derive keys using HMAC-SHA1
   * 3. Verify MAC
   * 4. Decrypt using AES-128-CTR
   */
  _decryptBlob(blobBase64, clientKeyBase64, userName) {
    try {
      // Decode base64 inputs
      const blob = Buffer.from(blobBase64, 'base64');
      const clientKey = Buffer.from(clientKeyBase64, 'base64');

      this.homey.log(`Decrypting blob: ${blob.length} bytes, clientKey: ${clientKey.length} bytes, userName: ${userName}`);

      // Compute shared secret using DH
      const sharedSecret = this.dhKeys.dh.computeSecret(clientKey);
      this.homey.log(`Shared secret computed: ${sharedSecret.length} bytes`);

      // Derive base key: first 16 bytes of SHA1(shared_secret)
      const sharedSecretHash = crypto.createHash('sha1').update(sharedSecret).digest();
      const baseKey = sharedSecretHash.slice(0, 16);

      // Derive checksum key: HMAC-SHA1(base_key, "checksum")
      const checksumKey = crypto.createHmac('sha1', baseKey).update('checksum').digest();

      // Derive encryption key: HMAC-SHA1(base_key, "encryption")
      const encryptionKey = crypto.createHmac('sha1', baseKey).update('encryption').digest().slice(0, 16);

      // Parse blob structure:
      // - IV: bytes 0-15
      // - Ciphertext: bytes 16 to length-20
      // - MAC: last 20 bytes
      const iv = blob.slice(0, 16);
      const ciphertext = blob.slice(16, blob.length - 20);
      const mac = blob.slice(blob.length - 20);

      this.homey.log(`IV: ${iv.length} bytes, Ciphertext: ${ciphertext.length} bytes, MAC: ${mac.length} bytes`);

      // Verify MAC: HMAC-SHA1(checksum_key, ciphertext)
      const computedMac = crypto.createHmac('sha1', checksumKey).update(ciphertext).digest();
      if (!crypto.timingSafeEqual(computedMac, mac)) {
        throw new Error('MAC verification failed - credentials may be corrupted');
      }
      this.homey.log('MAC verification passed');

      // Decrypt using AES-128-CTR
      const decipher = crypto.createDecipheriv('aes-128-ctr', encryptionKey, iv);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

      this.homey.log(`Decrypted ${decrypted.length} bytes`);

      // The decrypted blob is base64-encoded, decode it first
      const decryptedString = decrypted.toString('utf8');
      this.homey.log(`Decrypted as string (first 50 chars): ${decryptedString.slice(0, 50)}...`);

      // Check if it looks like base64
      if (/^[A-Za-z0-9+/=]+$/.test(decryptedString.trim())) {
        this.homey.log('Decrypted data appears to be base64, decoding...');
        const binaryData = Buffer.from(decryptedString, 'base64');
        this.homey.log(`Base64 decoded to ${binaryData.length} bytes`);

        // Second layer: decrypt with deviceId (AES-192-ECB + XOR)
        // Note: this layer requires the username as salt for PBKDF2
        const finalData = this._decryptWithDeviceId(binaryData, userName);
        return this._parseDecryptedCredentials(finalData);
      }

      // Otherwise parse as binary directly
      return this._parseDecryptedCredentials(decrypted);

    } catch (error) {
      this.homey.error('Failed to decrypt blob:', error);
      throw error;
    }
  }

  /**
   * Parse the decrypted credential blob
   * Format (from librespot):
   * - read_u8: skip 1 byte
   * - read_bytes: skip length-prefixed bytes
   * - read_u8: skip 1 byte
   * - read_int: auth_type
   * - read_u8: skip 1 byte
   * - read_bytes: auth_data
   */
  _parseDecryptedCredentials(decrypted) {
    let offset = 0;

    // Helper: read single byte
    const readU8 = () => {
      return decrypted[offset++];
    };

    // Helper: read 1-or-2 byte integer (librespot format)
    // If bit 7 unset: return low 7 bits
    // If bit 7 set: read second byte, combine as (first & 0x7f) | (second << 7)
    const readInt = () => {
      const first = decrypted[offset++];
      if ((first & 0x80) === 0) {
        return first & 0x7f;
      }
      const second = decrypted[offset++];
      return (first & 0x7f) | (second << 7);
    };

    // Helper: read length-prefixed bytes
    const readBytes = () => {
      const len = readInt();
      const data = decrypted.slice(offset, offset + len);
      offset += len;
      return data;
    };

    // Log first bytes for debugging
    this.homey.log(`First 20 bytes: ${decrypted.slice(0, 20).toString('hex')}`);

    // Parse sequence (from librespot):
    const skip1 = readU8();           // Skip 1 byte
    const skipBytes = readBytes();    // Skip length-prefixed bytes
    const skip2 = readU8();           // Skip 1 byte
    const authType = readInt();       // Auth type
    const skip3 = readU8();           // Skip 1 byte
    const authData = readBytes();     // Auth data

    this.homey.log(`Skip1: 0x${skip1.toString(16)}, SkipBytes: ${skipBytes.length} bytes, Skip2: 0x${skip2.toString(16)}, Skip3: 0x${skip3.toString(16)}`);
    this.homey.log(`SkipBytes content (hex): ${skipBytes.toString('hex')}`);
    this.homey.log(`SkipBytes as string: ${skipBytes.toString('utf8')}`);
    this.homey.log(`AuthData (hex): ${authData.slice(0, 32).toString('hex')}...`);

    this.homey.log(`Parsed credentials - authType: ${authType}, authData: ${authData.length} bytes`);
    this.homey.log(`Remaining bytes after parsing: ${decrypted.length - offset}`);

    return {
      authType,
      authData: authData.toString('base64')
    };
  }

  /**
   * Store captured credentials in Homey settings
   */
  _storeCredentials(userName, blob, clientKey) {
    let decryptedCredentials = null;

    // Try to decrypt if we have blob and clientKey
    if (blob && clientKey && this.dhKeys) {
      try {
        decryptedCredentials = this._decryptBlob(blob, clientKey, userName);
        this.homey.log('Credentials decrypted successfully');
      } catch (error) {
        this.homey.error('Failed to decrypt credentials:', error.message);
      }
    }

    const credentials = {
      userName,
      blob,
      clientKey,
      decrypted: decryptedCredentials,
      capturedAt: Date.now(),
      deviceId: this.deviceId
    };

    this.homey.settings.set('spotify_zeroconf_credentials', credentials);
    this.homey.log('Credentials stored successfully');

    if (decryptedCredentials) {
      this.homey.log(`Auth type: ${decryptedCredentials.authType}`);
      this.homey.log(`Auth data available: ${decryptedCredentials.authData ? 'yes' : 'no'}`);
    }
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
    this.homey.log(`  TXT records: ${JSON.stringify(service.txt)}`);

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
   * Refresh discovery for a specific device and wait for fresh data
   * Useful for devices with dynamic ports (like librespot)
   */
  async refreshDeviceDiscovery(deviceNameOrHost, timeoutMs = 2000) {
    const nameLower = deviceNameOrHost.toLowerCase();

    this.homey.log(`Refreshing mDNS discovery for: ${deviceNameOrHost}`);

    // Clear stale entry
    for (const [key, device] of this.discoveredDevices.entries()) {
      const name = (device.name || device.remoteName || '').toLowerCase();
      const host = (device.host || '').toLowerCase();
      if (name.includes(nameLower) || nameLower.includes(name) ||
          host.includes(nameLower) || nameLower.includes(host)) {
        this.homey.log(`Clearing stale entry for: ${key}`);
        this.discoveredDevices.delete(key);
      }
    }

    // Wait for fresh discovery
    return new Promise((resolve) => {
      const startTime = Date.now();

      const checkForDevice = () => {
        for (const device of this.discoveredDevices.values()) {
          const name = (device.name || device.remoteName || '').toLowerCase();
          const host = (device.host || '').toLowerCase();
          if (name.includes(nameLower) || nameLower.includes(name) ||
              host.includes(nameLower) || nameLower.includes(host)) {
            this.homey.log(`Fresh discovery received: ${device.name} at ${device.host}:${device.port}`);
            resolve(device);
            return;
          }
        }

        if (Date.now() - startTime < timeoutMs) {
          setTimeout(checkForDevice, 100);
        } else {
          this.homey.log(`Discovery refresh timeout for: ${deviceNameOrHost}`);
          resolve(null);
        }
      };

      // Start checking
      checkForDevice();
    });
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
    if (!credentials || !credentials.decrypted) {
      throw new Error('No decrypted credentials. Please pair first.');
    }

    const device = this.discoveredDevices.get(deviceName);
    if (!device) {
      throw new Error(`Device "${deviceName}" not found. Try running discovery first.`);
    }

    const address = device.addresses[0] || device.host;
    const port = device.port;
    const cpath = device.txt?.CPath || '/';

    this.homey.log(`Waking device ${deviceName} at ${address}:${port}${cpath}`);

    // First, get the device's info (deviceId, publicKey)
    const deviceInfo = await this._getDeviceInfo(address, port, cpath);
    this.homey.log(`Target device info: deviceID=${deviceInfo.deviceID}, has publicKey=${!!deviceInfo.publicKey}`);

    // Generate new DH keys for this exchange
    const dhKeys = this._generateDHKeys();

    // Encrypt our credentials for the target device
    const encryptedBlob = this._encryptCredentialsForDevice(
      credentials.userName,
      credentials.decrypted.authType,
      credentials.decrypted.authData,
      deviceInfo.deviceID,
      deviceInfo.publicKey,
      dhKeys
    );

    // Send addUser request to wake the device
    await this._sendAddUserEncrypted(address, port, cpath, credentials.userName, encryptedBlob, dhKeys.publicKey);

    this.homey.log(`Device ${deviceName} wake request sent successfully`);
  }

  /**
   * Encrypt credentials for a target device
   * Reverse of the decryption process
   */
  _encryptCredentialsForDevice(userName, authType, authDataBase64, targetDeviceId, targetPublicKeyBase64, dhKeys) {
    this.homey.log(`Encrypting credentials for device: ${targetDeviceId}`);

    const authData = Buffer.from(authDataBase64, 'base64');

    // Step 1: Build the credential blob in binary format
    const credentialBlob = this._buildCredentialBlob(userName, authType, authData);
    this.homey.log(`Built credential blob: ${credentialBlob.length} bytes`);

    // Step 2: Encrypt with target deviceId (AES-192-ECB + XOR)
    const deviceEncrypted = this._encryptWithDeviceId(credentialBlob, targetDeviceId, userName);
    this.homey.log(`Device-encrypted: ${deviceEncrypted.length} bytes`);

    // Step 3: Base64 encode
    const base64Encoded = deviceEncrypted.toString('base64');

    // Step 4: Encrypt with DH (AES-128-CTR + MAC)
    const targetPublicKey = Buffer.from(targetPublicKeyBase64, 'base64');
    const finalBlob = this._encryptWithDH(Buffer.from(base64Encoded), targetPublicKey, dhKeys);
    this.homey.log(`Final encrypted blob: ${finalBlob.length} bytes`);

    return finalBlob.toString('base64');
  }

  /**
   * Build credential blob in the format expected by Spotify
   * Format from spotifywebapipython BlobBuilder:
   * - 0x49 ('I') eye-catcher
   * - length-prefixed userName
   * - 0x50 ('P') eye-catcher
   * - authType as 1-or-2 byte int
   * - 0x51 ('Q') eye-catcher
   * - length-prefixed authData
   */
  _buildCredentialBlob(userName, authType, authData) {
    const userNameBuf = Buffer.from(userName, 'utf8');
    const parts = [];

    // Eye-catcher 'I' (0x49) before username
    parts.push(Buffer.from([0x49]));

    // Length-prefixed userName
    parts.push(this._writeInt(userNameBuf.length));
    parts.push(userNameBuf);

    // Eye-catcher 'P' (0x50) before auth type
    parts.push(Buffer.from([0x50]));

    // Auth type
    parts.push(this._writeInt(authType));

    // Eye-catcher 'Q' (0x51) before auth data
    parts.push(Buffer.from([0x51]));

    // Length-prefixed authData
    parts.push(this._writeInt(authData.length));
    parts.push(authData);

    return Buffer.concat(parts);
  }

  /**
   * Write integer in 1-or-2 byte format
   */
  _writeInt(value) {
    if (value < 128) {
      return Buffer.from([value]);
    }
    return Buffer.from([
      (value & 0x7f) | 0x80,
      (value >> 7) & 0xff
    ]);
  }

  /**
   * Encrypt blob with deviceId (AES-192-ECB + XOR)
   * Reverse of _decryptWithDeviceId
   */
  _encryptWithDeviceId(plainBlob, deviceId, userName) {
    // Pad to multiple of 16 bytes for AES
    const paddedLength = Math.ceil(plainBlob.length / 16) * 16;
    const padded = Buffer.alloc(paddedLength);
    plainBlob.copy(padded);

    // Step 1: Reverse XOR transformation
    // Original: data[l - i - 1] ^= data[l - i - 0x11]
    // Reverse: apply in forward order
    const l = padded.length;
    for (let i = l - 0x10 - 1; i >= 0; i--) {
      padded[l - i - 1] ^= padded[l - i - 0x11];
    }

    // Step 2: Derive key (same as decryption)
    const secret = crypto.createHash('sha1').update(deviceId).digest();
    const pbkdf2Output = crypto.pbkdf2Sync(secret, userName, 256, 20, 'sha1');
    const hashedKey = crypto.createHash('sha1').update(pbkdf2Output).digest();
    const key24 = Buffer.alloc(24);
    hashedKey.copy(key24, 0);
    key24.writeUInt32BE(20, 20);

    // Step 3: Encrypt using AES-192-ECB
    const cipher = crypto.createCipheriv('aes-192-ecb', key24, null);
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);

    return encrypted;
  }

  /**
   * Encrypt blob with DH (AES-128-CTR + MAC)
   * Reverse of first layer decryption
   */
  _encryptWithDH(plaintext, targetPublicKey, dhKeys) {
    // Compute shared secret
    const sharedSecret = dhKeys.dh.computeSecret(targetPublicKey);

    // Derive keys
    const sharedSecretHash = crypto.createHash('sha1').update(sharedSecret).digest();
    const baseKey = sharedSecretHash.slice(0, 16);
    const checksumKey = crypto.createHmac('sha1', baseKey).update('checksum').digest();
    const encryptionKey = crypto.createHmac('sha1', baseKey).update('encryption').digest().slice(0, 16);

    // Generate random IV
    const iv = crypto.randomBytes(16);

    // Encrypt with AES-128-CTR
    const cipher = crypto.createCipheriv('aes-128-ctr', encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

    // Compute MAC
    const mac = crypto.createHmac('sha1', checksumKey).update(ciphertext).digest();

    // Combine: IV + ciphertext + MAC
    return Buffer.concat([iv, ciphertext, mac]);
  }

  /**
   * Send encrypted addUser request to a device
   */
  async _sendAddUserEncrypted(host, port, cpath, userName, blobBase64, clientKeyBase64) {
    return new Promise((resolve, reject) => {
      const formData = new URLSearchParams({
        action: 'addUser',
        userName: userName,
        blob: blobBase64,
        clientKey: clientKeyBase64
      }).toString();

      const options = {
        hostname: host,
        port: port,
        path: cpath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(formData)
        }
      };

      this.homey.log(`Sending wake request to ${host}:${port}${cpath}`);

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          this.homey.log(`Wake response: ${data}`);
          try {
            const response = JSON.parse(data);
            if (response.status === 101) {
              resolve(response);
            } else {
              reject(new Error(`Device rejected credentials: ${response.statusString || response.status}`));
            }
          } catch (e) {
            reject(new Error(`Invalid response from device: ${data}`));
          }
        });
      });

      req.on('error', (err) => {
        this.homey.error(`Wake request error: ${err.message}`);
        reject(err);
      });

      req.write(formData);
      req.end();
    });
  }

  /**
   * Wake a device by hostname/IP directly (for testing)
   * @param {string} host - Hostname or IP address
   * @param {number} port - Port number (default 4070)
   * @param {string} cpath - Optional CPath from mDNS discovery (e.g. '/', '/zc')
   */
  async wakeDeviceByHost(host, port = 4070, cpath = null) {
    const credentials = this.getStoredCredentials();
    if (!credentials || !credentials.decrypted) {
      throw new Error('No decrypted credentials. Please pair first.');
    }

    this.homey.log(`Waking device at ${host}:${port}${cpath ? ` (CPath: ${cpath})` : ''}`);

    // If CPath provided, try it first, then fall back to common paths
    const paths = cpath ? [cpath, '/zc', '/zeroconf', '/', '/spotify'] : ['/zc', '/zeroconf', '/', '/spotify'];
    // Remove duplicates
    const uniquePaths = [...new Set(paths)];

    let deviceInfo = null;
    let workingPath = null;

    for (const tryPath of uniquePaths) {
      try {
        deviceInfo = await this._getDeviceInfo(host, port, tryPath);
        // Check if we got a valid response (status 101 = OK)
        if (deviceInfo.status === 101 && deviceInfo.deviceID) {
          workingPath = tryPath;
          this.homey.log(`Found device at ${tryPath}: ${deviceInfo.remoteName}, deviceID=${deviceInfo.deviceID}`);
          break;
        } else {
          this.homey.log(`Path ${tryPath} returned status ${deviceInfo.status}: ${deviceInfo.statusString}`);
        }
      } catch (err) {
        this.homey.log(`Path ${tryPath} failed: ${err.message}`);
      }
    }

    if (!workingPath || !deviceInfo?.deviceID) {
      throw new Error(`Could not find working ZeroConf path on device at ${host}:${port}. Tried: ${uniquePaths.join(', ')}`);
    }

    this.homey.log(`Target device: ${deviceInfo.remoteName}, deviceID=${deviceInfo.deviceID}, path=${workingPath}`);
    this.homey.log(`Active user on device: ${deviceInfo.activeUser || 'none'}`);

    // If there's already an active user, disconnect first
    if (deviceInfo.activeUser) {
      this.homey.log(`Disconnecting current user: ${deviceInfo.activeUser}`);
      await this._disconnectDevice(host, port, workingPath);
      // Wait a moment for disconnect to process
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Generate new DH keys
    const dhKeys = this._generateDHKeys();

    // Encrypt credentials for target device
    const encryptedBlob = this._encryptCredentialsForDevice(
      credentials.userName,
      credentials.decrypted.authType,
      credentials.decrypted.authData,
      deviceInfo.deviceID,
      deviceInfo.publicKey,
      dhKeys
    );

    // Send addUser request
    await this._sendAddUserEncrypted(host, port, workingPath, credentials.userName, encryptedBlob, dhKeys.publicKey);

    // Wait for device to process the login (like HA does)
    this.homey.log('Waiting for device to process login...');
    await new Promise(resolve => setTimeout(resolve, 1000));

    this.homey.log(`Device at ${host}:${port} wake request sent successfully`);
    return { success: true, deviceName: deviceInfo.remoteName, deviceID: deviceInfo.deviceID };
  }

  /**
   * Disconnect/logout the current user from a device
   */
  async _disconnectDevice(host, port, cpath) {
    return new Promise((resolve, reject) => {
      const formData = new URLSearchParams({
        action: 'resetUsers'
      }).toString();

      const options = {
        hostname: host,
        port: port,
        path: cpath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(formData)
        }
      };

      this.homey.log(`Sending disconnect request to ${host}:${port}${cpath}`);

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          this.homey.log(`Disconnect response: ${data}`);
          try {
            const response = JSON.parse(data);
            if (response.status === 101) {
              resolve(response);
            } else {
              // Some devices may not support resetUsers, continue anyway
              this.homey.log(`Disconnect returned status ${response.status}, continuing...`);
              resolve(response);
            }
          } catch (e) {
            resolve({ status: 0, statusString: 'Unknown response' });
          }
        });
      });

      req.on('error', (err) => {
        this.homey.log(`Disconnect error: ${err.message}, continuing...`);
        resolve({ status: 0, error: err.message });
      });

      req.write(formData);
      req.end();
    });
  }

  /**
   * Get device info (including public key) from a Spotify Connect device
   */
  async _getDeviceInfo(host, port, cpath) {
    return new Promise((resolve, reject) => {
      // Include version parameter like the Spotify mobile app does
      const url = `http://${host}:${port}${cpath}?action=getInfo&version=2.9.0`;
      this.homey.log(`Getting device info from: ${url}`);

      http.get(url, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            this.homey.log(`Device info response: ${data.slice(0, 500)}`);
            const info = JSON.parse(data);
            this.homey.log(`Parsed device info keys: ${Object.keys(info).join(', ')}`);
            resolve(info);
          } catch (e) {
            reject(new Error(`Invalid response from device: ${data.slice(0, 200)}`));
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
