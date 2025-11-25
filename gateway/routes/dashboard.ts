import { Router, Request, Response } from 'express';
import {
  getLogs,
  getMetrics,
  getTraces,
  getAIAnalysis,
  getDashboardStats,
} from '../services/database';
import { getCloudWatchLogs, getLogStreams } from '../services/cloudwatch-reader';
import { getAggregatedSummaries, transformSummariesForDashboard } from '../services/redis';

const router = Router();

// GET /api/dashboard/stats - Get dashboard statistics
router.get('/api/dashboard/stats', async (req: Request, res: Response) => {
  try {
    const stats = await getDashboardStats();
    res.status(200).json(stats);
  } catch (error: any) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({
      error: 'Failed to fetch dashboard stats',
      message: error.message,
    });
  }
});

// GET /api/logs - Get logs from Redis (with time window) or fallback to database
router.get('/api/logs', async (req: Request, res: Response) => {
  try {
    const { limit, level, service, startTime, endTime, windowMinutes, useRedis } = req.query;
    
    // If useRedis is true, fetch from Redis
    if (useRedis === 'true') {
      const window = windowMinutes ? parseInt(windowMinutes as string) : 5;
      const summaries = await getAggregatedSummaries(window);
      const transformed = transformSummariesForDashboard(summaries);
      
      // Get log entries from transformed data
      let logs = transformed.logs.logEntries || [];
      
      // Apply filters
      if (level) {
        logs = logs.filter(log => log.level === level);
      }
      if (service) {
        logs = logs.filter(log => log.service === service);
      }
      
      // Limit results
      const limitNum = limit ? parseInt(limit as string) : 50;
      logs = logs.slice(0, limitNum);
      
      return res.status(200).json({
        success: true,
        count: logs.length,
        logs,
        source: 'redis',
        windowMinutes: window,
      });
    }
    
    // Fallback to database
    const logs = await getLogs({
      limit: limit ? parseInt(limit as string) : undefined,
      level: level as string,
      service: service as string,
      startTime: startTime as string,
      endTime: endTime as string,
    });

    res.status(200).json({
      success: true,
      count: logs.length,
      logs,
      source: 'database',
    });
  } catch (error: any) {
    console.error('Error fetching logs:', error);
    res.status(500).json({
      error: 'Failed to fetch logs',
      message: error.message,
    });
  }
});

// GET /api/metrics - Get metrics from Redis (with time window) or fallback to database
router.get('/api/metrics', async (req: Request, res: Response) => {
  try {
    const { limit, service, startTime, endTime, windowMinutes, useRedis } = req.query;
    
    // If useRedis is true, fetch from Redis
    if (useRedis === 'true') {
      const window = windowMinutes ? parseInt(windowMinutes as string) : 5;
      const summaries = await getAggregatedSummaries(window);
      const transformed = transformSummariesForDashboard(summaries);
      
      let metrics = transformed.metrics;
      
      // Apply filters
      if (service) {
        metrics = metrics.filter(m => m.service === service);
      }
      
      // Limit results
      const limitNum = limit ? parseInt(limit as string) : 20;
      metrics = metrics.slice(0, limitNum);
      
      return res.status(200).json({
        success: true,
        count: metrics.length,
        metrics,
        source: 'redis',
        windowMinutes: window,
      });
    }
    
    // Fallback to database
    const metrics = await getMetrics({
      limit: limit ? parseInt(limit as string) : undefined,
      service: service as string,
      startTime: startTime as string,
      endTime: endTime as string,
    });

    res.status(200).json({
      success: true,
      count: metrics.length,
      metrics,
      source: 'database',
    });
  } catch (error: any) {
    console.error('Error fetching metrics:', error);
    res.status(500).json({
      error: 'Failed to fetch metrics',
      message: error.message,
    });
  }
});

// GET /api/traces - Get traces from Redis (with time window) or fallback to database
router.get('/api/traces', async (req: Request, res: Response) => {
  try {
    const { limit, traceId, service, startTime, endTime, windowMinutes, useRedis } = req.query;
    
    // If useRedis is true, fetch from Redis
    if (useRedis === 'true') {
      const window = windowMinutes ? parseInt(windowMinutes as string) : 5;
      const summaries = await getAggregatedSummaries(window);
      const transformed = transformSummariesForDashboard(summaries);
      
      let traces = transformed.traces;
      
      // Apply filters
      if (service) {
        traces = traces.filter(t => t.service === service);
      }
      if (traceId) {
        traces = traces.filter(t => t.trace_id?.includes(traceId as string));
      }
      
      // Limit results
      const limitNum = limit ? parseInt(limit as string) : 20;
      traces = traces.slice(0, limitNum);
      
      return res.status(200).json({
        success: true,
        count: traces.length,
        traces,
        source: 'redis',
        windowMinutes: window,
      });
    }
    
    // Fallback to database
    const traces = await getTraces({
      limit: limit ? parseInt(limit as string) : undefined,
      traceId: traceId as string,
      service: service as string,
      startTime: startTime as string,
      endTime: endTime as string,
    });

    res.status(200).json({
      success: true,
      count: traces.length,
      traces,
      source: 'database',
    });
  } catch (error: any) {
    console.error('Error fetching traces:', error);
    res.status(500).json({
      error: 'Failed to fetch traces',
      message: error.message,
    });
  }
});

// GET /api/ai-analysis - Get AI analysis results
router.get('/api/ai-analysis', async (req: Request, res: Response) => {
  try {
    const { limit, startTime, endTime } = req.query;
    
    const analysis = await getAIAnalysis({
      limit: limit ? parseInt(limit as string) : undefined,
      startTime: startTime as string,
      endTime: endTime as string,
    });

    res.status(200).json({
      success: true,
      count: analysis.length,
      analysis,
    });
  } catch (error: any) {
    console.error('Error fetching AI analysis:', error);
    res.status(500).json({
      error: 'Failed to fetch AI analysis',
      message: error.message,
    });
  }
});

// GET /api/cloudwatch-logs - Get CloudWatch logs
router.get('/api/cloudwatch-logs', async (req: Request, res: Response) => {
  try {
    const { limit, startTime, endTime, logStream } = req.query;
    
    const logs = await getCloudWatchLogs(
      limit ? parseInt(limit as string) : 50,
      startTime ? parseInt(startTime as string) : undefined,
      endTime ? parseInt(endTime as string) : undefined,
      logStream as string | undefined
    );

    res.status(200).json({
      success: true,
      count: logs.length,
      logs,
    });
  } catch (error: any) {
    console.error('Error fetching CloudWatch logs:', error);
    res.status(500).json({
      error: 'Failed to fetch CloudWatch logs',
      message: error.message,
    });
  }
});

// GET /api/cloudwatch-streams - Get available log streams
router.get('/api/cloudwatch-streams', async (req: Request, res: Response) => {
  try {
    const streams = await getLogStreams();
    
    res.status(200).json({
      success: true,
      count: streams.length,
      streams,
    });
  } catch (error: any) {
    console.error('Error fetching CloudWatch streams:', error);
    res.status(500).json({
      error: 'Failed to fetch CloudWatch streams',
      message: error.message,
    });
  }
});

export default router;

