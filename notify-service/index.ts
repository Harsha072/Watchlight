import dotenv from 'dotenv';
import { SQS } from 'aws-sdk';
import axios from 'axios';
import path from 'path';

// Load .env from root directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const sqs = new SQS({
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.AWS_ENDPOINT || undefined, // For LocalStack
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
});

const QUEUE_URL = process.env.NOTIFY_QUEUE_URL || '';
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL || '';

interface NotificationMessage {
  timestamp: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  analysis?: any[];
  observabilityData?: any;
}

// Send Slack notification
async function sendSlackNotification(notification: NotificationMessage): Promise<void> {
  if (!SLACK_WEBHOOK_URL) {
    console.warn('⚠️ SLACK_WEBHOOK_URL not configured, skipping Slack notification');
    return;
  }

  try {
    const severityEmoji = {
      info: 'ℹ️',
      warning: '⚠️',
      error: '❌',
      critical: '🚨',
    };

    const slackMessage = {
      text: `${severityEmoji[notification.severity]} *Observability Alert*`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `${severityEmoji[notification.severity]} ${notification.message}`,
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Severity:*\n${notification.severity.toUpperCase()}`,
            },
            {
              type: 'mrkdwn',
              text: `*Time:*\n${new Date(notification.timestamp).toLocaleString()}`,
            },
          ],
        },
      ],
    };

    // Add analysis summary if available
    if (notification.analysis && notification.analysis.length > 0) {
      const analysisText = notification.analysis
        .map((a: any) => `*${a.provider.toUpperCase()}*: ${a.summary.substring(0, 200)}...`)
        .join('\n\n');
      
      slackMessage.blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Analysis Summary:*\n${analysisText}`,
        },
      });
    }

    await axios.post(SLACK_WEBHOOK_URL, slackMessage, {
      headers: { 'Content-Type': 'application/json' },
    });

    console.log(`📢 Slack notification sent: ${notification.severity}`);
  } catch (error: any) {
    console.error('❌ Failed to send Slack notification:', error.message);
    throw error;
  }
}

// Send email notification
async function sendEmailNotification(notification: NotificationMessage): Promise<void> {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !NOTIFICATION_EMAIL) {
    console.warn('⚠️ Email configuration incomplete, skipping email notification');
    return;
  }

  try {
    // For now, we'll use a simple HTTP email service or log it
    // In production, you'd use nodemailer or similar
    const emailSubject = `[${notification.severity.toUpperCase()}] ${notification.message}`;
    const emailBody = `
Observability Alert

Severity: ${notification.severity.toUpperCase()}
Time: ${new Date(notification.timestamp).toLocaleString()}
Message: ${notification.message}

${notification.analysis && notification.analysis.length > 0
  ? `Analysis:\n${notification.analysis.map((a: any) => `\n${a.provider.toUpperCase()}:\n${a.summary}`).join('\n\n')}`
  : ''}
    `.trim();

    console.log(`📧 Email notification prepared:`);
    console.log(`   To: ${NOTIFICATION_EMAIL}`);
    console.log(`   Subject: ${emailSubject}`);
    console.log(`   Body: ${emailBody.substring(0, 200)}...`);

    // TODO: Implement actual email sending with nodemailer
    // For now, we'll just log it
    console.log(`📧 Email notification logged (implement nodemailer for actual sending)`);
  } catch (error: any) {
    console.error('❌ Failed to send email notification:', error.message);
    throw error;
  }
}

// Process a single notification message
async function processNotificationMessage(messageBody: string): Promise<void> {
  try {
    // Parse the message body
    let notification: NotificationMessage;
    
    const sqsMessage = JSON.parse(messageBody);
    
    // Check if this is an SNS notification
    if (sqsMessage.Type === 'Notification' && sqsMessage.Message) {
      notification = JSON.parse(sqsMessage.Message);
    } else if (sqsMessage.Message) {
      notification = JSON.parse(sqsMessage.Message);
    } else {
      notification = sqsMessage;
    }

    console.log(`📨 Processing notification: ${notification.severity} - ${notification.message}`);

    // Send notifications via all configured channels
    const promises: Promise<void>[] = [];

    // Send Slack notification
    if (SLACK_WEBHOOK_URL) {
      promises.push(sendSlackNotification(notification).catch((err) => {
        console.error('Slack notification failed:', err.message);
      }));
    }

    // Send email notification
    if (SMTP_HOST && NOTIFICATION_EMAIL) {
      promises.push(sendEmailNotification(notification).catch((err) => {
        console.error('Email notification failed:', err.message);
      }));
    }

    await Promise.allSettled(promises);
    console.log('✅ Notification processed');
  } catch (error: any) {
    console.error('❌ Error processing notification:', error.message);
    throw error;
  }
}

// Poll SQS for messages
async function pollSQS(): Promise<void> {
  const params = {
    QueueUrl: QUEUE_URL,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 20, // Long polling
    VisibilityTimeout: 30,
  };

  try {
    const result = await sqs.receiveMessage(params).promise();

    if (result.Messages && result.Messages.length > 0) {
      console.log(`📨 Received ${result.Messages.length} notification(s)`);

      for (const message of result.Messages) {
        if (message.Body && message.ReceiptHandle) {
          try {
            await processNotificationMessage(message.Body);

            // Delete message from queue after successful processing
            await sqs
              .deleteMessage({
                QueueUrl: QUEUE_URL,
                ReceiptHandle: message.ReceiptHandle,
              })
              .promise();

            console.log('✅ Notification processed and deleted from queue');
          } catch (error) {
            console.error('❌ Error processing notification, will retry:', error);
            // Message will become visible again after VisibilityTimeout
          }
        }
      }
    }
  } catch (error: any) {
    console.error('Error polling SQS:', error.message);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

// Main processing loop
async function processNotifications() {
  console.log('🚀 Notify service starting...');
  console.log(`📡 Queue URL: ${QUEUE_URL}`);

  if (!QUEUE_URL) {
    console.error('❌ NOTIFY_QUEUE_URL not set in environment variables');
    process.exit(1);
  }

  // Verify queue exists
  try {
    await sqs.getQueueAttributes({ QueueUrl: QUEUE_URL, AttributeNames: ['QueueArn'] }).promise();
    console.log('✅ Connected to SQS queue');
  } catch (error: any) {
    console.error('❌ Failed to connect to SQS queue:', error.message);
    console.error('Make sure LocalStack is running and the queue is created');
    process.exit(1);
  }

  // Check notification channels
  console.log('📢 Notification channels:');
  console.log(`   Slack: ${SLACK_WEBHOOK_URL ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`   Email: ${SMTP_HOST && NOTIFICATION_EMAIL ? '✅ Configured' : '❌ Not configured'}`);

  if (!SLACK_WEBHOOK_URL && (!SMTP_HOST || !NOTIFICATION_EMAIL)) {
    console.warn('⚠️ No notification channels configured. Notifications will be logged only.');
  }

  console.log('✅ Notify service ready');
  console.log('🔄 Starting notification processing loop...\n');

  // Start polling loop
  while (true) {
    await pollSQS();
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// Start processing notifications
processNotifications().catch((error) => {
  console.error('❌ Error starting notify service:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Notify service shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 Notify service shutting down...');
  process.exit(0);
});

