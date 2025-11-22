# @namastexlabs/pglite-embedded-server

Multi-instance PostgreSQL embedded server using PGlite - zero config, auto-port allocation, perfect for development and embedded apps.

## ✨ Features

- 🚀 **Zero Configuration** - Auto-tuned for your hardware (CPU, RAM)
- 🔌 **Multi-Instance** - Run multiple isolated databases simultaneously
- 📦 **Auto-Port Allocation** - Smart port management (12000-12999 range)
- ⚡ **High Performance** - MVCC, row-level locking, concurrent writes
- 🎯 **PostgreSQL Compatible** - Full PostgreSQL 17.5 WASM
- 🔄 **Dev = Prod** - Same code, auto-adapts to environment
- 🛡️ **Lock-Free** - No more SQLite `EBUSY` errors
- 📊 **Benchmarked** - Tested against SQLite and PostgreSQL

## 🎯 Use Cases

### Perfect For

- 🧪 **Development** - Local PostgreSQL without Docker
- 📱 **Desktop Apps** - Electron, Tauri with embedded database
- 🤖 **AI Agents** - Persistent sessions, memory, state
- 🔬 **Testing** - Fast, isolated test databases
- 📦 **NPM Packages** - Embed PostgreSQL in your library

### Real-World Examples

- **Hive Agents**: Multiple agents writing sessions concurrently (no locks!)
- **Evolution API**: WhatsApp message storage with high throughput
- **Desktop Apps**: Embed PostgreSQL without external dependencies

## 📊 Performance vs SQLite

| Workload            | SQLite  | PGlite  | Improvement |
|---------------------|---------|---------|-------------|
| Concurrent Writes   | 120 qps | 980 qps | **8.2x**    |
| Mixed Workload      | 800 qps | 3500 qps| **4.4x**    |
| Lock Errors         | 45      | 0       | **∞**       |

*See [benchmarks](./tests/benchmarks/results/) for detailed results*

## 🚀 Quick Start

### Installation

```bash
npm install @namastexlabs/pglite-embedded-server
# or
pnpm add @namastexlabs/pglite-embedded-server
```

### Basic Usage

```javascript
import { getOrStart } from '@namastexlabs/pglite-embedded-server';

// Start server (auto-allocates port)
const server = await getOrStart({
  dataDir: './data/my-database'
});

console.log(`PostgreSQL running on ${server.connectionUrl}`);
// postgresql://localhost:12000

// Use with any PostgreSQL client
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: server.connectionUrl
});

await pool.query('CREATE TABLE users (id SERIAL, name TEXT)');
```

### Auto-Detection (External vs Embedded)

```javascript
import { autoDetect } from '@namastexlabs/pglite-embedded-server';

// Tries external PostgreSQL first, falls back to embedded
const config = await autoDetect({
  externalUrl: process.env.DATABASE_URL,       // Try this first
  embeddedDataDir: './data/embedded-db'        // Fallback
});

console.log(config.url);        // Connection URL to use
console.log(config.type);       // 'external' or 'embedded'
console.log(config.embedded);   // true if using embedded
```

## 📖 API Reference

### `getOrStart(options)`

Start a server instance or reuse existing one.

```javascript
const server = await getOrStart({
  dataDir: './data/my-db',    // Required: Data directory
  port: 12000,                // Optional: Preferred port
  autoPort: true,             // Optional: Auto-allocate if unavailable (default: true)
  logLevel: 'info'            // Optional: error, warn, info, debug (default: info)
});

// Returns:
// {
//   port: 12000,
//   dataDir: '/absolute/path/to/data/my-db',
//   pid: 12345,
//   connectionUrl: 'postgresql://localhost:12000',
//   config: { cpus, workers, poolSize, ... }
// }
```

### `startServer(options)`

Start a new server instance (fails if already running).

```javascript
const server = await startServer({
  dataDir: './data/my-db',
  port: 12000,
  logLevel: 'info'
});
```

### `stopServer(options)`

Stop a running server instance.

```javascript
// Stop by data directory
await stopServer({ dataDir: './data/my-db' });

// Stop by port
await stopServer({ port: 12000 });
```

### `autoDetect(options)`

Auto-detect database configuration (external vs embedded).

```javascript
const config = await autoDetect({
  externalUrl: 'postgresql://localhost:5432/mydb',  // Try first
  embeddedDataDir: './data/embedded',               // Fallback
  embeddedPort: 12000,                              // Optional
  timeout: 5000                                     // Connection timeout (ms)
});
```

### `list()`

List all running instances.

```javascript
const instances = list();
// [
//   {
//     dataDir: '/path/to/data',
//     port: 12000,
//     pid: 12345,
//     started: '2025-11-22T18:00:00Z',
//     version: '17.5'
//   }
// ]
```

### `findByDataDir(dataDir)`

Find instance by data directory.

```javascript
const instance = findByDataDir('./data/my-db');
// { port, pid, started, version } or null
```

### `findByPort(port)`

Find instance by port.

```javascript
const instance = findByPort(12000);
// { dataDir, port, pid, started, version } or null
```

### `cleanup()`

Remove stale instances from registry (dead processes).

```javascript
const cleaned = cleanup();
console.log(`Cleaned up ${cleaned} stale instances`);
```

## 🔧 CLI Usage

### Install Globally

```bash
npm install -g @namastexlabs/pglite-embedded-server
```

### Commands

```bash
# Start server
pglite-server start ./data/my-db
pglite-server start ./data/my-db --port 12000 --log debug

# List instances
pglite-server list

# Get connection URL
pglite-server url ./data/my-db

# Check health
pglite-server health ./data/my-db
pglite-server health --port 12000

# Stop instance
pglite-server stop ./data/my-db
pglite-server stop --port 12000
pglite-server stop --all

# Port info
pglite-server info

# Cleanup stale instances
pglite-server cleanup
```

## 🎛️ Adaptive Mode

The server auto-tunes based on your hardware:

```
🎛️  Auto-tuned configuration:
   • CPUs: 8 (using 4 workers)
   • Memory: 16.0GB total, 8.5GB free
   • Pool size: 20 connections
   • Cache: 512MB
```

**Dev Laptop (4 cores, 8GB)**
- 2 workers, pool=10, cache=256MB

**Prod Server (16 cores, 32GB)**
- 8 workers, pool=20, cache=512MB

**Same code, optimal performance everywhere!**

## 🔐 Architecture

### Port Range

- **Range**: 12000-12999 (1000 available ports)
- **Auto-allocation**: Finds next available port
- **Reuse**: Same data directory = same port
- **Registry**: `~/.pglite-server/registry.json`

### Instance Isolation

Each data directory = 1 isolated PostgreSQL instance:

```
./data/app1/  → postgresql://localhost:12000
./data/app2/  → postgresql://localhost:12001
./data/test/  → postgresql://localhost:12002
```

### Lock Files

Each instance creates `.pglite-server.lock` in its data directory:

```json
{
  "pid": 12345,
  "port": 12000,
  "started": "2025-11-22T18:00:00Z"
}
```

## 📊 Benchmarks

Run benchmarks locally:

```bash
npm run bench
```

Results saved to `tests/benchmarks/results/`:
- `benchmark-results.json` - Raw data
- `benchmark-results.md` - Formatted report

## 🛠️ Development

```bash
# Clone repo
git clone https://github.com/namastexlabs/pglite-embedded-server.git
cd pglite-embedded-server

# Install dependencies
npm install

# Run benchmarks
npm run bench

# Test CLI
./bin/pglite-server.js start ./data/test-db
```

## 🤝 Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new features
4. Submit a pull request

## 📄 License

MIT License - Copyright (c) 2025 Namastex Labs

## 🙏 Credits

Built on top of:
- [PGlite](https://github.com/electric-sql/pglite) - PostgreSQL WASM by Electric SQL
- [pglite-server](https://www.npmjs.com/package/pglite-server) - PostgreSQL wire protocol

## 📧 Support

- **Issues**: [GitHub Issues](https://github.com/namastexlabs/pglite-embedded-server/issues)
- **Email**: labs@namastex.com
- **Website**: [namastex.com](https://namastex.com)

---

**Made with ❤️ by [Namastex Labs](https://namastex.com)**
