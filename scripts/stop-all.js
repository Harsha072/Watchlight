const { exec } = require('child_process');
const os = require('os');

console.log('🛑 Stopping all Watchlight services...\n');

const platform = os.platform();

if (platform === 'win32') {
  // Windows
  exec('taskkill /F /IM node.exe /T', (error) => {
    if (error) {
      console.log('   No Node.js processes found or already stopped');
    } else {
      console.log('✅ All Node.js processes stopped');
    }
  });
} else {
  // Linux/Mac
  exec('pkill -f "ts-node-dev"', (error) => {
    if (error) {
      console.log('   No processes found or already stopped');
    } else {
      console.log('✅ All services stopped');
    }
  });
}

