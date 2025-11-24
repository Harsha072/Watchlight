import dotenv from 'dotenv';
import path from 'path';
import { testConnection as testDbConnection, getRecentLogs, getRecentTraces, closeDatabase } from './services/database';
import { testConnection as testRedisConnection, getRecentSummaries, closeRedis } from './services/redis';
import { detectAnomalies } from './services/anomaly-detector';
import { analyzeAnomaly } from './services/ai-analyzer';
import { sendNotification } from './services/notify';

// Load .env from root directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const DATABASE_URL = process.env.DATABASE_URL || '';
// Note: REDIS_URL is constructed in services/redis.ts from Upstash credentials
// We don't need to construct it here since redis.ts handles the connection
const DETECTION_INTERVAL_MINUTES = parseInt(process.env.DETECTION_INTERVAL_MINUTES || '1', 10);
const HISTORICAL_WINDOWS = parseInt(process.env.HISTORICAL_WINDOWS || '12', 10);
const DATA_LOOKBACK_MINUTES = parseInt(process.env.DATA_LOOKBACK_MINUTES || '15', 10);

/**
 * Main anomaly detection cycle
 * 1. Load historical summaries from Redis
 * 2. Get latest summary
 * 3. Run statistical anomaly detection
 * 4. If anomaly found: fetch logs/traces, call AI, send notification
 * 5. If no anomaly: do nothing
 */
async function runAnomalyDetection(): Promise<void> {
  try {
    const cycleStartTime = new Date().toISOString();
    console.log(`\n🔍 [${cycleStartTime}] Starting anomaly detection cycle...`);
    console.log(`   📥 Loading last ${HISTORICAL_WINDOWS} aggregated windows from Redis...`);

    // Step 1: Load historical summaries from Redis
    const redisStartTime = Date.now();
    const historicalSummaries = await getRecentSummaries(HISTORICAL_WINDOWS);
    const redisEndTime = Date.now();
    
    console.log(`   ⏱️  Redis query took ${redisEndTime - redisStartTime}ms`);
    
    if (historicalSummaries.length < 3) {
      console.log(`⚠️  Not enough historical data (${historicalSummaries.length} windows). Need at least 3 for anomaly detection.`);
      console.log('   Skipping this cycle...\n');
      return;
    }

    // Get the most recent summary (current state)
    const currentSummary = historicalSummaries[historicalSummaries.length - 1];
    const previousSummaries = historicalSummaries.slice(0, -1); // All except the last one

    console.log(`   ✅ Loaded ${historicalSummaries.length} summaries from Redis`);
    console.log(`   📅 Current window: ${currentSummary.timestamp}`);
    console.log(`   📊 Historical windows: ${previousSummaries.length} (for comparison)`);

    // Step 2: Run statistical anomaly detection
    console.log(`\n📊 Running statistical anomaly detection...`);
    const detectionStartTime = Date.now();
    const anomaly = detectAnomalies(previousSummaries, currentSummary);
    const detectionEndTime = Date.now();
    console.log(`   ⏱️  Detection analysis took ${detectionEndTime - detectionStartTime}ms`);

    if (!anomaly) {
      console.log('✅ No anomalies detected. System is healthy.');
      console.log('   ✓ Error rates within normal range');
      console.log('   ✓ Latency within expected bounds');
      console.log('   ✓ Request volume stable\n');
      return; // Do nothing if no anomaly
    }

    // Step 3: Anomaly detected! Fetch detailed data and analyze
    console.log(`\n🚨 ANOMALY DETECTED!`);
    console.log(`   Metric: ${anomaly.metric}`);
    console.log(`   Severity: ${anomaly.severity.toUpperCase()}`);
    console.log(`   Message: ${anomaly.message}`);
    console.log(`   Current: ${anomaly.currentValue}, Expected: ${anomaly.expectedRange.min} - ${anomaly.expectedRange.max}`);

    // Step 4: Fetch recent logs and traces from PostgreSQL for context
    console.log(`\n📥 Fetching recent logs and traces from PostgreSQL...`);
    const recentLogs = await getRecentLogs(DATA_LOOKBACK_MINUTES);
    const recentTraces = await getRecentTraces(DATA_LOOKBACK_MINUTES);
    
    console.log(`   ✅ Fetched ${recentLogs.length} logs and ${recentTraces.length} traces`);

    // Step 5: Call AI for root cause analysis
    console.log(`\n🤖 Calling AI for root cause analysis...`);
    const aiAnalysis = await analyzeAnomaly({
      anomaly: {
        metric: anomaly.metric,
        currentValue: anomaly.currentValue,
        expectedRange: anomaly.expectedRange,
        severity: anomaly.severity,
        message: anomaly.message,
      },
      recentLogs,
      recentTraces,
      currentSummary,
    });

    console.log(`   ✅ AI analysis complete (${aiAnalysis.provider})`);

    // Step 6: Send notification to SQS
    console.log(`\n📤 Sending notification to Notify Service...`);
    await sendNotification({
      type: 'anomaly_detected',
      severity: anomaly.severity,
      metric: anomaly.metric,
      message: anomaly.message,
      analysis: aiAnalysis.analysis,
      timestamp: new Date().toISOString(),
      provider: aiAnalysis.provider,
    });

    console.log('✅ Anomaly detection cycle complete\n');
  } catch (error: any) {
    console.error('❌ Error during anomaly detection:', error.message);
    console.error(error.stack);
    // Don't throw - we want the service to keep running
  }
}

/**
 * Main service loop
 * Runs every 1 minute by default
 */
async function startAnomalyDetector() {
  console.log('🚀 Auto-Anomaly Detector Service Starting...');
  console.log(`   Database: ${DATABASE_URL ? 'Configured' : 'Not configured'}`);
  
  // Check Redis configuration
  const hasUpstashUrl = !!process.env.UPSTASH_REDIS_REST_URL;
  const hasUpstashToken = !!process.env.UPSTASH_REDIS_REST_TOKEN;
  const hasRedisUrl = !!process.env.REDIS_URL;
  
  if (hasUpstashUrl && hasUpstashToken) {
    const upstashUrl = process.env.UPSTASH_REDIS_REST_URL || '';
    console.log(`   Redis: Upstash Redis (${upstashUrl.replace(/^https?:\/\//, '')})`);
  } else if (hasRedisUrl && process.env.REDIS_URL) {
    const maskedUrl = process.env.REDIS_URL.replace(/:[^:@]+@/, ':****@');
    console.log(`   Redis: ${maskedUrl}`);
  } else {
    console.log(`   Redis: Local (localhost:6379)`);
  }
  
  console.log(`   Detection Interval: ${DETECTION_INTERVAL_MINUTES} minute(s)`);
  console.log(`   Historical Windows: ${HISTORICAL_WINDOWS}`);
  console.log(`   Data Lookback: ${DATA_LOOKBACK_MINUTES} minutes`);
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

  try {
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
  } catch (error: any) {
    console.error('❌ Error during Redis connection test:', error.message);
    if (error.stack) {
      console.error('   Stack:', error.stack);
    }
    redisConnected = false;
  }

  if (!redisConnected) {
    console.error('❌ Failed to connect to Redis after multiple retries');
    console.error('   Please check:');
    console.error('   1. Redis is running and accessible');
    console.error('   2. REDIS_URL or UPSTASH_REDIS_REST_URL is correct in .env file');
    console.error('   3. For Upstash Redis, ensure UPSTASH_REDIS_REST_TOKEN is set');
    process.exit(1);
  }

  console.log('✅ Auto-Anomaly Detector ready');
  console.log(`🔄 Starting detection cycle (every ${DETECTION_INTERVAL_MINUTES} minute(s))...\n`);

  // Run immediately on startup
  await runAnomalyDetection();

  // Then run on schedule
  const intervalMs = DETECTION_INTERVAL_MINUTES * 60 * 1000;
  setInterval(async () => {
    await runAnomalyDetection();
  }, intervalMs);
}

// Start the detector
startAnomalyDetector().catch((error) => {
  console.error('❌ Error starting auto-anomaly detector:', error);
  if (error.stack) {
    console.error('Stack trace:', error.stack);
  }
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('\n🛑 Auto-Anomaly Detector shutting down...');
  await closeDatabase();
  await closeRedis();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Auto-Anomaly Detector shutting down...');
  await closeDatabase();
  await closeRedis();
  process.exit(0);
});

