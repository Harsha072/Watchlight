import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { testConnection as testDbConnection, getLogsData, getMetricsData, getTracesData, closeDatabase } from './services/database';
import { testConnection as testRedisConnection, storeAggregatedSummaries, closeRedis } from './services/redis';

// Load .env from root directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3006;

const DATABASE_URL = process.env.DATABASE_URL || '';
const REDIS_URL = process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL || 'redis://localhost:6379';
const AGGREGATION_INTERVAL_MINUTES = parseInt(process.env.AGGREGATION_INTERVAL_MINUTES || '5', 10);
const AGGREGATION_WINDOW_MINUTES = parseInt(process.env.AGGREGATION_WINDOW_MINUTES || '5', 10);

interface AggregatedSummary {
  timestamp: string;
  windowMinutes: number;
  logs: {
    totalCount: number;
    errorCount: number;
    byService: Record<string, { total: number; errors: number }>;
    byLevel: Record<string, number>;
  };
  metrics: Array<{
    service: string;
    totalRequests: number;
    totalErrors: number;
    avgResponseTime: number;
    p95Latency: number;
    p99Latency: number;
    avgCpu: number;
    avgMemory: number;
    maxConnections: number;
    totalThroughput: number;
  }>;
  traces: Array<{
    service: string;
    operation: string;
    traceCount: number;
    avgDuration: number;
    p95Duration: number;
    p99Duration: number;
    errorCount: number;
    serverErrorCount: number;
  }>;
  slowEndpoints: Array<{
    service: string;
    operation: string;
    p95Duration: number;
    count: number;
  }>;
  errorCounts: Record<string, number>;
  requestVolume: {
    total: number;
    byService: Record<string, number>;
  };
  anomalousSpikes: Array<{
    type: string;
    service: string;
    value: number;
    threshold: number;
    timestamp: string;
  }>;
}

// Aggregate data from PostgreSQL
async function aggregateData(): Promise<AggregatedSummary> {
  console.log(`\n📊 Starting aggregation for last ${AGGREGATION_WINDOW_MINUTES} minutes...`);
  
  const timestamp = new Date().toISOString();
  
  // Get logs data
  const logsData = await getLogsData(AGGREGATION_WINDOW_MINUTES);
  const logsSummary = {
    totalCount: logsData.reduce((sum, row) => sum + parseInt(row.count), 0),
    errorCount: logsData.reduce((sum, row) => sum + (row.level === 'error' ? parseInt(row.count) : 0), 0),
    byService: {} as Record<string, { total: number; errors: number }>,
    byLevel: {} as Record<string, number>,
  };
  
  logsData.forEach((row) => {
    const service = row.service || 'unknown';
    if (!logsSummary.byService[service]) {
      logsSummary.byService[service] = { total: 0, errors: 0 };
    }
    logsSummary.byService[service].total += parseInt(row.count);
    if (row.level === 'error') {
      logsSummary.byService[service].errors += parseInt(row.count);
    }
    
    logsSummary.byLevel[row.level] = (logsSummary.byLevel[row.level] || 0) + parseInt(row.count);
  });
  
  // Get metrics data
  const metricsData = await getMetricsData(AGGREGATION_WINDOW_MINUTES);
  const metricsSummary = metricsData.map((row) => ({
    service: row.service || 'unknown',
    totalRequests: parseInt(row.total_requests || 0),
    totalErrors: parseInt(row.total_errors || 0),
    avgResponseTime: parseFloat(row.avg_response_time || 0),
    p95Latency: parseFloat(row.p95_latency || 0),
    p99Latency: parseFloat(row.p99_latency || 0),
    avgCpu: parseFloat(row.avg_cpu || 0),
    avgMemory: parseFloat(row.avg_memory || 0),
    maxConnections: parseInt(row.max_connections || 0),
    totalThroughput: parseInt(row.total_throughput || 0),
  }));
  
  // Get traces data
  const tracesData = await getTracesData(AGGREGATION_WINDOW_MINUTES);
  const tracesSummary = tracesData.traces.map((row: any) => ({
    service: row.service || 'unknown',
    operation: row.operation || 'unknown',
    traceCount: parseInt(row.trace_count || 0),
    avgDuration: parseFloat(row.avg_duration || 0),
    p95Duration: parseFloat(row.p95_duration || 0),
    p99Duration: parseFloat(row.p99_duration || 0),
    errorCount: parseInt(row.error_count || 0),
    serverErrorCount: parseInt(row.server_error_count || 0),
  }));
  
  const slowEndpoints = tracesData.slowEndpoints.map((row: any) => ({
    service: row.service || 'unknown',
    operation: row.operation || 'unknown',
    p95Duration: parseFloat(row.p95_duration || 0),
    count: parseInt(row.count || 0),
  }));
  
  // Calculate error counts by service
  const errorCounts: Record<string, number> = {};
  logsData.forEach((row) => {
    if (row.level === 'error') {
      const service = row.service || 'unknown';
      errorCounts[service] = (errorCounts[service] || 0) + parseInt(row.count);
    }
  });
  
  // Calculate request volume
  const requestVolume = {
    total: metricsSummary.reduce((sum, m) => sum + m.totalRequests, 0),
    byService: {} as Record<string, number>,
  };
  metricsSummary.forEach((m) => {
    requestVolume.byService[m.service] = m.totalRequests;
  });
  
  // Detect anomalous spikes
  const anomalousSpikes: AggregatedSummary['anomalousSpikes'] = [];
  
  // Check for high error rates (> 5%)
  metricsSummary.forEach((m) => {
    const errorRate = m.totalRequests > 0 ? (m.totalErrors / m.totalRequests) * 100 : 0;
    if (errorRate > 5) {
      anomalousSpikes.push({
        type: 'high_error_rate',
        service: m.service,
        value: errorRate,
        threshold: 5,
        timestamp,
      });
    }
  });
  
  // Check for high latency (P95 > 1000ms)
  metricsSummary.forEach((m) => {
    if (m.p95Latency > 1000) {
      anomalousSpikes.push({
        type: 'high_latency',
        service: m.service,
        value: m.p95Latency,
        threshold: 1000,
        timestamp,
      });
    }
  });
  
  // Check for high CPU usage (> 80%)
  metricsSummary.forEach((m) => {
    if (m.avgCpu > 80) {
      anomalousSpikes.push({
        type: 'high_cpu',
        service: m.service,
        value: m.avgCpu,
        threshold: 80,
        timestamp,
      });
    }
  });
  
  // Check for high memory usage (> 85%)
  metricsSummary.forEach((m) => {
    if (m.avgMemory > 85) {
      anomalousSpikes.push({
        type: 'high_memory',
        service: m.service,
        value: m.avgMemory,
        threshold: 85,
        timestamp,
      });
    }
  });
  
  const summary: AggregatedSummary = {
    timestamp,
    windowMinutes: AGGREGATION_WINDOW_MINUTES,
    logs: logsSummary,
    metrics: metricsSummary,
    traces: tracesSummary,
    slowEndpoints,
    errorCounts,
    requestVolume,
    anomalousSpikes,
  };
  
  console.log(`✅ Aggregation complete:`);
  console.log(`   - Logs: ${logsSummary.totalCount} total, ${logsSummary.errorCount} errors`);
  console.log(`   - Metrics: ${metricsSummary.length} services`);
  console.log(`   - Traces: ${tracesSummary.length} operations`);
  console.log(`   - Slow endpoints: ${slowEndpoints.length}`);
  console.log(`   - Anomalous spikes: ${anomalousSpikes.length}`);
  
  return summary;
}

// Main aggregation function
async function runAggregation(): Promise<void> {
  try {
    // Aggregate data from PostgreSQL
    const summary = await aggregateData();
    
    // Store in Redis
    await storeAggregatedSummaries(summary);
    
    console.log('✅ Aggregation cycle complete\n');
  } catch (error: any) {
    console.error('❌ Error during aggregation:', error.message);
    console.error(error.stack);
  }
}

// Main service loop
async function startAggregator() {
  console.log('🚀 Cron Aggregator Service Starting...');
  console.log(`   Database: ${DATABASE_URL ? 'Configured' : 'Not configured'}`);
  const maskedRedisUrl = REDIS_URL.replace(/:[^:@]+@/, ':****@');
  console.log(`   Redis: ${maskedRedisUrl}`);
  console.log(`   Aggregation Interval: ${AGGREGATION_INTERVAL_MINUTES} minutes`);
  console.log(`   Aggregation Window: ${AGGREGATION_WINDOW_MINUTES} minutes`);
  console.log('');
  
  // Check database connection
  if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL not set in environment variables');
    process.exit(1);
  }
  
  const maxRetries = 5;
  let retries = 0;
  let dbConnected = false;
  
  while (retries < maxRetries && !dbConnected) {
    dbConnected = await testDbConnection();
    if (!dbConnected) {
      retries++;
      if (retries < maxRetries) {
        console.log(`⏳ Retrying database connection (${retries}/${maxRetries})...`);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }
  
  if (!dbConnected) {
    console.error('❌ Failed to connect to PostgreSQL after multiple retries');
    process.exit(1);
  }
  
  // Check Redis connection
  retries = 0;
  let redisConnected = false;
  
  while (retries < maxRetries && !redisConnected) {
    redisConnected = await testRedisConnection();
    if (!redisConnected) {
      retries++;
      if (retries < maxRetries) {
        console.log(`⏳ Retrying Redis connection (${retries}/${maxRetries})...`);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }
  
  if (!redisConnected) {
    console.error('❌ Failed to connect to Redis after multiple retries');
    console.error('   Please check:');
    console.error('   1. Docker container is running: docker-compose ps');
    console.error('   2. REDIS_URL is correct in .env file');
    console.error('   3. Redis is healthy: docker-compose logs redis');
    process.exit(1);
  }
  
  console.log('✅ Cron Aggregator ready');
  console.log(`🔄 Starting aggregation cycle (every ${AGGREGATION_INTERVAL_MINUTES} minutes)...\n`);
  
  // Run immediately on startup
  await runAggregation();
  
  // Then run on schedule
  const intervalMs = AGGREGATION_INTERVAL_MINUTES * 60 * 1000;
  setInterval(async () => {
    await runAggregation();
  }, intervalMs);
}

// Health check endpoint (required for Render web service)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'cron-aggregator',
    database: DATABASE_URL ? 'configured' : 'not configured',
    redis: REDIS_URL ? 'configured' : 'not configured',
    intervalMinutes: AGGREGATION_INTERVAL_MINUTES,
    windowMinutes: AGGREGATION_WINDOW_MINUTES,
  });
});

// Start Express server
app.listen(PORT, () => {
  console.log(`🌐 Cron Aggregator HTTP server listening on port ${PORT}`);
  // Start the aggregation loop in the background
  startAggregator().catch((error) => {
    console.error('❌ Error starting cron aggregator:', error);
    process.exit(1);
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('\n🛑 Cron Aggregator shutting down...');
  await closeDatabase();
  await closeRedis();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Cron Aggregator shutting down...');
  await closeDatabase();
  await closeRedis();
  process.exit(0);
});

