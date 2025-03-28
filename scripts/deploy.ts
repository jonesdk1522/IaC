import { execSync } from 'child_process';
import * as dotenv from 'dotenv';

dotenv.config();

const deploy = async () => {
  console.log('🚀 Deploying ClamAV Scanner...');

  // Deploy CDK Stack
  execSync('cdk deploy --require-approval never', {
    stdio: 'inherit',
    env: { ...process.env }
  });

  console.log('✅ Deployment complete!');
};

deploy().catch(console.error);
