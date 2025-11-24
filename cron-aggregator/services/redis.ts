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
  // Extract hostname from REST URL (remove https://)
  const hostname = UPSTASH_REDIS_REST_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
  // Construct Redis connection string: redis://default:TOKEN@HOST:6379
  REDIS_URL = `redis://default:${UPSTASH_REDIS_REST_TOKEN}@${hostname}:6379`;
  console.log('🔒 Upstash Redis credentials detected - will use TLS connection');
}

// Check if it's an Upstash Redis connection
const isUpstashRedis = REDIS_URL.includes('upstash.io') || !!UPSTASH_REDIS_REST_TOKEN;

// Parse Redis URL for TLS configuration
let redisConfig: any = {
  url: REDIS_URL,
};

// If it's Upstash Redis, enable TLS
if (isUpstashRedis) {
  // Upstash requires TLS
  redisConfig.socket = {
    tls: true,
    rejectUnauthorized: false, // Upstash uses valid certificates, but this allows flexibility
  };
  
  console.log('🔒 Upstash Redis detected - TLS enabled');
}

// Create Redis client
const redisClient = createClient(redisConfig);

// Handle connection errors
redisClient.on('error', (err) => {
  console.error('❌ Redis Client Error:', err);
});

redisClient.on('connect', () => {
  console.log('🔌 Connecting to Redis...');
});

redisClient.on('ready', () => {
  console.log('✅ Redis Client Ready');
});

// Test Redis connection
export async function testConnection(): Promise<boolean> {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
    
    const pong = await redisClient.ping();
    if (pong === 'PONG') {
      console.log('✅ Redis connection successful!');
      return true;
    }
    return false;
  } catch (error: any) {
    console.error('❌ Redis connection failed:', error.message);
    return false;
  }
}

// Store aggregated summaries in Redis
export async function storeAggregatedSummaries(summaries: any): Promise<void> {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
    
    const timestamp = new Date().toISOString();
    const key = `aggregated:${timestamp}`;
    
    // Store the full aggregated summary
    await redisClient.setEx(
      key,
      3600, // Expire after 1 hour
      JSON.stringify(summaries)
    );
    
    // Store latest summary (overwrites previous)
    await redisClient.setEx(
      'aggregated:latest',
      3600,
      JSON.stringify(summaries)
    );
    
    // Store individual metrics for quick access
    if (summaries.metrics) {
      for (const metric of summaries.metrics) {
        const serviceKey = `service:${metric.service}:metrics`;
        await redisClient.setEx(
          serviceKey,
          3600,
          JSON.stringify(metric)
        );
      }
    }
    
    // Store slow endpoints
    if (summaries.slowEndpoints && summaries.slowEndpoints.length > 0) {
      await redisClient.setEx(
        'slow:endpoints',
        3600,
        JSON.stringify(summaries.slowEndpoints)
      );
    }
    
    // Store error counts
    if (summaries.errorCounts) {
      await redisClient.setEx(
        'errors:counts',
        3600,
        JSON.stringify(summaries.errorCounts)
      );
    }
    
    // Store request volume
    if (summaries.requestVolume) {
      await redisClient.setEx(
        'volume:requests',
        3600,
        JSON.stringify(summaries.requestVolume)
      );
    }
    
    console.log('✅ Aggregated summaries stored in Redis');
  } catch (error: any) {
    console.error('❌ Failed to store aggregated summaries in Redis:', error.message);
    throw error;
  }
}

// Get latest aggregated summaries from Redis
export async function getLatestSummaries(): Promise<any | null> {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
    
    const data = await redisClient.get('aggregated:latest');
    if (data) {
      return JSON.parse(data);
    }
    return null;
  } catch (error: any) {
    console.error('❌ Failed to get latest summaries from Redis:', error.message);
    return null;
  }
}

// Close Redis connection
export async function closeRedis(): Promise<void> {
  if (redisClient.isOpen) {
    await redisClient.quit();
  }
}

