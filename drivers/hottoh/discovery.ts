import { Hottoh } from 'hottohts';
import { DiscoveryResult, DiscoveryResultMAC } from 'homey';
import util from 'util';
import net from 'net';
import os from 'os';

const sleep = util.promisify(setTimeout);

// Discovery parameters
const BASE_DISCOVERY_TIMEOUT = 120000; // 120 seconds base timeout
const PER_IP_TIMEOUT = 300; // 300ms per IP to scan
const MAX_DISCOVERY_TIMEOUT = 300000; // 5 minutes max
const DISCOVERY_COOLDOWN = 5000; // 5 seconds cooldown between discoveries
const TCP_CHECK_TIMEOUT = 1500; // 1.5 seconds TCP check timeout
const CONCURRENT_SCANS = 32; // Number of concurrent IP scans
const PROGRESS_INTERVAL = 5000; // Log progress every 5 seconds
const MAX_DATA_WAIT_ATTEMPTS = 8; // Maximum attempts to wait for stove data

// Discovery lock mechanism
let isDiscoveryRunning = false;
let lastDiscoveryTimestamp = 0;

interface HottohResult {
  data: {
    id: string;  // Unique ID for Homey device
    address: string;  // IP address
  };
  name: string;  // Display name
  settings: {
    ipAddress: string;  // User-editable IP address
    port: number;  // Port for stove connection
    deviceName?: string; // Optional custom device name
  };
  store: {
    lastTemperature?: number;  // Latest temperature reading
    isOn?: boolean;  // Power state
    address?: string;  // Backup of the IP address
  };
}

interface HottohClient {
  _info: any[];
  _data: any[];
  _data2: any[];
}

interface HottohStove {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  client?: HottohClient;
}

/**
 * Calculate discovery timeout based on total IPs to scan
 */
function calculateDiscoveryTimeout(totalIPs: number): number {
  const calculatedTimeout = BASE_DISCOVERY_TIMEOUT + (totalIPs * PER_IP_TIMEOUT);
  return Math.min(calculatedTimeout, MAX_DISCOVERY_TIMEOUT);
}

/**
 * Check if a TCP port is open on the specified host
 */
function checkTcpPort(host: string, port: number, timeout: number = TCP_CHECK_TIMEOUT): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);

    socket.on('connect', () => {
      socket.destroy();
      resolve();
    });

    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Timeout'));
    });

    socket.on('error', (err) => {
      socket.destroy();
      reject(err);
    });

    socket.connect(port, host);
  });
}

/**
 * Get all local IPv4 subnets
 */
function getLocalSubnets(): { subnet: string, netmask: string }[] {
  const interfaces = os.networkInterfaces();
  const subnets: { subnet: string, netmask: string }[] = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;

    for (const addr of addrs) {
      // Only look at IPv4 addresses
      if (addr.family === 'IPv4' && !addr.internal) {
        // Extract the subnet from the IP and netmask
        const parts = addr.address.split('.');
        const subnet = parts.slice(0, 3).join('.');
        subnets.push({ subnet, netmask: addr.netmask });
      }
    }
  }

  return subnets;
}

/**
 * Get all IPs in a subnet
 */
function getIPsInSubnet(subnet: string): string[] {
  const ips: string[] = [];
  // Generate all possible host addresses (1-254)
  for (let i = 1; i <= 254; i++) {
    ips.push(`${subnet}.${i}`);
  }
  return ips;
}

/**
 * Parse numeric values from various data sources
 */
function parseNumericValue(value: string | null): number | null {
  if (value === null) return null;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Wait for valid data from stove
 */
async function waitForData(stove: HottohStove, ip: string, maxAttempts = MAX_DATA_WAIT_ATTEMPTS): Promise<boolean> {
  let attempts = 0;
  while (attempts < maxAttempts) {
    const stoveInfo = stove?.client?.['_info'];
    const stoveData = stove?.client?.['_data'];
    const stoveData2 = stove?.client?.['_data2'];

    // Check if we have valid data arrays
    if (Array.isArray(stoveData) && stoveData.length >= 7 && Array.isArray(stoveInfo) && stoveInfo.length > 0) {
      // Wait a bit longer after data arrives to ensure it's stable
      await sleep(1000);

      // Check again to ensure data is still valid
      const finalData = stove?.client?.['_data'];
      if (Array.isArray(finalData) && finalData.length >= 7) {
        // Additional validation - ensure temperature reading is present
        if (finalData[21] != null) {
          return true;
        }
      }
    }

    await sleep(2000);
    attempts++;
  }
  return false;
}

async function checkIP(ip: string, results: HottohResult[]): Promise<void> {
  let stove: HottohStove | null = null;
  const scanStartTime = Date.now();

  try {
    // Increased TCP port check timeout
    try {
      await checkTcpPort(ip, 5001, TCP_CHECK_TIMEOUT);
    } catch (error: any) {
      // This is an expected case for non-stove IPs, just return
      return;
    }

    // Initialize and connect to stove
    stove = new Hottoh(ip, 5001, 0) as unknown as HottohStove;
    await stove.connect();

    // Wait for data arrays to be populated through polling
    const hasData = await waitForData(stove, ip);

    if (!hasData) {
      return;
    }

    // Access and validate internal data arrays with safe null checks
    const stoveData = stove?.client?.['_data'];
    const stoveInfo = stove?.client?.['_info'];
    const stoveData2 = stove?.client?.['_data2'];

    if (!Array.isArray(stoveData) || stoveData.length < 22) {
      return;
    }

    // Parse stove state with safe array access
    const temperatureStr = stoveData[21];
    const stoveIsOnStr = stoveData[6];

    // More strict validation of temperature value
    const temperature = parseNumericValue(temperatureStr);
    if (temperature === null || temperature < 0 || temperature > 600) {
      return;
    }

    const isOn = stoveIsOnStr === '1' || stoveIsOnStr === 'true' || stoveIsOnStr === 'on';

    // Create discovery result with more details
    const uniqueId = ip.replace(/\./g, '_');
    const result: HottohResult = {
      name: `HottoH Stove (${ip})`,
      data: {
        id: uniqueId,
        address: ip
      },
      settings: {
        ipAddress: ip,
        port: 5001,
        deviceName: '' // Add empty deviceName setting that can be customized later
      },
      store: {
        lastTemperature: temperature,
        isOn,
        address: ip  // Store address as backup
      }
    };

    results.push(result);
  } finally {
    if (stove) {
      try {
        await stove.disconnect();
      } catch (e) {
        // Ignore disconnect errors
      }
    }
  }
}

async function processIPQueue(queue: string[], results: HottohResult[], queueStartTime: number, discoveryTimeout: number): Promise<void> {
  const active = new Set<Promise<void>>(); // Track active promises
  const processed = new Set<string>(); // Track processed IPs
  const subnet = queue[0].split('.').slice(0, 3).join('.'); // Get subnet from first IP
  let lastProgressLog = 0;

  while (queue.length > 0 || active.size > 0) {
    // Check timeout
    const elapsed = Date.now() - queueStartTime;
    if (elapsed > discoveryTimeout) {
      return;
    }

    // Fill up to CONCURRENT_SCANS active promises
    while (queue.length > 0 && active.size < CONCURRENT_SCANS) {
      const ip = queue.shift()!;
      const promise = checkIP(ip, results)
        .catch(error => {
          // Ignore errors
        })
        .finally(() => {
          active.delete(promise);
          processed.add(ip);
        });

      active.add(promise);
    }

    // Log progress periodically
    const now = Date.now();
    if (now - lastProgressLog >= PROGRESS_INTERVAL) {
      lastProgressLog = now;
    }

    // If we found any stoves and processed a significant portion, we can return
    if (results.length > 0 && processed.size > (queue.length + processed.size) / 4) {
      return;
    }

    // Wait for at least one promise to complete if we have any active
    if (active.size > 0) {
      await Promise.race(active);
    }
  }
}

export async function discoverStoves(manualIPs?: string[]): Promise<HottohResult[]> {
  // Check if discovery is already running or in cooldown
  const currentTime = Date.now();
  if (isDiscoveryRunning) {
    return [];
  }
  if (currentTime - lastDiscoveryTimestamp < DISCOVERY_COOLDOWN) {
    return [];
  }

  isDiscoveryRunning = true;
  lastDiscoveryTimestamp = currentTime;

  try {
    const discoveryResults: HottohResult[] = [];
    const discoveryStartTime = Date.now();

    // If manual IPs provided, just scan those
    if (manualIPs && manualIPs.length > 0) {
      const discoveryTimeout = calculateDiscoveryTimeout(manualIPs.length);
      await processIPQueue(manualIPs, discoveryResults, discoveryStartTime, discoveryTimeout);
      return discoveryResults;
    }

    // Get all local subnets
    const subnets = getLocalSubnets();
    if (subnets.length === 0) {
      return [];
    }

    // Calculate total IPs and timeout
    let totalIPs = 0;
    const allQueues: string[][] = [];
    for (const { subnet } of subnets) {
      const ips = getIPsInSubnet(subnet);
      totalIPs += ips.length;
      allQueues.push(ips);
    }
    const discoveryTimeout = calculateDiscoveryTimeout(totalIPs);

    // Process each subnet's queue
    for (let i = 0; i < subnets.length; i++) {
      const { subnet, netmask } = subnets[i];
      const queue = allQueues[i];

      await processIPQueue(queue, discoveryResults, discoveryStartTime, discoveryTimeout);

      if (discoveryResults.length > 0) {
        break;
      }
    }

    return discoveryResults;
  } finally {
    isDiscoveryRunning = false;
  }
}
