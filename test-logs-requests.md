# Test Logs Service - End-to-End Testing Guide

## Prerequisites

1. **Start all services:**
   ```bash
   # Terminal 1: Gateway
   cd gateway
   npm run dev
   
   # Terminal 2: Logs Service
   cd logs-service
   npm run dev
   ```

2. **Make sure LocalStack is set up:**
   ```bash
   node infra/localstack-setup.js
   ```

## API Endpoint

**Base URL:** `http://localhost:3000`

**Endpoint:** `POST /api/logs`

**Content-Type:** `application/json`

## Test Requests for Hopscotch/Postman

### 1. Simple Info Log

```json
{
  "level": "info",
  "message": "User logged in successfully",
  "service": "auth-service"
}
```

### 2. Error Log with Metadata

```json
{
  "level": "error",
  "message": "Database connection failed",
  "service": "database-service",
  "metadata": {
    "errorCode": "DB_CONN_001",
    "host": "postgres.example.com",
    "port": 5432,
    "retryCount": 3
  }
}
```

### 3. Warning Log

```json
{
  "level": "warn",
  "message": "High memory usage detected",
  "service": "monitoring-service",
  "metadata": {
    "memoryUsage": "85%",
    "threshold": "80%",
    "server": "web-server-01"
  }
}
```

### 4. Debug Log

```json
{
  "level": "debug",
  "message": "Processing API request",
  "service": "api-gateway",
  "metadata": {
    "method": "POST",
    "path": "/api/users",
    "userId": "12345",
    "requestId": "req-abc-123",
    "duration": "45ms"
  }
}
```

### 5. Complete Log Example

```json
{
  "level": "info",
  "message": "Order created successfully",
  "service": "order-service",
  "metadata": {
    "orderId": "ORD-12345",
    "userId": "user-789",
    "amount": 99.99,
    "currency": "USD",
    "items": [
      {
        "productId": "prod-001",
        "quantity": 2,
        "price": 49.99
      }
    ],
    "timestamp": "2024-11-23T10:30:00Z"
  }
}
```

## Using Hopscotch

1. **Create a new request:**
   - Method: `POST`
   - URL: `http://localhost:3000/api/logs`

2. **Set Headers:**
   - `Content-Type: application/json`

3. **Add Body:**
   - Select "JSON" format
   - Paste one of the JSON examples above

4. **Send Request**

## Using cURL (Command Line)

### Simple Test:
```bash
curl -X POST http://localhost:3000/api/logs \
  -H "Content-Type: application/json" \
  -d '{
    "level": "info",
    "message": "Test log message",
    "service": "test-service"
  }'
```

### With Metadata:
```bash
curl -X POST http://localhost:3000/api/logs \
  -H "Content-Type: application/json" \
  -d '{
    "level": "error",
    "message": "Payment processing failed",
    "service": "payment-service",
    "metadata": {
      "transactionId": "txn-12345",
      "errorCode": "PAY_001",
      "amount": 50.00
    }
  }'
```

## Using PowerShell

```powershell
$body = @{
    level = "info"
    message = "Test log from PowerShell"
    service = "test-service"
    metadata = @{
        testId = "test-001"
        timestamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ"
    }
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/api/logs" `
  -Method POST `
  -ContentType "application/json" `
  -Body $body
```

## Expected Flow

1. **Gateway receives request** → `POST /api/logs`
2. **Gateway publishes to SNS** → Topic: `observability-topic`
3. **SNS forwards to SQS** → Queue: `logs-queue`
4. **Logs Service polls SQS** → Receives message
5. **Logs Service processes** → Parses log data
6. **Logs Service saves to DB** → PostgreSQL database
7. **Success!** → You'll see "✅ DB was saved successfully"

## What to Watch For

### In Gateway Terminal:
```
📤 Published log to SNS: info - User logged in successfully
```

### In Logs Service Terminal:
```
📨 Received 1 message(s)
[2024-11-23T10:30:00.000Z] Processing log: { level: 'info', message: 'User logged in successfully', service: 'auth-service' }
📝 Log saved to database: info - User logged in successfully
✅ DB was saved successfully
✅ Message processed and deleted from queue
```

## Health Check

Test if gateway is running:
```bash
curl http://localhost:3000/health
```

Test if logs endpoint is configured:
```bash
curl http://localhost:3000/api/logs/health
```

## Verify Data in Database

After sending logs, verify they're saved:

```bash
# Using docker exec
docker exec -it watchlight-postgres psql -U watchlight -d watchlight -c "SELECT * FROM logs ORDER BY created_at DESC LIMIT 5;"
```

Or connect directly:
```bash
psql postgresql://watchlight:watchlight123@localhost:5432/watchlight
```

Then run:
```sql
SELECT id, timestamp, level, message, service, created_at 
FROM logs 
ORDER BY created_at DESC 
LIMIT 10;
```

## Troubleshooting

**If gateway returns 500 error:**
- Check if LocalStack is running: `docker-compose ps localstack`
- Verify SNS topic exists: Run `node infra/localstack-setup.js` again

**If logs service doesn't receive messages:**
- Check if logs service is running and connected to SQS
- Verify queue URL in `.env` file
- Check LocalStack logs: `docker-compose logs localstack`

**If database save fails:**
- Check PostgreSQL connection in logs service terminal
- Verify DATABASE_URL in `.env` file
- Check database is running: `docker-compose ps postgres`

