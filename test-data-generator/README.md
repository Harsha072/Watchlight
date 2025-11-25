# Test Data Generator

Generates realistic observability data (logs, metrics, traces) to test the Watchlight observability mesh.

## Features

- **Realistic Data**: Generates logs, metrics, and traces that mimic real application behavior
- **Multiple Scenarios**: Simulates normal operation, high load, errors, slow requests, and mixed scenarios
- **Continuous Generation**: Sends data continuously at configurable intervals
- **Production Ready**: Works locally and when deployed to cloud platforms

## Scenarios

### Normal
- 2% error rate
- 5% slow requests
- Normal request rate
- CPU: ~40-60%
- Memory: ~50-65%

### High Load
- 5% error rate
- 15% slow requests
- 5x request rate
- CPU: ~75-95%
- Memory: ~80-95%

### Errors
- 25% error rate
- 10% slow requests
- Normal request rate
- CPU: ~60-80%
- Memory: ~65-80%

### Slow
- 3% error rate
- 30% slow requests
- Normal request rate
- CPU: ~50-70%
- Memory: ~55-70%

### Mixed
- 10% error rate
- 20% slow requests
- 3x request rate
- CPU: ~65-85%
- Memory: ~70-85%

## Installation

```bash
cd test-data-generator
npm install
```

## Configuration

Copy `.env.example` to `.env` and configure:

```env
GATEWAY_URL=http://localhost:3000
GENERATION_INTERVAL=2000
SCENARIO=normal
```

## Usage

### Local Development

```bash
npm run dev
```

### Production/Deployed

```bash
npm run build
npm start
```

Or set environment variables:
```bash
GATEWAY_URL=https://your-gateway.onrender.com SCENARIO=high-load npm start
```

## What It Generates

### Logs
- Info, warn, error, and debug levels
- Realistic messages for each service
- Metadata including request IDs, error codes, response times
- Service-specific context (database queries, API calls, etc.)

### Metrics
- Request counts and error rates
- Response time metrics (avg, p95, p99)
- Resource usage (CPU, memory)
- Active connections and throughput
- Per-service metrics

### Traces
- Distributed traces with multiple spans
- Service dependency chains
- Operation timing
- Error propagation
- Realistic service interactions

## Services Simulated

- api-gateway
- auth-service
- user-service
- order-service
- payment-service
- product-service
- notification-service
- database

## Output Example

```
🚀 Test Data Generator Starting...
   Gateway URL: http://localhost:3000
   Scenario: normal
   Interval: 2000ms
   Error Rate: 2.0%
   Slow Request Rate: 5.0%
   Generating data...

📊 [api-gateway] Requests: 125, Errors: 2, CPU: 45%
✅ [api-gateway] GET /api/users - 245ms (3 spans)
⚠️  [payment-service] Slow database query detected
❌ [order-service] Payment processing failed

📈 Summary: 20 requests sent, 1 errors generated
```

## Environment Variables

- `GATEWAY_URL`: Your gateway service URL (default: http://localhost:3000)
- `GENERATION_INTERVAL`: Milliseconds between data generation (default: 2000)
- `SCENARIO`: Which scenario to run (default: normal)

## Integration

The generator sends data to:
- `POST /api/logs` - For log data
- `POST /api/metrics` - For metrics data
- `POST /api/traces` - For trace data

Make sure your gateway service is running and configured to receive these requests.

