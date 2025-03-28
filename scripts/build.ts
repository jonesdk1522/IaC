import { execSync } from 'child_process';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const buildProject = async () => {
  console.log('🏗️ Building ClamAV Scanner...');

  // Build ClamAV Layer
  console.log('📦 Building ClamAV Layer...');
  execSync(`docker build -t clamav-layer ${path.join(__dirname, '../lambda-layer')}`, {
    stdio: 'inherit'
  });

  // Extract layer
  execSync('docker run --rm -v "$PWD/lambda-layer":/out clamav-layer cp /layer.zip /out/', {
    stdio: 'inherit'
  });

  // Build Lambda
  console.log('🔨 Building Lambda function...');
  execSync('npm run build:lambda', { stdio: 'inherit' });

  console.log('✅ Build complete!');
};

buildProject().catch(console.error);
