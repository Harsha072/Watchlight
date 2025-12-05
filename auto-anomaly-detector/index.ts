import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { testConnection as testDbConnection, getRecentLogs, getRecentTraces, saveAIAnalysis, closeDatabase } from './services/database';
import { 
  testConnection as testRedisConnection, 
  getRecentSummaries, 
  storeAIAnalysis,
  closeRedis,
} from './services/redis';
import { detectAnomalies } from './services/anomaly-detector';
import { analyzeAnomaly } from './services/ai-analyzer';
import { sendNotification } from './services/notify';

// Load .env from root directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3007;

const DATABASE_URL = process.env.DATABASE_URL || '';
// Note: REDIS_URL is constructed in services/redis.ts from Upstash credentials
// We don't need to construct it here since redis.ts handles the connection
const DETECTION_INTERVAL_MINUTES = parseInt(process.env.DETECTION_INTERVAL_MINUTES || '1', 10);
const HISTORICAL_WINDOWS = parseInt(process.env.HISTORICAL_WINDOWS || '5', 10);
const DATA_LOOKBACK_MINUTES = parseInt(process.env.DATA_LOOKBACK_MINUTES || '15', 10);
// Cooldown period in minutes - don't analyze the same anomaly within this time window
// Changed to 1 minute for testing (change back to '30' for production)
const ANOMALY_COOLDOWN_MINUTES = parseInt(process.env.ANOMALY_COOLDOWN_MINUTES || '1', 10);

// Simple in-memory cache to track recently analyzed anomalies
// Key: anomaly identifier (e.g., "error_rate:high"), Value: timestamp when analyzed
const recentAnomalies = new Map<string, number>();

/**
 * Generate a simple key for an anomaly to track duplicates
 * Format: "metric:severity" (e.g., "error_rate:high")
 */
function getAnomalyKey(anomaly: { metric: string; severity: string }): string {
  return `${anomaly.metric}:${anomaly.severity}`;
}

/**
 * Check if we've analyzed this anomaly recently
 * Returns true if analyzed within cooldown period
 */
function wasAnalyzedRecently(anomalyKey: string): boolean {
  const lastAnalyzed = recentAnomalies.get(anomalyKey);
  if (!lastAnalyzed) {
    return false; // Never analyzed
  }
  
  const now = Date.now();
  const minutesSince = (now - lastAnalyzed) / (1000 * 60);
  return minutesSince < ANOMALY_COOLDOWN_MINUTES;
}

/**
 * Mark an anomaly as analyzed (store timestamp)
 */
function markAsAnalyzed(anomalyKey: string): void {
  recentAnomalies.set(anomalyKey, Date.now());
  
  // Clean up old entries (older than cooldown period) to prevent memory leak
  const now = Date.now();
  const cooldownMs = ANOMALY_COOLDOWN_MINUTES * 60 * 1000;
  for (const [key, timestamp] of recentAnomalies.entries()) {
    if (now - timestamp > cooldownMs) {
      recentAnomalies.delete(key);
    }
  }
}

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

    // Step 3: Anomaly detected! Check cooldown before analyzing
    console.log(`\n🚨 ANOMALY DETECTED!`);
    console.log(`   Metric: ${anomaly.metric}`);
    console.log(`   Severity: ${anomaly.severity.toUpperCase()}`);
    console.log(`   Message: ${anomaly.message}`);
    console.log(`   Current: ${anomaly.currentValue}, Expected: ${anomaly.expectedRange.min} - ${anomaly.expectedRange.max}`);

    // Generate a simple key for this anomaly (e.g., "error_rate:high")
    const anomalyKey = getAnomalyKey(anomaly);

    // Check if we've analyzed this anomaly recently
    if (wasAnalyzedRecently(anomalyKey)) {
      console.log(`\n⏸️  This anomaly was recently analyzed (within last ${ANOMALY_COOLDOWN_MINUTES} minutes)`);
      console.log(`   Skipping AI analysis to avoid duplicate notifications.`);
      console.log(`   The anomaly is still being monitored and will be analyzed again after cooldown.\n`);
      return; // Skip analysis but continue monitoring
    }

    console.log(`\n✅ Anomaly is new or cooldown expired. Proceeding with analysis...`);

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

    // Step 6: Save AI analysis to both Redis and Database (hybrid approach)
    const timestamp = new Date().toISOString();
    const analysisData = {
      provider: aiAnalysis.provider,
      analysis: aiAnalysis.analysis,
      severity: anomaly.severity,
      metric: anomaly.metric,
      message: anomaly.message,
      timestamp,
    };

    // Save to Redis (fast cache, 2-hour expiration)
    console.log(`\n💾 Saving AI analysis to Redis...`);
    await storeAIAnalysis(analysisData);

    // Save to Database (permanent storage)
    console.log(`\n💾 Saving AI analysis to Database...`);
    console.log(`   Provider: ${aiAnalysis.provider}`);
    console.log(`   Metric: ${anomaly.metric}`);
    console.log(`   Severity: ${anomaly.severity}`);
    console.log(`   Timestamp: ${timestamp}`);
    
    let dbSaveSuccess = false;
    let savedId: number | null = null;
    
    try {
      await saveAIAnalysis(
        aiAnalysis.provider,
        aiAnalysis.analysis,
        anomaly.severity,
        anomaly.metric,
        anomaly.message,
        timestamp
      );
      dbSaveSuccess = true;
      console.log(`✅ AI analysis successfully saved to both Redis and Database`);
    } catch (dbError: any) {
      console.error('\n❌ ============================================');
      console.error('❌ CRITICAL: Failed to save AI analysis to database!');
      console.error('❌ ============================================');
      console.error(`   Error Message: ${dbError.message}`);
      console.error(`   This is critical - timeline will not show this anomaly!`);
      if (dbError.code) {
        console.error(`   PostgreSQL Error Code: ${dbError.code}`);
      }
      if (dbError.detail) {
        console.error(`   Detail: ${dbError.detail}`);
      }
      if (dbError.hint) {
        console.error(`   Hint: ${dbError.hint}`);
      }
      if (dbError.stack) {
        console.error(`   Stack Trace:\n${dbError.stack}`);
      }
      console.error('❌ ============================================\n');
      // Continue anyway - Redis save succeeded, but database save failed
      // This means the analysis is cached but not permanently stored
    }

    // Step 7: Mark this anomaly as analyzed (store in memory with timestamp)
    markAsAnalyzed(anomalyKey);
    console.log(`   🔒 Cooldown set: This anomaly won't be analyzed again for ${ANOMALY_COOLDOWN_MINUTES} minutes`);

    // Step 8: Send notification to SQS
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
  console.log(`   Anomaly Cooldown: ${ANOMALY_COOLDOWN_MINUTES} minutes`);
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

// Health check endpoint (required for Render web service)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'auto-anomaly-detector',
    database: DATABASE_URL ? 'configured' : 'not configured',
    redis: 'configured', // Redis is handled internally
    intervalMinutes: DETECTION_INTERVAL_MINUTES,
    historicalWindows: HISTORICAL_WINDOWS,
    cooldownMinutes: ANOMALY_COOLDOWN_MINUTES,
  });
});

// Start Express server
app.listen(PORT, () => {
  console.log(`🌐 Auto-Anomaly Detector HTTP server listening on port ${PORT}`);
  // Start the detection loop in the background
  startAnomalyDetector().catch((error) => {
    console.error('❌ Error starting auto-anomaly detector:', error);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  });
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

