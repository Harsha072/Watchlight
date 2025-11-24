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

// POST /api/ai-analyzer - Send aggregated observability data for AI analysis
router.post('/api/ai-analyzer', async (req: Request, res: Response) => {
  try {
    const observabilityData = {
      timestamp: new Date().toISOString(),
      metrics: req.body.metrics || {},
      logs: req.body.logs || {},
      traces: req.body.traces || {},
    };

    // Validate that at least one data type is provided
    if (!observabilityData.metrics && !observabilityData.logs && !observabilityData.traces) {
      return res.status(400).json({ error: 'At least one of metrics, logs, or traces must be provided' });
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
      Message: JSON.stringify(observabilityData),
      MessageAttributes: {
        type: {
          DataType: 'String',
          StringValue: 'ai-analyzer',
        },
      },
    };

    await sns.publish(params).promise();

    console.log(`🤖 Published aggregated observability data to SNS for AI analysis`);

    res.status(200).json({
      success: true,
      message: 'Observability data sent for AI analysis',
      timestamp: observabilityData.timestamp,
    });
  } catch (error: any) {
    console.error('Error publishing to SNS:', error);
    res.status(500).json({
      error: 'Failed to send observability data',
      message: error.message,
    });
  }
});

// GET /api/ai-analyzer/health - Health check
router.get('/api/ai-analyzer/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'ai-analyzer-gateway',
    snsConfigured: !!TOPIC_ARN,
  });
});

export default router;

