import { Hottoh } from 'hottohts';
import net from 'net';
import os from 'os';

// Discovery parameters
const BASE_DISCOVERY_TIMEOUT = 120000; // 120 seconds base timeout
const PER_IP_TIMEOUT = 300; // 300ms per IP to scan
const MAX_DISCOVERY_TIMEOUT = 300000; // 5 minutes max
const TCP_CHECK_TIMEOUT = 1500; // 1.5 seconds TCP check timeout
const STOVE_DATA_TIMEOUT = 10000; // Time for a host with port 5001 open to send stove data
const CONCURRENT_SCANS = 32; // Number of concurrent IP scans
const STOVE_PORT = 5001;
// Networks larger than this are not scanned in full; only the /24 around Homey's own address
const MIN_SCANNED_PREFIX = 24;

interface HottohResult {
  data: {
    id: string; // Unique ID for Homey device
    address: string; // IP address
  };
  name: string; // Display name
  settings: {
    ipAddress: string; // User-editable IP address
    deviceName?: string; // Optional custom device name
  };
  store: {
    lastTemperature?: number; // Latest temperature reading
    isOn?: boolean; // Power state
    address?: string; // Backup of the IP address
  };
}

// A second pairing session joins the discovery that is already running
let runningDiscovery: Promise<HottohResult[]> | null = null;

/**
 * Device id for a stove at the given IP. Shared with manual pairing so a stove cannot be added twice.
 */
export function getDeviceId(ip: string): string {
  return ip.replace(/\./g, '_');
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

function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc * 256) + parseInt(octet, 10), 0);
}

function intToIp(n: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(n / 2 ** shift) % 256).join('.');
}

/**
 * Host addresses to scan for every local IPv4 interface, based on its netmask.
 * Networks larger than a /24 are limited to the /24 that contains Homey's address.
 */
function getHostsToScan(): string[] {
  const hosts = new Set<string>();

  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;

      const prefix = Math.max(addr.cidr ? parseInt(addr.cidr.split('/')[1], 10) : MIN_SCANNED_PREFIX, MIN_SCANNED_PREFIX);
      if (prefix >= 31) continue; // point-to-point links have no other hosts to scan

      const size = 2 ** (32 - prefix);
      const network = Math.floor(ipToInt(addr.address) / size) * size;
      // Skip the network and broadcast addresses
      for (let host = network + 1; host < network + size - 1; host++) {
        const ip = intToIp(host);
        if (ip !== addr.address) hosts.add(ip);
      }
    }
  }

  return [...hosts];
}

/**
 * Parse numeric values from various data sources
 */
function parseNumericValue(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function checkIP(ip: string, results: HottohResult[]): Promise<void> {
  try {
    await checkTcpPort(ip, STOVE_PORT, TCP_CHECK_TIMEOUT);
  } catch {
    // This is an expected case for non-stove IPs, just return
    return;
  }

  const stove = new Hottoh(ip, STOVE_PORT);
  try {
    // Resolves once the first poll cycle (INF, DAT 0, DAT 2) has returned data
    await stove.connect(STOVE_DATA_TIMEOUT);

    const stoveData: string[] | null = stove.client['_data'];
    const stoveInfo: string[] | null = stove.client['_info'];
    if (!Array.isArray(stoveData) || stoveData.length < 22 || !Array.isArray(stoveInfo) || stoveInfo.length === 0) {
      return;
    }

    // The smoke temperature register must hold a plausible value
    const smokeTemperature = parseNumericValue(stoveData[21]);
    if (smokeTemperature === null || smokeTemperature < 0 || smokeTemperature > 6000) {
      return;
    }

    results.push({
      name: `HottoH Stove (${ip})`,
      data: {
        id: getDeviceId(ip),
        address: ip,
      },
      settings: {
        ipAddress: ip,
        deviceName: '', // Add empty deviceName setting that can be customized later
      },
      store: {
        lastTemperature: stove.getTemperatureRoom1() ?? undefined,
        isOn: stove.getIsOn() ?? undefined,
        address: ip, // Store address as backup
      },
    });
  } catch {
    // Port open but no stove data: not a stove
  } finally {
    stove.dispose();
  }
}

async function processIPQueue(queue: string[], results: HottohResult[], discoveryTimeout: number): Promise<void> {
  const startedAt = Date.now();
  const active = new Set<Promise<void>>();

  while (queue.length > 0 || active.size > 0) {
    if (Date.now() - startedAt > discoveryTimeout) {
      return;
    }

    // Fill up to CONCURRENT_SCANS active promises
    while (queue.length > 0 && active.size < CONCURRENT_SCANS) {
      const ip = queue.shift()!;
      const promise: Promise<void> = checkIP(ip, results)
        .finally(() => {
          active.delete(promise);
        });

      active.add(promise);
    }

    // Wait for at least one promise to complete
    await Promise.race(active);
  }
}

async function runDiscovery(manualIPs?: string[]): Promise<HottohResult[]> {
  const queue = manualIPs && manualIPs.length > 0 ? [...manualIPs] : getHostsToScan();
  if (queue.length === 0) {
    return [];
  }

  const results: HottohResult[] = [];
  await processIPQueue(queue, results, calculateDiscoveryTimeout(queue.length));
  // Copy so checks still finishing after a timeout don't change the returned list
  return [...results];
}

/**
 * Scan the local networks (or the given IPs) for HottoH stoves on TCP port 5001.
 * If a discovery is already running, its result is returned instead of starting a second scan.
 */
export function discoverStoves(manualIPs?: string[]): Promise<HottohResult[]> {
  if (!runningDiscovery) {
    runningDiscovery = runDiscovery(manualIPs).finally(() => {
      runningDiscovery = null;
    });
  }
  return runningDiscovery;
}
