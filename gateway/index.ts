import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from root directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// Configure CORS for S3 deployment
// Allow requests from S3 bucket, CloudFront, and localhost for development
const corsOptions = {
  origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    // Allow requests with no origin (like mobile apps, Postman, or same-origin requests)
    if (!origin) return callback(null, true);
    
    // List of allowed origins
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      process.env.S3_BUCKET_URL,        // S3 bucket URL (e.g., https://your-bucket.s3.amazonaws.com)
      process.env.CLOUDFRONT_URL,        // CloudFront distribution URL
      process.env.FRONTEND_URL,         // Custom frontend URL
      process.env.GATEWAY_URL,          // Render gateway URL
    ].filter(Boolean); // Remove undefined values
    
    // Allow Render domains, localhost, S3/CloudFront, or allowed origins
    const isRenderDomain = origin.includes('.onrender.com') || 
                          origin.includes('.render.com');
    const isLocalhost = origin.includes('localhost') || 
                       origin.includes('127.0.0.1');
    const isS3CloudFront = origin.includes('.s3.') ||
                           origin.includes('.s3-website-') ||
                           origin.includes('cloudfront.net');
    
    if (allowedOrigins.includes(origin) || 
        isRenderDomain ||
        isLocalhost ||
        isS3CloudFront) {
      callback(null, true);
    } else {
      // For demo purposes, allow all origins
      // In production, you might want to be more strict
      callback(null, true);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', service: 'gateway' });
});

// Serve static files from public directory
// When compiled, __dirname is 'dist/', so public folder is at '../public'
// When running with ts-node, __dirname is the gateway root, so 'public' is correct
const publicPath = path.join(__dirname, '..', 'public');
app.use(express.static(publicPath));

// Serve index.html for root route and all non-API routes
app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Import routes
import logsRoutes from './routes/logs';
import metricsRoutes from './routes/metrics';
import tracesRoutes from './routes/traces';
import aiAnalyzerRoutes from './routes/ai-analyzer';
import dashboardRoutes from './routes/dashboard';
import { initializeCloudWatch } from './services/cloudwatch';

app.use('/', logsRoutes);
app.use('/', metricsRoutes);
app.use('/', tracesRoutes);
app.use('/', aiAnalyzerRoutes);
app.use('/', dashboardRoutes);

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler - only for API routes, not for static files
// For non-API routes, serve index.html (SPA fallback)
app.use((req: Request, res: Response) => {
  // If it's an API route (starts with /api), return 404 JSON
  if (req.path.startsWith('/api')) {
    res.status(404).json({ error: 'Route not found' });
  } else {
    // For all other routes, serve index.html (SPA routing)
    res.sendFile(path.join(publicPath, 'index.html'));
  }
});

// Initialize CloudWatch logging
initializeCloudWatch().catch((err) => {
  console.warn('⚠️ CloudWatch initialization warning:', err.message);
});

app.listen(PORT, () => {
  console.log(`Gateway service running on port ${PORT}`);
});

