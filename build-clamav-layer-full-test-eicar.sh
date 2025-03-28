#!/bin/bash
set -euo pipefail

echo "📦 Building, deploying, and testing ClamAV Lambda Layer with real CVD files..."

### === Load config ===
ENV_FILE=".env"
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ .env file not found!"
  exit 1
fi
source "$ENV_FILE"

### === Validate CVDs ===
for file in main.cvd daily.cvd bytecode.cvd; do
  if [ ! -f "$file" ]; then
    echo "❌ Missing $file — must be a real ClamAV signature file."
    exit 1
  fi
done

### === Build Docker image ===
echo "🐳 Building Docker image..."
docker build -t clamav-lambda-layer -f Dockerfile.clamav-lambda-layer .

### === Extract the built Lambda layer zip ===
echo "📤 Extracting layer zip..."
docker run --rm -v "$PWD":/out clamav-lambda-layer cp /home/build/clamav_lambda_layer.zip /out/

### === Upload to S3 ===
echo "☁️ Uploading clamav_lambda_layer.zip to s3://$LAMBDA_CODE_BUCKET/ ..."
aws s3 cp clamav_lambda_layer.zip s3://$LAMBDA_CODE_BUCKET/ --region "$REGION"

### === Deploy or update CloudFormation stack ===
echo "🚀 Deploying CloudFormation stack: $STACK_NAME ..."
aws cloudformation deploy \
  --region "$REGION" \
  --stack-name "$STACK_NAME" \
  --template-file template.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    UploadsBucketName="$UPLOADS_BUCKET_NAME" \
    CleanBucketName="$CLEAN_BUCKET_NAME" \
    QuarantineBucketName="$QUARANTINE_BUCKET_NAME"

### === Upload test files ===
echo "🧪 Uploading clean test file..."
echo "This is a clean test file." > clean.txt
aws s3 cp clean.txt s3://$UPLOADS_BUCKET_NAME/ --region "$REGION"

echo "🧪 Uploading EICAR test virus file..."
echo 'X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*' > eicar.txt
aws s3 cp eicar.txt s3://$UPLOADS_BUCKET_NAME/ --region "$REGION"

echo "⏳ Waiting 20 seconds for Lambda scan to process..."
sleep 20

echo "🔍 Checking destinations..."
echo "Clean bucket:"
aws s3 ls s3://$CLEAN_BUCKET_NAME/ --region "$REGION"

echo "Quarantine bucket:"
aws s3 ls s3://$QUARANTINE_BUCKET_NAME/ --region "$REGION"

echo "✅ Test complete. Check if 'clean.txt' went to CLEAN and 'eicar.txt' went to QUARANTINE."
