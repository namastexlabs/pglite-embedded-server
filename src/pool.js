/**
 * PGlite Instance Pool (Performance Optimized)
 *
 * Manages multiple PGlite instances (one per database)
 * Handles lazy initialization, connection locking, and cleanup
 *
 * IMPORTANT: PGlite + pglite-socket only supports ONE active connection
 * per database at a time. Concurrent connections will queue and wait.
 *
 * Performance Optimizations:
 * - Fast Map-based lookups (O(1) access)
 * - Minimal memory overhead per instance
 * - Pino structured logging
 * - Short wait timeouts for fast failure
 */

import { PGlite } from '@electric-sql/pglite';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';

/**
 * Wrapper for PGlite instance with connection management
 */
class ManagedInstance extends EventEmitter {
  constructor(dbName, dataDir, logger, memoryMode = false) {
    super();
    this.dbName = dbName;
    this.dataDir = dataDir;
    this.memoryMode = memoryMode;
    this.logger = logger;
    this.db = null;
    this.locked = false;
    this.activeSocket = null;
    this.queue = [];
    this.createdAt = Date.now();
    this.lastAccess = Date.now();

    this.setMaxListeners(100);
  }

  /**
   * Initialize PGlite instance (lazy)
   */
  async initialize() {
    if (this.db) {
      return this.db;
    }

    const initStart = Date.now();

    if (this.memoryMode) {
      this.logger.debug({ dbName: this.dbName, mode: 'memory' }, 'Initializing in-memory PGlite instance');
      this.db = new PGlite();
    } else {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }

      this.logger.debug({ dbName: this.dbName, dataDir: this.dataDir }, 'Initializing PGlite instance');
      this.db = new PGlite(this.dataDir);
    }

    await this.db.waitReady;

    const initTime = Date.now() - initStart;
    this.logger.info({
      dbName: this.dbName,
      dataDir: this.memoryMode ? '(in-memory)' : this.dataDir,
      memoryMode: this.memoryMode,
      initTimeMs: initTime
    }, 'PGlite instance initialized');

    this.emit('initialized', this.dbName);
    return this.db;
  }

  /**
   * Lock instance to a socket (one connection at a time)
   */
  lock(socket) {
    if (this.locked) {
      throw new Error(`Instance ${this.dbName} is already locked`);
    }

    this.locked = true;
    this.activeSocket = socket;
    this.lastAccess = Date.now();

    // Auto-unlock when socket closes
    const unlock = () => this.unlock();
    socket.once('close', unlock);
    socket.once('error', unlock);

    this.emit('locked', this.dbName);
  }

  /**
   * Unlock instance (connection closed)
   */
  unlock() {
    this.locked = false;
    this.activeSocket = null;
    this.lastAccess = Date.now();

    this.emit('unlocked', this.dbName);

    // Process next waiting connection
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next.resolve(this);
    }
  }

  /**
   * Wait for instance to be free (with short timeout)
   */
  async waitForFree(timeout = 5000) {
    if (!this.locked) {
      return this;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.findIndex((item) => item.resolve === resolve);
        if (idx !== -1) this.queue.splice(idx, 1);
        reject(new Error(`Database ${this.dbName} busy - try again`));
      }, timeout);

      this.queue.push({
        resolve: (instance) => {
          clearTimeout(timer);
          resolve(instance);
        },
        reject
      });
    });
  }

  /**
   * Close PGlite instance
   */
  async close() {
    if (this.db) {
      try {
        await this.db.close();
      } catch (error) {
        if (error.name !== 'ExitStatus') {
          console.error(`Error closing instance ${this.dbName}:`, error.message);
        }
      }
    }

    this.db = null;
    this.emit('closed', this.dbName);
  }

  /**
   * Get instance stats
   */
  getStats() {
    return {
      dbName: this.dbName,
      locked: this.locked,
      queueLength: this.queue.length,
      uptime: Date.now() - this.createdAt,
      lastAccess: Date.now() - this.lastAccess
    };
  }
}

/**
 * PGlite Instance Pool
 */
export class InstancePool extends EventEmitter {
  constructor(options = {}) {
    super();
    this.baseDir = options.baseDir || './data';
    this.memoryMode = options.memoryMode || false;
    this.maxInstances = options.maxInstances || 100;
    this.autoProvision = options.autoProvision !== false;
    this.instances = new Map();
    this.logger = options.logger;

    this.setMaxListeners(this.maxInstances + 10);
  }

  /**
   * Get or create PGlite instance for database
   */
  async getOrCreate(dbName) {
    let instance = this.instances.get(dbName);

    if (!instance) {
      if (this.instances.size >= this.maxInstances) {
        this.logger.error({
          dbName,
          currentInstances: this.instances.size,
          maxInstances: this.maxInstances
        }, 'Maximum instances limit reached');

        throw new Error(
          `Maximum instances limit reached (${this.maxInstances}). ` +
            `Cannot create database: ${dbName}`
        );
      }

      if (!this.autoProvision) {
        this.logger.warn({ dbName }, 'Database does not exist (auto-provision disabled)');
        throw new Error(`Database ${dbName} does not exist (auto-provision disabled)`);
      }

      const dataDir = this.memoryMode ? null : path.join(this.baseDir, dbName);
      instance = new ManagedInstance(
        dbName,
        dataDir,
        this.logger.child({ dbName }),
        this.memoryMode
      );

      instance.on('initialized', (name) => this.emit('instance-created', name));
      instance.on('locked', (name) => this.emit('instance-locked', name));
      instance.on('unlocked', (name) => this.emit('instance-unlocked', name));
      instance.on('closed', (name) => this.emit('instance-closed', name));

      this.instances.set(dbName, instance);
    }

    await instance.initialize();
    return instance;
  }

  /**
   * Acquire instance (lock to socket)
   * Uses short timeout (5 seconds) - clients should retry on busy
   */
  async acquire(dbName, socket, timeout = 5000) {
    const instance = await this.getOrCreate(dbName);

    // If locked, wait with short timeout
    if (instance.locked) {
      this.logger.debug({ dbName, queueLength: instance.queue.length }, 'Database busy, queueing');
      await instance.waitForFree(timeout);
    }

    // Lock to this socket
    instance.lock(socket);
    return instance;
  }

  /**
   * Get instance (without locking)
   */
  get(dbName) {
    return this.instances.get(dbName);
  }

  /**
   * List all instances
   */
  list() {
    return Array.from(this.instances.values()).map((instance) => instance.getStats());
  }

  /**
   * Close specific instance
   */
  async closeInstance(dbName) {
    const instance = this.instances.get(dbName);
    if (instance) {
      await instance.close();
      this.instances.delete(dbName);
    }
  }

  /**
   * Close all instances
   */
  async closeAll() {
    const promises = Array.from(this.instances.values()).map((instance) => instance.close());
    await Promise.all(promises);
    this.instances.clear();
  }

  /**
   * Get pool stats
   */
  getStats() {
    return {
      totalInstances: this.instances.size,
      maxInstances: this.maxInstances,
      instances: this.list()
    };
  }
}
