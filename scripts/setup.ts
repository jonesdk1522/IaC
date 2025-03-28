import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const setupProject = async () => {
  console.log('🚀 Setting up ClamAV Scanner project...');

  // Create project structure
  const dirs = ['lib', 'lambda', 'lambda-layer', 'config'];
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  // Install dependencies
  console.log('📦 Installing dependencies...');
  execSync('npm install aws-cdk-lib @aws-sdk/credential-providers dotenv esbuild', { stdio: 'inherit' });

  // Generate .env if not exists
  if (!fs.existsSync('.env')) {
    const envContent = `REGION=us-east-1
STACK_NAME=clamav-scanner
UPLOAD_BUCKET_NAME=upload-${Date.now()}
CLEAN_BUCKET_NAME=clean-${Date.now()}
QUARANTINE_BUCKET_NAME=quarantine-${Date.now()}
AWS_PROFILE=default`;

    fs.writeFileSync('.env', envContent);
    console.log('✅ Created .env file');
  }

  // Configure AWS credentials if needed
  try {
    execSync('aws configure get aws_access_key_id', { stdio: 'pipe' });
  } catch {
    console.log('🔑 Setting up AWS credentials...');
    execSync('aws configure', { stdio: 'inherit' });
  }

  console.log('✅ Setup complete!');
};

setupProject().catch(console.error);
