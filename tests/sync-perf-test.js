#!/usr/bin/env node
/**
 * Sync Performance Impact Test
 *
 * Verifies that enabling sync has ZERO impact on hot path performance.
 * Runs identical workloads with and without sync, compares results.
 */

import { startMultiTenantServer } from '../src/index.js';
import pg from 'pg';

const ITERATIONS = 1000;
const WARMUP = 100;

async function runWorkload(port, label) {
  const client = new pg.Client({
    host: 'localhost',
    port,
    database: 'perftest',
    user: 'postgres',
    password: 'postgres'
  });

  await client.connect();

  // Create table
  await client.query('CREATE TABLE IF NOT EXISTS bench (id SERIAL PRIMARY KEY, data TEXT)');
  await client.query('TRUNCATE bench');

  // Warmup
  for (let i = 0; i < WARMUP; i++) {
    await client.query('INSERT INTO bench (data) VALUES ($1)', [`warmup-${i}`]);
  }
  await client.query('TRUNCATE bench');

  // Benchmark
  const start = process.hrtime.bigint();

  for (let i = 0; i < ITERATIONS; i++) {
    await client.query('INSERT INTO bench (data) VALUES ($1)', [`row-${i}`]);
  }

  const insertEnd = process.hrtime.bigint();
  const insertMs = Number(insertEnd - start) / 1_000_000;

  // Read benchmark
  const readStart = process.hrtime.bigint();
  for (let i = 0; i < ITERATIONS; i++) {
    await client.query('SELECT * FROM bench WHERE id = $1', [i % ITERATIONS + 1]);
  }
  const readEnd = process.hrtime.bigint();
  const readMs = Number(readEnd - readStart) / 1_000_000;

  await client.end();

  return {
    label,
    inserts: {
      total: insertMs,
      perOp: insertMs / ITERATIONS,
      opsPerSec: Math.round(ITERATIONS / (insertMs / 1000))
    },
    reads: {
      total: readMs,
      perOp: readMs / ITERATIONS,
      opsPerSec: Math.round(ITERATIONS / (readMs / 1000))
    }
  };
}

async function main() {
  console.log('='.repeat(60));
  console.log('SYNC PERFORMANCE IMPACT TEST');
  console.log('='.repeat(60));
  console.log(`Iterations: ${ITERATIONS} | Warmup: ${WARMUP}`);
  console.log();

  // Test 1: Without sync
  console.log('[1/2] Starting pgserve WITHOUT sync...');
  const serverNoSync = await startMultiTenantServer({
    port: 18001,
    logLevel: 'error'
  });

  await new Promise(r => setTimeout(r, 2000)); // Wait for server
  const resultNoSync = await runWorkload(18001, 'NO SYNC');
  await serverNoSync.stop();

  console.log('      Done.');
  console.log();

  // Test 2: With sync enabled (failing target - simulates sync overhead)
  console.log('[2/2] Starting pgserve WITH sync (failing target)...');
  const serverWithSync = await startMultiTenantServer({
    port: 18002,
    logLevel: 'error',
    syncTo: 'postgresql://dummy:dummy@localhost:59999/fake', // Intentionally failing
    syncDatabases: 'perftest'
  });

  await new Promise(r => setTimeout(r, 2000)); // Wait for server
  const resultWithSync = await runWorkload(18002, 'WITH SYNC');
  await serverWithSync.stop();

  console.log('      Done.');
  console.log();

  // Results
  console.log('='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log();

  console.log('INSERT PERFORMANCE:');
  console.log(`  Without Sync: ${resultNoSync.inserts.opsPerSec.toLocaleString()} ops/sec (${resultNoSync.inserts.perOp.toFixed(2)} ms/op)`);
  console.log(`  With Sync:    ${resultWithSync.inserts.opsPerSec.toLocaleString()} ops/sec (${resultWithSync.inserts.perOp.toFixed(2)} ms/op)`);

  const insertDiff = ((resultWithSync.inserts.opsPerSec - resultNoSync.inserts.opsPerSec) / resultNoSync.inserts.opsPerSec * 100).toFixed(2);
  console.log(`  Difference:   ${insertDiff > 0 ? '+' : ''}${insertDiff}%`);
  console.log();

  console.log('READ PERFORMANCE:');
  console.log(`  Without Sync: ${resultNoSync.reads.opsPerSec.toLocaleString()} ops/sec (${resultNoSync.reads.perOp.toFixed(2)} ms/op)`);
  console.log(`  With Sync:    ${resultWithSync.reads.opsPerSec.toLocaleString()} ops/sec (${resultWithSync.reads.perOp.toFixed(2)} ms/op)`);

  const readDiff = ((resultWithSync.reads.opsPerSec - resultNoSync.reads.opsPerSec) / resultNoSync.reads.opsPerSec * 100).toFixed(2);
  console.log(`  Difference:   ${readDiff > 0 ? '+' : ''}${readDiff}%`);
  console.log();

  // Verdict
  console.log('='.repeat(60));
  const threshold = 5; // 5% tolerance
  const insertPass = Math.abs(parseFloat(insertDiff)) < threshold;
  const readPass = Math.abs(parseFloat(readDiff)) < threshold;

  if (insertPass && readPass) {
    console.log('VERDICT: ✅ PASS - ZERO PERFORMANCE IMPACT');
    console.log(`         (within ${threshold}% tolerance)`);
  } else {
    console.log('VERDICT: ❌ FAIL - PERFORMANCE REGRESSION DETECTED');
  }
  console.log('='.repeat(60));

  process.exit(insertPass && readPass ? 0 : 1);
}

main().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
