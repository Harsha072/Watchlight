# Testing the Logs Service

## Quick Test Guide

### 1. Start Infrastructure
```bash
docker-compose up -d
```

### 2. Set up LocalStack
```bash
node infra/localstack-setup.js
```

### 3. Start Logs Service
```bash
cd logs-service
npm run dev
```

### 4. Start Gateway (in another terminal)
```bash
cd gateway
npm run dev
```

### 5. Send Test Log

Using curl:
```bash
curl -X POST http://localhost:3000/api/logs \
  -H "Content-Type: application/json" \
  -d '{
    "level": "info",
    "message": "Test log message",
    "service": "test-service",
    "metadata": {
      "userId": "123",
      "action": "login"
    }
  }'
```

Using PowerShell:
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/logs" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{
    "level": "info",
    "message": "Test log message",
    "service": "test-service",
    "metadata": {
      "userId": "123",
      "action": "login"
    }
  }'
```

### Expected Flow:
1. Gateway receives POST request
2. Gateway publishes to SNS topic
3. SNS forwards to SQS logs-queue
4. Logs service polls and receives message
5. Logs service processes message
6. Logs service saves to PostgreSQL database
7. Logs service displays "✅ DB was saved successfully"

### Expected Output in Logs Service:
```
🚀 Logs service starting...
📡 Queue URL: http://localhost:4566/000000000000/logs-queue
🔌 Testing PostgreSQL connection...
✅ PostgreSQL connection successful!
   Server time: 2024-01-01T12:00:00.000Z
📊 Initializing database tables...
✅ Database tables initialized successfully
✅ Connected to SQS queue
✅ Logs service ready to consume messages
🔄 Starting polling loop...

📨 Received 1 message(s)
[2024-01-01T12:00:00.000Z] Processing log: { level: 'info', message: 'Test log message', service: 'test-service' }
📝 Log saved to database: info - Test log message
✅ DB was saved successfully
✅ Message processed and deleted from queue
```

### Verify Data in Database:

Connect to PostgreSQL and check the logs:
```bash
# Using docker exec
docker exec -it watchlight-postgres psql -U watchlight -d watchlight

# Then run:
SELECT * FROM logs ORDER BY created_at DESC LIMIT 10;
```

Or using psql directly:
```bash
psql postgresql://watchlight:watchlight123@localhost:5432/watchlight
SELECT * FROM logs ORDER BY created_at DESC LIMIT 10;
```

