const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('🚀 Starting Watchlight - API Observability Mesh\n');

// Check if .env exists
const envPath = path.join(__dirname, '../.env');
if (!fs.existsSync(envPath)) {
  console.error('❌ .env file not found!');
  console.error('   Please copy infra/env.example to .env and configure it.');
  process.exit(1);
}

// Services to start
const services = [
  { name: 'Gateway', dir: 'gateway', command: 'npm', args: ['run', 'dev'] },
  { name: 'Logs Service', dir: 'logs-service', command: 'npm', args: ['run', 'dev'] },
  { name: 'Metrics Service', dir: 'metrics-service', command: 'npm', args: ['run', 'dev'] },
  { name: 'Trace Service', dir: 'trace-service', command: 'npm', args: ['run', 'dev'] },
  { name: 'Cron Aggregator', dir: 'cron-aggregator', command: 'npm', args: ['run', 'dev'] },
];

const processes = [];

// Start all services
services.forEach((service, index) => {
  const servicePath = path.join(__dirname, '..', service.dir);
  
  // Check if service directory exists
  if (!fs.existsSync(servicePath)) {
    console.error(`❌ Service directory not found: ${service.dir}`);
    return;
  }

  // Small delay between starting services to avoid port conflicts
  setTimeout(() => {
    console.log(`📦 Starting ${service.name}...`);
    
    const proc = spawn(service.command, service.args, {
      cwd: servicePath,
      shell: true,
      stdio: 'inherit',
    });

    proc.on('error', (error) => {
      console.error(`❌ Failed to start ${service.name}:`, error.message);
    });

    proc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`❌ ${service.name} exited with code ${code}`);
      }
    });

    processes.push({ name: service.name, process: proc });
  }, index * 500); // 500ms delay between each service
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutting down all services...');
  processes.forEach(({ name, process: proc }) => {
    console.log(`   Stopping ${name}...`);
    proc.kill('SIGINT');
  });
  setTimeout(() => {
    console.log('✅ All services stopped');
    process.exit(0);
  }, 2000);
});

process.on('SIGTERM', () => {
  console.log('\n\n🛑 Shutting down all services...');
  processes.forEach(({ name, process: proc }) => {
    proc.kill('SIGTERM');
  });
  setTimeout(() => {
    process.exit(0);
  }, 2000);
});

console.log('\n✅ All services starting...');
console.log('   Press Ctrl+C to stop all services\n');

