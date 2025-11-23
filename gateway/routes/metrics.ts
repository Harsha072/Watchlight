import { Router, Request, Response } from 'express';
import { SNS } from 'aws-sdk';
import dotenv from 'dotenv';
import path from 'path';

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

// POST /api/metrics - Send metrics data
router.post('/api/metrics', async (req: Request, res: Response) => {
  try {
    const metricData = {
      timestamp: new Date().toISOString(),
      service: req.body.service || 'unknown',
      metrics: req.body.metrics || {},
    };

    // Validate required fields
    if (!metricData.service || !metricData.metrics) {
      return res.status(400).json({ error: 'Service and metrics are required' });
    }

    // Publish to SNS topic
    if (!TOPIC_ARN) {
      console.error('❌ OBSERVABILITY_TOPIC_ARN not found in environment variables');
      return res.status(500).json({ 
        error: 'SNS topic not configured',
        details: 'OBSERVABILITY_TOPIC_ARN environment variable is not set'
      });
    }

    const params = {
      TopicArn: TOPIC_ARN,
      Message: JSON.stringify(metricData),
      MessageAttributes: {
        type: {
          DataType: 'String',
          StringValue: 'metric',
        },
      },
    };

    await sns.publish(params).promise();

    console.log(`📊 Published metrics to SNS: ${metricData.service}`);

    res.status(200).json({
      success: true,
      message: 'Metrics sent successfully',
      timestamp: metricData.timestamp,
    });
  } catch (error: any) {
    console.error('Error publishing metrics to SNS:', error);
    res.status(500).json({
      error: 'Failed to send metrics',
      message: error.message,
    });
  }
});

// GET /api/metrics/health - Health check
router.get('/api/metrics/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'metrics-gateway',
    snsConfigured: !!TOPIC_ARN,
  });
});

export default router;

