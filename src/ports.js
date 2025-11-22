import net from 'net';
import { loadRegistry } from './registry.js';

const PORT_RANGE_START = 12000;
const PORT_RANGE_END = 12999;

/**
 * Check if a port is available
 */
export function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(false);
      }
    });

    server.once('listening', () => {
      server.close();
      resolve(true);
    });

    server.listen(port, '127.0.0.1');
  });
}

/**
 * Check if port is in registry (even if process is dead)
 */
function isPortInRegistry(port) {
  const registry = loadRegistry();

  for (const instance of Object.values(registry.instances)) {
    if (instance.port === port) {
      return true;
    }
  }

  return false;
}

/**
 * Allocate a port for a data directory
 *
 * Priority:
 * 1. If instance already running, return its port
 * 2. Try preferred port (if provided)
 * 3. Find next available port in range
 */
export async function allocatePort(dataDir, preferredPort = null) {
  const registry = loadRegistry();

  // Check if instance already exists for this dataDir
  const existing = registry.instances[dataDir];
  if (existing) {
    // Verify process is still running
    try {
      process.kill(existing.pid, 0);
      console.log(`Instance already running for ${dataDir} on port ${existing.port}`);
      return existing.port;
    } catch {
      // Process dead, continue allocation
      console.log(`Stale instance found for ${dataDir}, reallocating port`);
    }
  }

  // Try preferred port first
  if (preferredPort !== null) {
    if (preferredPort < PORT_RANGE_START || preferredPort > PORT_RANGE_END) {
      throw new Error(
        `Preferred port ${preferredPort} outside allowed range ${PORT_RANGE_START}-${PORT_RANGE_END}`
      );
    }

    if (await isPortFree(preferredPort) && !isPortInRegistry(preferredPort)) {
      return preferredPort;
    }

    console.warn(`Preferred port ${preferredPort} unavailable, auto-allocating...`);
  }

  // Find next available port
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    if ((await isPortFree(port)) && !isPortInRegistry(port)) {
      return port;
    }
  }

  throw new Error(
    `No available ports in range ${PORT_RANGE_START}-${PORT_RANGE_END}. ` +
    `Stop unused instances with 'pglite-server stop --all'`
  );
}

/**
 * Get port range info
 */
export function getPortRangeInfo() {
  const registry = loadRegistry();
  const usedPorts = Object.values(registry.instances).map((i) => i.port);

  return {
    start: PORT_RANGE_START,
    end: PORT_RANGE_END,
    total: PORT_RANGE_END - PORT_RANGE_START + 1,
    used: usedPorts.length,
    available: PORT_RANGE_END - PORT_RANGE_START + 1 - usedPorts.length,
    usedPorts
  };
}
