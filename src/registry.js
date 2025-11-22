import fs from 'fs';
import path from 'path';
import os from 'os';

const REGISTRY_DIR = path.join(os.homedir(), '.pglite-server');
const REGISTRY_FILE = path.join(REGISTRY_DIR, 'registry.json');

/**
 * Ensure registry directory exists
 */
function ensureRegistryDir() {
  if (!fs.existsSync(REGISTRY_DIR)) {
    fs.mkdirSync(REGISTRY_DIR, { recursive: true });
  }
}

/**
 * Load registry from disk
 */
export function loadRegistry() {
  ensureRegistryDir();

  if (!fs.existsSync(REGISTRY_FILE)) {
    return { instances: {} };
  }

  try {
    const data = fs.readFileSync(REGISTRY_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.warn('Failed to load registry, creating new:', error.message);
    return { instances: {} };
  }
}

/**
 * Save registry to disk
 */
export function saveRegistry(registry) {
  ensureRegistryDir();
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2), 'utf-8');
}

/**
 * Register a new instance
 */
export function registerInstance(dataDir, port, pid) {
  const registry = loadRegistry();

  registry.instances[dataDir] = {
    port,
    pid,
    started: new Date().toISOString(),
    version: '17.5' // PGlite version
  };

  saveRegistry(registry);
}

/**
 * Unregister an instance
 */
export function unregisterInstance(dataDir) {
  const registry = loadRegistry();
  delete registry.instances[dataDir];
  saveRegistry(registry);
}

/**
 * Find instance by data directory
 */
export function findInstanceByDataDir(dataDir) {
  const registry = loadRegistry();
  return registry.instances[dataDir] || null;
}

/**
 * Find instance by port
 */
export function findInstanceByPort(port) {
  const registry = loadRegistry();

  for (const [dataDir, instance] of Object.entries(registry.instances)) {
    if (instance.port === port) {
      return { dataDir, ...instance };
    }
  }

  return null;
}

/**
 * List all instances
 */
export function listInstances() {
  const registry = loadRegistry();
  return Object.entries(registry.instances).map(([dataDir, instance]) => ({
    dataDir,
    ...instance
  }));
}

/**
 * Check if process is running
 */
export function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Cleanup stale instances (process not running)
 */
export function cleanupStaleInstances() {
  const registry = loadRegistry();
  let cleaned = 0;

  for (const [dataDir, instance] of Object.entries(registry.instances)) {
    if (!isProcessRunning(instance.pid)) {
      delete registry.instances[dataDir];
      cleaned++;
    }
  }

  if (cleaned > 0) {
    saveRegistry(registry);
  }

  return cleaned;
}
