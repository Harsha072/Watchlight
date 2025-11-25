/**
 * Simple statistical anomaly detection
 * Uses basic statistical methods that any 2-3 year SDE can understand:
 * - Mean and standard deviation
 * - Z-score calculation
 * - Threshold-based detection
 */

interface MetricValue {
  timestamp: string;
  value: number;
  service?: string;
}

interface AnomalyResult {
  isAnomaly: boolean;
  metric: string;
  currentValue: number;
  expectedRange: { min: number; max: number };
  zScore: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
}

/**
 * Calculate mean (average) of values
 * Simple average: sum all values, divide by count
 */
function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, val) => acc + val, 0);
  return sum / values.length;
}

/**
 * Calculate standard deviation
 * Measures how spread out the values are from the mean
 */
function calculateStdDev(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
  const avgSquaredDiff = calculateMean(squaredDiffs);
  return Math.sqrt(avgSquaredDiff);
}

/**
 * Calculate Z-score
 * Z-score tells us how many standard deviations a value is from the mean
 * Z-score > 2 or < -2 is usually considered an anomaly
 */
function calculateZScore(value: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 0;
  return (value - mean) / stdDev;
}

/**
 * Detect anomalies in error rate
 * Compares current error rate against historical average
 */
export function detectErrorRateAnomaly(
  historicalSummaries: any[],
  currentSummary: any
): AnomalyResult | null {
  if (historicalSummaries.length < 3) {
    // Need at least 3 data points to detect anomalies
    return null;
  }

  // Extract error rates from historical data
  const errorRates: number[] = [];
  
  historicalSummaries.forEach((summary) => {
    if (summary.metrics && summary.metrics.length > 0) {
      summary.metrics.forEach((metric: any) => {
        if (metric.totalRequests > 0) {
          const errorRate = (metric.totalErrors / metric.totalRequests) * 100;
          errorRates.push(errorRate);
        }
      });
    }
  });

  if (errorRates.length === 0) return null;

  // Calculate statistics
  const mean = calculateMean(errorRates);
  const stdDev = calculateStdDev(errorRates, mean);

  // Get current error rate
  let currentErrorRate = 0;
  if (currentSummary.metrics && currentSummary.metrics.length > 0) {
    const totalErrors = currentSummary.metrics.reduce((sum: number, m: any) => sum + m.totalErrors, 0);
    const totalRequests = currentSummary.metrics.reduce((sum: number, m: any) => sum + m.totalRequests, 0);
    if (totalRequests > 0) {
      currentErrorRate = (totalErrors / totalRequests) * 100;
    }
  }

  // Calculate Z-score
  const zScore = calculateZScore(currentErrorRate, mean, stdDev);

  // Threshold: Z-score > 2 means value is 2 standard deviations above mean (unusual)
  // Also check if error rate is above 5% (absolute threshold)
  const isAnomaly = Math.abs(zScore) > 2 || currentErrorRate > 5;

  if (!isAnomaly) return null;

  // Determine severity
  let severity: 'low' | 'medium' | 'high' | 'critical' = 'low';
  if (currentErrorRate > 20 || Math.abs(zScore) > 3) {
    severity = 'critical';
  } else if (currentErrorRate > 10 || Math.abs(zScore) > 2.5) {
    severity = 'high';
  } else if (currentErrorRate > 5 || Math.abs(zScore) > 2) {
    severity = 'medium';
  }

  return {
    isAnomaly: true,
    metric: 'error_rate',
    currentValue: currentErrorRate,
    expectedRange: {
      min: Math.max(0, mean - 2 * stdDev),
      max: mean + 2 * stdDev,
    },
    zScore,
    severity,
    message: `Error rate anomaly detected: ${currentErrorRate.toFixed(2)}% (expected: ${mean.toFixed(2)}% ± ${stdDev.toFixed(2)}%)`,
  };
}

/**
 * Detect anomalies in response latency (P95)
 * Compares current latency against historical average
 */
export function detectLatencyAnomaly(
  historicalSummaries: any[],
  currentSummary: any
): AnomalyResult | null {
  if (historicalSummaries.length < 3) {
    return null;
  }

  // Extract P95 latencies from historical data
  const latencies: number[] = [];
  
  historicalSummaries.forEach((summary) => {
    if (summary.metrics && summary.metrics.length > 0) {
      summary.metrics.forEach((metric: any) => {
        if (metric.p95Latency && metric.p95Latency > 0) {
          latencies.push(metric.p95Latency);
        }
      });
    }
  });

  if (latencies.length === 0) return null;

  // Calculate statistics
  const mean = calculateMean(latencies);
  const stdDev = calculateStdDev(latencies, mean);

  // Get current average P95 latency
  let currentLatency = 0;
  if (currentSummary.metrics && currentSummary.metrics.length > 0) {
    const latencies = currentSummary.metrics
      .map((m: any) => m.p95Latency)
      .filter((l: number) => l > 0);
    if (latencies.length > 0) {
      currentLatency = calculateMean(latencies);
    }
  }

  // Calculate Z-score
  const zScore = calculateZScore(currentLatency, mean, stdDev);

  // Threshold: Z-score > 2 or latency > 1000ms
  const isAnomaly = Math.abs(zScore) > 2 || currentLatency > 1000;

  if (!isAnomaly) return null;

  // Determine severity
  let severity: 'low' | 'medium' | 'high' | 'critical' = 'low';
  if (currentLatency > 2000 || Math.abs(zScore) > 3) {
    severity = 'critical';
  } else if (currentLatency > 1500 || Math.abs(zScore) > 2.5) {
    severity = 'high';
  } else if (currentLatency > 1000 || Math.abs(zScore) > 2) {
    severity = 'medium';
  }

  return {
    isAnomaly: true,
    metric: 'latency',
    currentValue: currentLatency,
    expectedRange: {
      min: Math.max(0, mean - 2 * stdDev),
      max: mean + 2 * stdDev,
    },
    zScore,
    severity,
    message: `Latency anomaly detected: ${currentLatency.toFixed(2)}ms (expected: ${mean.toFixed(2)}ms ± ${stdDev.toFixed(2)}ms)`,
  };
}

/**
 * Detect anomalies in request volume
 * Compares current request count against historical average
 */
export function detectVolumeAnomaly(
  historicalSummaries: any[],
  currentSummary: any
): AnomalyResult | null {
  if (historicalSummaries.length < 3) {
    return null;
  }

  // Extract request volumes from historical data
  const volumes: number[] = [];
  
  historicalSummaries.forEach((summary) => {
    if (summary.requestVolume && summary.requestVolume.total) {
      volumes.push(summary.requestVolume.total);
    }
  });

  if (volumes.length === 0) return null;

  // Calculate statistics
  const mean = calculateMean(volumes);
  const stdDev = calculateStdDev(volumes, mean);

  // Get current request volume
  const currentVolume = currentSummary.requestVolume?.total || 0;

  // Calculate Z-score
  const zScore = calculateZScore(currentVolume, mean, stdDev);

  // Threshold: Z-score > 2.5 (significant spike or drop)
  // Also check for significant drop (Z-score < -2) which could indicate issues
  const isAnomaly = Math.abs(zScore) > 2.5;

  if (!isAnomaly) return null;

  // Determine severity
  let severity: 'low' | 'medium' | 'high' | 'critical' = 'low';
  if (Math.abs(zScore) > 3.5) {
    severity = 'critical';
  } else if (Math.abs(zScore) > 3) {
    severity = 'high';
  } else if (Math.abs(zScore) > 2.5) {
    severity = 'medium';
  }

  const direction = zScore > 0 ? 'spike' : 'drop';
  
  return {
    isAnomaly: true,
    metric: 'request_volume',
    currentValue: currentVolume,
    expectedRange: {
      min: Math.max(0, mean - 2 * stdDev),
      max: mean + 2 * stdDev,
    },
    zScore,
    severity,
    message: `Request volume ${direction} detected: ${currentVolume} requests (expected: ${mean.toFixed(0)} ± ${stdDev.toFixed(0)})`,
  };
}

/**
 * Main anomaly detection function
 * Checks all metrics and returns first detected anomaly
 */
export function detectAnomalies(
  historicalSummaries: any[],
  currentSummary: any
): AnomalyResult | null {
  // Check error rate first (most critical)
  const errorAnomaly = detectErrorRateAnomaly(historicalSummaries, currentSummary);
  if (errorAnomaly) {
    return errorAnomaly;
  }

  // Check latency
  const latencyAnomaly = detectLatencyAnomaly(historicalSummaries, currentSummary);
  if (latencyAnomaly) {
    return latencyAnomaly;
  }

  // Check request volume
  const volumeAnomaly = detectVolumeAnomaly(historicalSummaries, currentSummary);
  if (volumeAnomaly) {
    return volumeAnomaly;
  }

  // No anomalies detected
  return null;
}

