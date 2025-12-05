import { createClient } from 'redis';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from root directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;

// Construct Redis URL
let REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// If Upstash credentials are provided, construct the connection string
if (UPSTASH_REDIS_REST_TOKEN && UPSTASH_REDIS_REST_URL) {
  const hostname = UPSTASH_REDIS_REST_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
  // Use rediss:// (with double 's') for TLS connections to Upstash
  REDIS_URL = `rediss://default:${UPSTASH_REDIS_REST_TOKEN}@${hostname}:6379`;
}

const isUpstashRedis = REDIS_URL.includes('upstash.io') || !!UPSTASH_REDIS_REST_TOKEN;

let redisConfig: any = {
  url: REDIS_URL,
};

if (isUpstashRedis) {
  // For rediss:// URLs, TLS is already implied, but we can still set socket options
  redisConfig.socket = {
    tls: true,
    rejectUnauthorized: false,
  };
}

// Create Redis client
const redisClient = createClient(redisConfig);

redisClient.on('error', (err) => {
  console.error('❌ Gateway Redis Client Error:', err);
});

// Lazy connection - connect when needed
let isConnected = false;

async function ensureConnected() {
  if (!isConnected && !redisClient.isOpen) {
    await redisClient.connect();
    isConnected = true;
  }
}

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
}

/**
 * Get aggregated summaries from Redis for a specific time window (in minutes)
 * @param windowMinutes - Number of minutes to look back (5, 10, or 15)
 * @returns Array of aggregated summaries
 */
export async function getAggregatedSummaries(windowMinutes: number = 5): Promise<AggregatedSummary[]> {
  try {
    await ensureConnected();

    // Calculate the cutoff time
    const cutoffTime = new Date();
    cutoffTime.setMinutes(cutoffTime.getMinutes() - windowMinutes);

    // Get all keys matching the pattern
    // For Redis client v5, use KEYS for simplicity (acceptable for small datasets)
    // SCAN is more complex and has API differences between versions
    const keys = await redisClient.keys('aggregated:*');

    // Filter keys by timestamp and get their values
    const summaries: AggregatedSummary[] = [];
    
    for (const key of keys) {
      // Skip 'aggregated:latest' as it's not timestamped
      if (key === 'aggregated:latest') continue;
      
      // Extract timestamp from key (format: aggregated:2025-01-24T14:30:00.000Z)
      const timestampStr = key.replace('aggregated:', '');
      const keyTimestamp = new Date(timestampStr);
      
      // Only include summaries within the time window
      if (keyTimestamp >= cutoffTime) {
        const data = await redisClient.get(key);
        if (data) {
          try {
            const summary = JSON.parse(data);
            summaries.push(summary);
          } catch (parseError) {
            console.warn(`⚠️ Failed to parse Redis key ${key}:`, parseError);
          }
        }
      }
    }

    // Sort by timestamp (newest first)
    summaries.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    return summaries;
  } catch (error: any) {
    console.error('❌ Failed to get aggregated summaries from Redis:', error.message);
    return [];
  }
}

/**
 * Get the latest aggregated summary from Redis
 */
export async function getLatestSummary(): Promise<AggregatedSummary | null> {
  try {
    await ensureConnected();
    
    const data = await redisClient.get('aggregated:latest');
    if (data) {
      return JSON.parse(data);
    }
    return null;
  } catch (error: any) {
    console.error('❌ Failed to get latest summary from Redis:', error.message);
    return null;
  }
}

/**
 * Transform aggregated summaries into dashboard-friendly format
 */
export function transformSummariesForDashboard(summaries: AggregatedSummary[]) {
  // Combine all summaries into a single view
  const combined = {
    logs: {
      total: 0,
      errors: 0,
      byLevel: {} as Record<string, number>,
      byService: {} as Record<string, { total: number; errors: number }>,
      logEntries: [] as any[], // Actual log entries for display
    },
    metrics: [] as any[],
    traces: [] as any[],
  };

  summaries.forEach(summary => {
    // Aggregate logs
    combined.logs.total += summary.logs.totalCount;
    combined.logs.errors += summary.logs.errorCount;
    
    Object.entries(summary.logs.byLevel).forEach(([level, count]) => {
      combined.logs.byLevel[level] = (combined.logs.byLevel[level] || 0) + count;
    });

    Object.entries(summary.logs.byService).forEach(([service, data]) => {
      if (!combined.logs.byService[service]) {
        combined.logs.byService[service] = { total: 0, errors: 0 };
      }
      combined.logs.byService[service].total += data.total;
      combined.logs.byService[service].errors += data.errors;
    });

    // Create log entries from aggregated data
    Object.entries(summary.logs.byLevel).forEach(([level, count]) => {
      Object.entries(summary.logs.byService).forEach(([service, svcData]) => {
        // Create representative log entries
        const entriesToCreate = Math.min(count, 10); // Limit per service/level combo
        for (let i = 0; i < entriesToCreate; i++) {
          combined.logs.logEntries.push({
            level: level,
            service: service,
            message: `${level} log from ${service} (aggregated)`,
            timestamp: summary.timestamp,
          });
        }
      });
    });

    // Collect metrics (with timestamp)
    summary.metrics.forEach(metric => {
      combined.metrics.push({
        ...metric,
        timestamp: summary.timestamp,
        request_count: metric.totalRequests,
        error_count: metric.totalErrors,
        avg_response_time_ms: metric.avgResponseTime,
        p95_response_time_ms: metric.p95Latency,
        p99_response_time_ms: metric.p99Latency,
        cpu_usage_percent: metric.avgCpu,
        memory_usage_percent: metric.avgMemory,
        active_connections: metric.maxConnections,
        throughput_bytes_per_sec: metric.totalThroughput,
      });
    });

    // Collect traces (with timestamp)
    summary.traces.forEach(trace => {
      combined.traces.push({
        ...trace,
        timestamp: summary.timestamp,
        trace_id: `${trace.service}-${trace.operation}-${Date.now()}-${Math.random()}`,
        duration: trace.avgDuration,
        status_code: trace.errorCount > 0 ? 500 : 200,
        start_time: summary.timestamp,
        operation: trace.operation,
        service: trace.service,
      });
    });
  });

  return combined;
}

/**
 * Store AI analysis in Redis (with 2-hour expiration)
 */
export async function storeAIAnalysis(analysis: {
  id?: number;
  provider: string;
  analysis: string;
  timestamp: string;
  severity?: string;
  metric?: string;
  message?: string;
}): Promise<void> {
  try {
    await ensureConnected();

    // Use the timestamp from the analysis object
    const timestamp = analysis.timestamp || new Date().toISOString();
    const key = `ai:analysis:${timestamp}`;
    
    // Store the analysis with 2-hour expiration
    await redisClient.setEx(
      key,
      7200, // 2 hours
      JSON.stringify(analysis)
    );

    // Also store as latest (overwrites previous)
    await redisClient.setEx(
      'ai:analysis:latest',
      7200, // 2 hours
      JSON.stringify(analysis)
    );

    console.log('✅ AI analysis stored in Redis');
  } catch (error: any) {
    console.error('❌ Failed to store AI analysis in Redis:', error.message);
    // Don't throw - Redis failure shouldn't break the flow
  }
}

/**
 * Get AI analysis from Redis (recent analyses within time window)
 */
export async function getAIAnalysisFromRedis(limit: number = 10): Promise<any[]> {
  try {
    await ensureConnected();

    // Get all AI analysis keys
    const keys = await redisClient.keys('ai:analysis:*');
    
    // Filter out 'latest' key and get timestamped keys
    const analysisKeys = keys
      .filter(key => key !== 'ai:analysis:latest' && key.startsWith('ai:analysis:'))
      .sort()
      .reverse() // Most recent first
      .slice(0, limit);

    const analyses: any[] = [];

    for (const key of analysisKeys) {
      try {
        const data = await redisClient.get(key);
        if (data) {
          const analysis = JSON.parse(data);
          analyses.push(analysis);
        }
      } catch (parseError) {
        console.warn(`⚠️ Failed to parse Redis key ${key}:`, parseError);
      }
    }

    return analyses;
  } catch (error: any) {
    console.error('❌ Failed to get AI analysis from Redis:', error.message);
    return [];
  }
}

