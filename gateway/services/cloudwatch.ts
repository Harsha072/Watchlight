import { CloudWatchLogs } from 'aws-sdk';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from root directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const cloudwatchLogs = new CloudWatchLogs({
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.AWS_ENDPOINT || undefined, // For LocalStack
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
});

const LOG_GROUP_NAME = process.env.CLOUDWATCH_LOG_GROUP || 'observability-mesh/gateway';
const ENABLE_CLOUDWATCH = process.env.ENABLE_CLOUDWATCH_LOGS !== 'false'; // Enabled by default

// Cache for log stream names (one per day)
const logStreamCache: { [date: string]: string } = {};

/**
 * Get or create log stream name for today
 */
function getLogStreamName(): string {
  const today = new Date().toISOString().split('T')[0];
  if (!logStreamCache[today]) {
    logStreamCache[today] = `gateway-${today}`;
  }
  return logStreamCache[today];
}

/**
 * Ensure log group exists (only for real AWS, not LocalStack)
 */
async function ensureLogGroup(): Promise<void> {
  // Skip for LocalStack
  if (process.env.AWS_ENDPOINT) {
    return;
  }

  try {
    await cloudwatchLogs.createLogGroup({ logGroupName: LOG_GROUP_NAME }).promise();
    console.log(`✅ Created CloudWatch log group: ${LOG_GROUP_NAME}`);
  } catch (err: any) {
    if (err.code !== 'ResourceAlreadyExistsException') {
      console.warn(`⚠️ Could not create CloudWatch log group: ${err.message}`);
    }
  }
}

/**
 * Ensure log stream exists
 */
async function ensureLogStream(logStreamName: string): Promise<void> {
  try {
    await cloudwatchLogs.createLogStream({
      logGroupName: LOG_GROUP_NAME,
      logStreamName: logStreamName,
    }).promise();
  } catch (err: any) {
    if (err.code !== 'ResourceAlreadyExistsException') {
      // Stream might already exist, continue
    }
  }
}

/**
 * Log message to CloudWatch Logs
 * @param messageType - Type of message (log, metric, trace)
 * @param message - Short description
 * @param data - Full data payload
 */
export async function logToCloudWatch(
  messageType: 'log' | 'metric' | 'trace',
  message: string,
  data: any
): Promise<void> {
  // Skip if CloudWatch logging is disabled
  if (!ENABLE_CLOUDWATCH) {
    return;
  }

  try {
    // Ensure log group exists (only for real AWS)
    await ensureLogGroup();

    const logStreamName = getLogStreamName();
    await ensureLogStream(logStreamName);

    // Prepare log event
    const logEvent = {
      message: JSON.stringify({
        timestamp: new Date().toISOString(),
        type: messageType,
        snsMessage: message,
        data: data,
        topicArn: process.env.OBSERVABILITY_TOPIC_ARN || 'unknown',
      }, null, 2),
      timestamp: Date.now(),
    };

    // Send log event to CloudWatch
    await cloudwatchLogs.putLogEvents({
      logGroupName: LOG_GROUP_NAME,
      logStreamName: logStreamName,
      logEvents: [logEvent],
    }).promise();

    console.log(`📝 Logged to CloudWatch: ${messageType} - ${message}`);
  } catch (error: any) {
    // Don't fail the request if CloudWatch logging fails
    // Only log warning if it's not a LocalStack endpoint (LocalStack might not support CloudWatch Logs)
    if (!process.env.AWS_ENDPOINT) {
      console.warn(`⚠️ Failed to log to CloudWatch: ${error.message}`);
    }
  }
}

/**
 * Initialize CloudWatch logging (call on startup)
 */
export async function initializeCloudWatch(): Promise<void> {
  if (!ENABLE_CLOUDWATCH) {
    console.log('📝 CloudWatch logging is disabled');
    return;
  }

  console.log(`📝 CloudWatch logging enabled`);
  console.log(`   Log Group: ${LOG_GROUP_NAME}`);
  console.log(`   Endpoint: ${process.env.AWS_ENDPOINT || 'default AWS'}`);

  // Try to create log group on startup (only for real AWS)
  if (!process.env.AWS_ENDPOINT) {
    await ensureLogGroup();
  }
}

