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

interface CloudWatchLogEntry {
  timestamp: string;
  type: 'log' | 'metric' | 'trace';
  snsMessage: string;
  data: any;
  topicArn: string;
}

/**
 * Get recent log streams for the log group
 */
async function getRecentLogStreams(limit: number = 5): Promise<string[]> {
  try {
    const response = await cloudwatchLogs.describeLogStreams({
      logGroupName: LOG_GROUP_NAME,
      orderBy: 'LastEventTime',
      descending: true,
      limit: limit,
    }).promise();

    return (response.logStreams || []).map(stream => stream.logStreamName || '');
  } catch (error: any) {
    if (error.code === 'ResourceNotFoundException') {
      return [];
    }
    throw error;
  }
}

/**
 * Fetch logs from CloudWatch Logs
 * @param limit - Maximum number of log entries to return
 * @param startTime - Start time in milliseconds (optional)
 * @param endTime - End time in milliseconds (optional)
 * @param logStreamName - Specific log stream name (optional)
 */
export async function getCloudWatchLogs(
  limit: number = 50,
  startTime?: number,
  endTime?: number,
  logStreamName?: string
): Promise<CloudWatchLogEntry[]> {
  try {
    // Skip if using LocalStack
    if (process.env.AWS_ENDPOINT) {
      return [];
    }

    // Get log streams if not specified
    let logStreams: string[] = [];
    if (logStreamName) {
      logStreams = [logStreamName];
    } else {
      logStreams = await getRecentLogStreams(10);
    }

    if (logStreams.length === 0) {
      return [];
    }

    // Default time range: last 1 hour
    const now = Date.now();
    const defaultStartTime = startTime || (now - 3600000); // 1 hour ago
    const defaultEndTime = endTime || now;

    const allLogs: CloudWatchLogEntry[] = [];

    // Fetch logs from each stream
    for (const streamName of logStreams) {
      try {
        const response = await cloudwatchLogs.getLogEvents({
          logGroupName: LOG_GROUP_NAME,
          logStreamName: streamName,
          startTime: defaultStartTime,
          endTime: defaultEndTime,
          limit: limit,
          startFromHead: false, // Get most recent first
        }).promise();

        if (response.events) {
          for (const event of response.events) {
            try {
              const parsed = JSON.parse(event.message || '{}');
              allLogs.push({
                timestamp: new Date(event.timestamp || 0).toISOString(),
                type: parsed.type || 'unknown',
                snsMessage: parsed.snsMessage || '',
                data: parsed.data || {},
                topicArn: parsed.topicArn || '',
              });
            } catch (parseError) {
              // Skip invalid JSON entries
              continue;
            }
          }
        }
      } catch (streamError: any) {
        // Skip streams that fail, continue with others
        console.warn(`⚠️ Failed to fetch logs from stream ${streamName}: ${streamError.message}`);
        continue;
      }
    }

    // Sort by timestamp (most recent first) and limit
    allLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return allLogs.slice(0, limit);
  } catch (error: any) {
    if (error.code === 'ResourceNotFoundException') {
      return [];
    }
    throw error;
  }
}

/**
 * Get available log streams
 */
export async function getLogStreams(): Promise<string[]> {
  try {
    if (process.env.AWS_ENDPOINT) {
      return [];
    }
    return await getRecentLogStreams(20);
  } catch (error: any) {
    if (error.code === 'ResourceNotFoundException') {
      return [];
    }
    throw error;
  }
}

