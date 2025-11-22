import net from 'net';

/**
 * Check if PostgreSQL connection URL is valid and reachable
 */
export async function canConnectToPostgres(connectionUrl, timeout = 5000) {
  if (!connectionUrl || !connectionUrl.startsWith('postgresql://')) {
    return false;
  }

  try {
    // Parse URL to extract host and port
    const url = new URL(connectionUrl);
    const host = url.hostname;
    const port = parseInt(url.port || '5432', 10);

    return await checkTcpConnection(host, port, timeout);
  } catch (error) {
    console.warn('Invalid PostgreSQL URL:', error.message);
    return false;
  }
}

/**
 * Check if TCP connection can be established
 */
function checkTcpConnection(host, port, timeout) {
  return new Promise((resolve) => {
    const socket = new net.Socket();

    const cleanup = () => {
      socket.destroy();
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeout);

    socket.once('connect', () => {
      clearTimeout(timer);
      cleanup();
      resolve(true);
    });

    socket.once('error', () => {
      clearTimeout(timer);
      cleanup();
      resolve(false);
    });

    socket.connect(port, host);
  });
}

/**
 * Auto-detect database URL
 *
 * Priority:
 * 1. External PostgreSQL (if reachable)
 * 2. Embedded PGlite server (start if needed)
 */
export async function autoDetect({
  externalUrl,
  embeddedDataDir,
  embeddedPort = null,
  timeout = 5000
}) {
  // Try external PostgreSQL first
  if (externalUrl && externalUrl.startsWith('postgresql://')) {
    console.log('🔍 Checking external PostgreSQL connection...');

    if (await canConnectToPostgres(externalUrl, timeout)) {
      console.log('✅ Using external PostgreSQL');
      return {
        type: 'external',
        url: externalUrl,
        embedded: false
      };
    }

    console.warn('⚠️  External PostgreSQL unreachable, falling back to embedded');
  }

  // Start embedded server
  console.log('🚀 Starting embedded PGlite server...');

  const { getOrStart } = await import('./index.js');

  const instance = await getOrStart({
    dataDir: embeddedDataDir,
    port: embeddedPort,
    autoPort: true
  });

  console.log(`✅ Using embedded PGlite on port ${instance.port}`);

  return {
    type: 'embedded',
    url: instance.connectionUrl,
    embedded: true,
    port: instance.port,
    dataDir: instance.dataDir
  };
}
