# Quick Start - Test Data Generator

## 🚀 Quick Setup

### 1. Install Dependencies
```bash
cd test-data-generator
npm install
```

### 2. Configure (Optional)
Create `.env` file or use environment variables:
```env
GATEWAY_URL=http://localhost:3000
GENERATION_INTERVAL=2000
SCENARIO=normal
```

### 3. Make Sure Gateway is Running
```bash
# In another terminal
cd gateway
npm run dev
```

### 4. Start Generating Data
```bash
cd test-data-generator
npm run dev
```

## 📊 Scenarios

### Normal Operation
```bash
SCENARIO=normal npm run dev
```
- 2% error rate
- Normal traffic
- Healthy system

### High Load
```bash
SCENARIO=high-load npm run dev
```
- 5x request rate
- Higher CPU/memory
- More errors

### Error Scenario
```bash
SCENARIO=errors npm run dev
```
- 25% error rate
- Simulates system issues
- Great for testing error handling

### Slow Requests
```bash
SCENARIO=slow npm run dev
```
- 30% slow requests
- High latency
- Performance issues

### Mixed (Recommended for AI Analysis)
```bash
SCENARIO=mixed npm run dev
```
- Combination of all scenarios
- Most realistic
- Best for AI analyzer testing

## 🎯 What Gets Generated

### Every 2 seconds:
- **1-3 Logs** (info, warn, error, debug)
- **Metrics** (every 5 iterations = 10 seconds)
- **Traces** (every 3 iterations = 6 seconds)

### Example Output:
```
🚀 Test Data Generator Starting...
   Gateway URL: http://localhost:3000
   Scenario: mixed
   Interval: 2000ms
   Error Rate: 10.0%
   Slow Request Rate: 20.0%
   Generating data...

📊 [api-gateway] Requests: 375, Errors: 37, CPU: 72%
✅ [api-gateway] POST /api/orders - 1250ms (4 spans)
⚠️  [payment-service] Slow database query detected
❌ [order-service] Payment processing failed
📊 [user-service] Requests: 250, Errors: 25, CPU: 68%
🔍 [auth-service] login - 450ms (3 spans)

📈 Summary: 40 requests sent, 4 errors generated
```

## 🌐 Deploy to Render/Cloud

### Option 1: Environment Variables
Set in Render dashboard:
- `GATEWAY_URL=https://your-gateway.onrender.com`
- `SCENARIO=mixed`
- `GENERATION_INTERVAL=2000`

### Option 2: Build and Run
```bash
npm run build
npm start
```

## 📝 Data Generated

### Logs Include:
- ✅ Success operations
- ⚠️ Warnings (slow queries, high memory)
- ❌ Errors (failures, timeouts)
- 🔍 Debug information

### Metrics Include:
- Request counts
- Error rates
- Response times (avg, p95, p99)
- CPU and memory usage
- Active connections
- Throughput

### Traces Include:
- Distributed traces
- Service dependencies
- Operation timing
- Error propagation
- Multi-span requests

## 🎨 Services Simulated

1. **api-gateway** - Entry point
2. **auth-service** - Authentication
3. **user-service** - User management
4. **order-service** - Order processing
5. **payment-service** - Payment processing
6. **product-service** - Product catalog
7. **notification-service** - Notifications
8. **database** - Database operations

## 💡 Tips

- **For AI Analysis**: Use `SCENARIO=mixed` for diverse data
- **For Testing Errors**: Use `SCENARIO=errors`
- **For Performance Testing**: Use `SCENARIO=slow`
- **For Load Testing**: Use `SCENARIO=high-load`

## 🔗 Integration

The generator automatically sends data to:
- `POST /api/logs` → Logs Service
- `POST /api/metrics` → Metrics Service  
- `POST /api/traces` → Trace Service

All data flows through:
**Generator → Gateway → SNS → SQS → Services → Database → AI Analyzer**

