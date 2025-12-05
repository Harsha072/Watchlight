import { Router, Request, Response } from 'express';
import {
  getLogs,
  getMetrics,
  getTraces,
  getAIAnalysis,
  getDashboardStats,
} from '../services/database';
import { getCloudWatchLogs, getLogStreams } from '../services/cloudwatch-reader';
import { getAggregatedSummaries, transformSummariesForDashboard, getAIAnalysisFromRedis } from '../services/redis';

const router = Router();

// GET /api/dashboard/stats - Get dashboard statistics (always from database)
router.get('/api/dashboard/stats', async (req: Request, res: Response) => {
  try {
    console.log(`📊 [GET /api/dashboard/stats] Request received - Fetching from DATABASE`);
    const stats = await getDashboardStats();
    console.log(`   ✅ [DATABASE] Dashboard stats: ${stats.logs?.total || 0} logs, ${stats.metrics?.total || 0} metrics, ${stats.traces?.total || 0} traces`);
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
    
    // Log request details
    console.log(`📊 [GET /api/metrics] Request received - useRedis: ${useRedis}, windowMinutes: ${windowMinutes}, service: ${service || 'all'}, limit: ${limit || 'default'}`);
    
    // If useRedis is true, fetch from Redis
    if (useRedis === 'true') {
      const window = windowMinutes ? parseInt(windowMinutes as string) : 5;
      console.log(`   🔴 Fetching metrics from REDIS (window: ${window} minutes)`);
      
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
      
      console.log(`   ✅ [REDIS] Returning ${metrics.length} metrics`);
      
      return res.status(200).json({
        success: true,
        count: metrics.length,
        metrics,
        source: 'redis',
        windowMinutes: window,
      });
    }
    
    // Fallback to database
    console.log(`   🗄️  Fetching metrics from DATABASE`);
    const metrics = await getMetrics({
      limit: limit ? parseInt(limit as string) : undefined,
      service: service as string,
      startTime: startTime as string,
      endTime: endTime as string,
    });

    console.log(`   ✅ [DATABASE] Returning ${metrics.length} metrics`);

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
    
    // Log request details
    console.log(`🔍 [GET /api/traces] Request received - useRedis: ${useRedis}, windowMinutes: ${windowMinutes}, service: ${service || 'all'}, limit: ${limit || 'default'}`);
    
    // If useRedis is true, fetch from Redis
    if (useRedis === 'true') {
      const window = windowMinutes ? parseInt(windowMinutes as string) : 5;
      console.log(`   🔴 Fetching traces from REDIS (window: ${window} minutes)`);
      
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
      
      console.log(`   ✅ [REDIS] Returning ${traces.length} traces`);
      
      return res.status(200).json({
        success: true,
        count: traces.length,
        traces,
        source: 'redis',
        windowMinutes: window,
      });
    }
    
    // Fallback to database
    console.log(`   🗄️  Fetching traces from DATABASE`);
    const traces = await getTraces({
      limit: limit ? parseInt(limit as string) : undefined,
      traceId: traceId as string,
      service: service as string,
      startTime: startTime as string,
      endTime: endTime as string,
    });

    console.log(`   ✅ [DATABASE] Returning ${traces.length} traces`);

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

// GET /api/anomaly-timeline - Get anomaly detection timeline (all anomalies chronologically) - DATABASE ONLY
router.get('/api/anomaly-timeline', async (req: Request, res: Response) => {
  try {
    const { limit, startTime, endTime } = req.query;
    const limitNum = limit ? parseInt(limit as string) : 50;
    
    console.log(`📅 [GET /api/anomaly-timeline] Request received - limit: ${limitNum}`);
    console.log(`   🗄️  Fetching anomaly timeline from DATABASE (no Redis, permanent storage only)...`);
    
    // Fetch all AI analyses (which represent detected anomalies) from database ONLY
    // Timeline uses database for historical accuracy
    const analysis = await getAIAnalysis({
      limit: limitNum,
      startTime: startTime as string,
      endTime: endTime as string,
    });

    // Map and sort by timestamp (oldest first for timeline display)
    const timeline = analysis
      .map(a => {
        // Handle different possible column names from different services
        const timestamp = a.timestamp || a.created_at;
        const severity = a.severity || 'medium';
        const metric = a.metric || 'unknown';
        const message = a.message || 'Anomaly detected';
        const provider = a.provider || 'unknown';
        const analysisText = a.analysis || '';
        
        return {
          id: a.id,
          timestamp,
          severity,
          metric,
          message,
          provider,
          analysis: analysisText,
        };
      })
      .filter(a => a.timestamp) // Filter out any entries without timestamp
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()); // Oldest first for timeline

    console.log(`   ✅ [DATABASE] Returning ${timeline.length} anomalies for timeline`);

    res.status(200).json({
      success: true,
      count: timeline.length,
      timeline,
      source: 'database',
    });
  } catch (error: any) {
    console.error('❌ Error fetching anomaly timeline:', error);
    res.status(500).json({
      error: 'Failed to fetch anomaly timeline',
      message: error.message,
    });
  }
});

// GET /api/ai-analysis - Get AI analysis results (Redis first, then database fallback)
router.get('/api/ai-analysis', async (req: Request, res: Response) => {
  try {
    const { limit, startTime, endTime, useRedis } = req.query;
    const limitNum = limit ? parseInt(limit as string) : 10;
    
    // Log request details
    console.log(`🤖 [GET /api/ai-analysis] Request received - useRedis: ${useRedis !== 'false' ? 'true' : 'false'}, limit: ${limitNum}`);
    
    // Try Redis first (if useRedis is not explicitly false)
    if (useRedis !== 'false') {
      console.log(`   🔴 Fetching AI analysis from REDIS...`);
      try {
        const redisAnalysis = await getAIAnalysisFromRedis(limitNum);
        
        if (redisAnalysis && redisAnalysis.length > 0) {
          console.log(`   ✅ [REDIS] Returning ${redisAnalysis.length} AI analyses`);
          
          // Apply time filters if provided
          let filtered = redisAnalysis;
          if (startTime) {
            const start = new Date(startTime as string);
            filtered = filtered.filter(a => new Date(a.timestamp) >= start);
          }
          if (endTime) {
            const end = new Date(endTime as string);
            filtered = filtered.filter(a => new Date(a.timestamp) <= end);
          }
          
          return res.status(200).json({
            success: true,
            count: filtered.length,
            analysis: filtered,
            source: 'redis',
          });
        } else {
          console.log(`   ⚠️  [REDIS] No AI analysis found, falling back to database...`);
        }
      } catch (redisError: any) {
        console.warn(`   ⚠️  [REDIS] Error fetching from Redis, falling back to database: ${redisError.message}`);
      }
    }
    
    // Fallback to database
    console.log(`   🗄️  Fetching AI analysis from DATABASE...`);
    const analysis = await getAIAnalysis({
      limit: limitNum,
      startTime: startTime as string,
      endTime: endTime as string,
    });

    console.log(`   ✅ [DATABASE] Returning ${analysis.length} AI analyses`);

    res.status(200).json({
      success: true,
      count: analysis.length,
      analysis,
      source: 'database',
    });
  } catch (error: any) {
    console.error('❌ Error fetching AI analysis:', error);
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

