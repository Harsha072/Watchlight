import { createClient } from 'redis';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from root directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;

// Construct Redis URL
let REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Debug: Log what we found
console.log('🔍 Redis Configuration Check:');
console.log(`   REDIS_URL: ${process.env.REDIS_URL ? 'Set' : 'Not set'}`);
console.log(`   UPSTASH_REDIS_REST_URL: ${UPSTASH_REDIS_REST_URL ? 'Set' : 'Not set'}`);
console.log(`   UPSTASH_REDIS_REST_TOKEN: ${UPSTASH_REDIS_REST_TOKEN ? 'Set' : 'Not set'}`);

// If Upstash credentials are provided, construct the connection string
if (UPSTASH_REDIS_REST_TOKEN && UPSTASH_REDIS_REST_URL) {
  const hostname = UPSTASH_REDIS_REST_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
  REDIS_URL = `redis://default:${UPSTASH_REDIS_REST_TOKEN}@${hostname}:6379`;
  console.log('🔒 Upstash Redis credentials detected - will use TLS connection');
  console.log(`   Hostname: ${hostname}`);
} else if (!process.env.REDIS_URL) {
  console.warn('⚠️  No Redis configuration found!');
  console.warn('   Please set either:');
  console.warn('   - REDIS_URL (for local Redis)');
  console.warn('   - UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (for Upstash Redis)');
}

// Check if it's an Upstash Redis connection
const isUpstashRedis = REDIS_URL.includes('upstash.io') || !!UPSTASH_REDIS_REST_TOKEN;

// Mask the URL for logging (hide password)
const maskedUrl = REDIS_URL.replace(/:[^:@]+@/, ':****@');
console.log(`   Using Redis URL: ${maskedUrl}`);

// Parse Redis URL for TLS configuration
let redisConfig: any = {
  url: REDIS_URL,
};

// If it's Upstash Redis, enable TLS
if (isUpstashRedis) {
  redisConfig.socket = {
    tls: true,
    rejectUnauthorized: false,
  };
  console.log('🔒 Upstash Redis detected - TLS enabled');
}

// Create Redis client
let redisClient: ReturnType<typeof createClient>;

try {
  redisClient = createClient(redisConfig);

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
} catch (error: any) {
  console.error('❌ Failed to create Redis client:', error.message);
  throw error;
}

// Test Redis connection
export async function testConnection(): Promise<boolean> {
  try {
    console.log('🔌 Attempting to connect to Redis...');
    const maskedUrl = REDIS_URL.replace(/:[^:@]+@/, ':****@');
    console.log(`   URL: ${maskedUrl}`);
    
    if (!redisClient.isOpen) {
      console.log('   Connecting...');
      await redisClient.connect();
    }
    
    console.log('   Sending PING...');
    const pong = await redisClient.ping();
    if (pong === 'PONG') {
      console.log('✅ Redis connection successful!');
      return true;
    }
    console.warn('⚠️  Redis PING returned unexpected value:', pong);
    return false;
  } catch (error: any) {
    console.error('❌ Redis connection failed:', error.message);
    if (error.code) {
      console.error(`   Error code: ${error.code}`);
    }
    if (error.address) {
      console.error(`   Address: ${error.address}:${error.port || 'N/A'}`);
    }
    if (error.stack) {
      console.error('   Stack:', error.stack);
    }
    
    // Provide helpful error messages
    if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 Troubleshooting:');
      if (REDIS_URL.includes('localhost') || REDIS_URL.includes('127.0.0.1')) {
        console.error('   - Local Redis is not running');
        console.error('   - Start Redis with: docker-compose up redis');
        console.error('   - Or configure Upstash Redis in .env file');
      } else if (REDIS_URL.includes('upstash.io')) {
        console.error('   - Cannot connect to Upstash Redis');
        console.error('   - Check UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in .env');
        console.error('   - Verify your Upstash Redis instance is active');
      }
    }
    
    // Try to close connection if it's in a bad state
    try {
      if (redisClient.isOpen) {
        await redisClient.quit();
      }
    } catch (e) {
      // Ignore errors when closing
    }
    return false;
  }
}

// Get latest aggregated summary from Redis
export async function getLatestSummary(): Promise<any | null> {
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
    console.error('❌ Failed to get latest summary from Redis:', error.message);
    return null;
  }
}

// Get multiple recent aggregated summaries (last N windows)
// Since we store summaries with timestamp keys, we'll get the latest and work backwards
// Using SCAN for better compatibility with Redis v4
export async function getRecentSummaries(count: number = 12): Promise<any[]> {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
    
    // Use SCAN to get all keys matching aggregated:* pattern (safer than KEYS)
    const allKeys: string[] = [];
    
    try {
      // Try SCAN first (Redis v4 compatible)
      let cursor = 0;
      do {
        const result = await redisClient.scan(cursor, {
          MATCH: 'aggregated:*',
          COUNT: 100,
        });
        cursor = result.cursor;
        allKeys.push(...result.keys);
      } while (cursor !== 0);
    } catch (scanError: any) {
      // Fallback: try using keys() if SCAN fails (for compatibility)
      console.warn('⚠️  SCAN failed, trying KEYS as fallback:', scanError.message);
      try {
        // Check if keys() method exists (it might not in some Redis client versions)
        if (typeof (redisClient as any).keys === 'function') {
          const keysResult = await (redisClient as any).keys('aggregated:*');
          if (Array.isArray(keysResult)) {
            allKeys.push(...keysResult);
          }
        } else {
          console.warn('⚠️  KEYS method not available, will only use aggregated:latest');
        }
      } catch (keysError: any) {
        console.error('❌ Both SCAN and KEYS failed:', keysError.message);
        // Continue with empty array - we'll at least try to get 'aggregated:latest'
      }
    }
    
    // Filter out 'aggregated:latest' and get timestamp-based keys
    const timestampKeys = allKeys
      .filter(key => key !== 'aggregated:latest' && key.startsWith('aggregated:'))
      .sort()
      .reverse() // Most recent first
      .slice(0, count); // Get last N
    
    const summaries: any[] = [];
    
    // Get latest first (most recent)
    try {
      const latest = await redisClient.get('aggregated:latest');
      if (latest) {
        const latestData = JSON.parse(latest);
        summaries.push(latestData);
      }
    } catch (e) {
      console.warn('⚠️  Could not get latest summary from Redis');
    }
    
    // Get historical summaries from timestamp keys
    for (const key of timestampKeys) {
      try {
        const data = await redisClient.get(key);
        if (data) {
          try {
            const summary = JSON.parse(data);
            summaries.push(summary);
          } catch (e) {
            // Skip invalid JSON
            console.warn(`⚠️  Skipping invalid summary at key: ${key}`);
          }
        }
      } catch (e) {
        // Skip keys that can't be read
        console.warn(`⚠️  Could not read key: ${key}`);
      }
    }
    
    // Remove duplicates based on timestamp and sort chronologically
    const uniqueSummaries = summaries
      .filter((summary, index, self) => 
        index === self.findIndex(s => s.timestamp === summary.timestamp)
      )
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .slice(-count); // Get last N
    
    const timestamp = new Date().toISOString();
    console.log(`   📊 [${timestamp}] Loaded ${uniqueSummaries.length} aggregated summaries from Redis`);
    if (uniqueSummaries.length > 0) {
      const oldest = uniqueSummaries[0]?.timestamp || 'N/A';
      const newest = uniqueSummaries[uniqueSummaries.length - 1]?.timestamp || 'N/A';
      console.log(`   📅 Time range: ${oldest} → ${newest}`);
    }
    return uniqueSummaries;
  } catch (error: any) {
    console.error('❌ Failed to get recent summaries from Redis:', error.message);
    if (error.stack) {
      console.error('   Stack:', error.stack);
    }
    return [];
  }
}

// Close Redis connection
export async function closeRedis(): Promise<void> {
  if (redisClient.isOpen) {
    await redisClient.quit();
  }
}

