import { SQS } from 'aws-sdk';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from root directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const sqs = new SQS({
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.AWS_ENDPOINT || undefined, // For LocalStack
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
});

const NOTIFY_QUEUE_URL = process.env.NOTIFY_QUEUE_URL || '';

interface AnomalyNotification {
  type: 'anomaly_detected';
  severity: string;
  metric: string;
  message: string;
  analysis: string;
  timestamp: string;
  provider: string;
}

/**
 * Send anomaly notification to SQS queue
 * Notify service will process this and send alerts
 */
export async function sendNotification(notification: AnomalyNotification): Promise<void> {
  if (!NOTIFY_QUEUE_URL) {
    console.warn('⚠️ NOTIFY_QUEUE_URL not configured, skipping notification');
    return;
  }

  try {
    await sqs.sendMessage({
      QueueUrl: NOTIFY_QUEUE_URL,
      MessageBody: JSON.stringify(notification),
      MessageAttributes: {
        type: {
          DataType: 'String',
          StringValue: 'anomaly_detected',
        },
        severity: {
          DataType: 'String',
          StringValue: notification.severity,
        },
      },
    }).promise();

    console.log('✅ Notification sent to SQS queue');
  } catch (error: any) {
    console.error('❌ Failed to send notification:', error.message);
    throw error;
  }
}

