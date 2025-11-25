import { Router, Request, Response } from 'express';
import { SNS } from 'aws-sdk';
import dotenv from 'dotenv';
import path from 'path';
import { logToCloudWatch } from '../services/cloudwatch';

// Load .env from root directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const router = Router();

const sns = new SNS({
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.AWS_ENDPOINT || undefined, // For LocalStack
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
});

const TOPIC_ARN = process.env.OBSERVABILITY_TOPIC_ARN || '';

// Log configuration on startup
console.log('📡 Gateway Logs Route Configuration:');
console.log(`   SNS Endpoint: ${process.env.AWS_ENDPOINT || 'default'}`);
console.log(`   SNS Region: ${process.env.AWS_REGION || 'us-east-1'}`);
console.log(`   Topic ARN: ${TOPIC_ARN || '❌ NOT CONFIGURED'}`);

// POST /api/logs - Send log data
router.post('/api/logs', async (req: Request, res: Response) => {
  try {
    const logData = {
      timestamp: new Date().toISOString(),
      level: req.body.level || 'info',
      message: req.body.message || '',
      service: req.body.service || 'unknown',
      metadata: req.body.metadata || {},
    };

    // Validate required fields
    if (!logData.message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Publish to SNS topic
    if (!TOPIC_ARN) {
      console.error('❌ OBSERVABILITY_TOPIC_ARN not found in environment variables');
      console.error(`   Current value: ${process.env.OBSERVABILITY_TOPIC_ARN || 'undefined'}`);
      return res.status(500).json({ 
        error: 'SNS topic not configured',
        details: 'OBSERVABILITY_TOPIC_ARN environment variable is not set'
      });
    }

    // Log to CloudWatch BEFORE publishing to SNS
    await logToCloudWatch('log', `${logData.level} - ${logData.message}`, logData);

    const params = {
      TopicArn: TOPIC_ARN,
      Message: JSON.stringify(logData),
      MessageAttributes: {
        type: {
          DataType: 'String',
          StringValue: 'log',
        },
      },
    };

    await sns.publish(params).promise();

    console.log(`📤 Published log to SNS: ${logData.level} - ${logData.message}`);

    res.status(200).json({
      success: true,
      message: 'Log sent successfully',
      logId: logData.timestamp,
    });
  } catch (error: any) {
    console.error('Error publishing log to SNS:', error);
    res.status(500).json({
      error: 'Failed to send log',
      message: error.message,
    });
  }
});

// GET /api/logs - Health check for logs endpoint
router.get('/api/logs/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'logs-gateway',
    snsConfigured: !!TOPIC_ARN,
  });
});

export default router;

