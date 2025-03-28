#!/bin/bash
set -euo pipefail

echo "📦 Full ClamAV Lambda Layer Build, Deploy & Test (Clean + EICAR + Logging)"

### === Load config ===
ENV_FILE=".env"
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ .env file not found!"
  exit 1
fi
source "$ENV_FILE"

### === Validate real .cvd files ===
for file in main.cvd daily.cvd bytecode.cvd; do
  if [ ! -f "$file" ]; then
    echo "❌ Missing $file — must be a real ClamAV signature file (main.cvd, daily.cvd, bytecode.cvd)"
    exit 1
  fi
done

### === Build Docker layer image ===
echo "🐳 Building Docker image for Lambda layer..."
docker build -t clamav-lambda-layer -f Dockerfile.clamav-lambda-layer .

### === Extract Lambda layer zip ===
echo "📤 Extracting clamav_lambda_layer.zip from container..."
docker run --rm -v "$PWD":/out clamav-lambda-layer cp /home/build/clamav_lambda_layer.zip /out/

### === Upload Lambda layer to S3 ===
echo "☁️ Uploading to S3: s3://$LAMBDA_CODE_BUCKET/clamav_lambda_layer.zip"
aws s3 cp clamav_lambda_layer.zip s3://$LAMBDA_CODE_BUCKET/ --region "$REGION"

### === Upload handler zip ===
echo "📁 Uploading Lambda handler (clamav-lambda-handler.zip)"
aws s3 cp clamav-lambda-handler.zip s3://$LAMBDA_CODE_BUCKET/ --region "$REGION"

### === Deploy CloudFormation Stack ===
echo "🚀 Deploying CloudFormation stack: $STACK_NAME ..."
if ! aws cloudformation deploy \
  --region "$REGION" \
  --stack-name "$STACK_NAME" \
  --template-file clamav.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    UploadsBucketName="$UPLOADS_BUCKET_NAME" \
    CleanBucketName="$CLEAN_BUCKET_NAME" \
    QuarantineBucketName="$QUARANTINE_BUCKET_NAME"; then
    echo "❌ Stack deployment failed"
    exit 1
fi

# Verify stack creation
echo "🔍 Verifying stack deployment..."
STACK_STATUS=$(aws cloudformation describe-stacks \
    --region "$REGION" \
    --stack-name "$STACK_NAME" \
    --query 'Stacks[0].StackStatus' \
    --output text)

if [ "$STACK_STATUS" != "CREATE_COMPLETE" ] && [ "$STACK_STATUS" != "UPDATE_COMPLETE" ]; then
    echo "❌ Stack deployment failed with status: $STACK_STATUS"
    exit 1
fi

### === Upload test files ===
echo "🧪 Creating test files..."
TEST_ID=$(date +%s)
echo "This is a clean test file." > "clean-${TEST_ID}.txt"
echo 'X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*' > "eicar-${TEST_ID}.txt"

echo "📤 Uploading test files to s3://$UPLOADS_BUCKET_NAME/"
aws s3 cp "clean-${TEST_ID}.txt" "s3://$UPLOADS_BUCKET_NAME/" --region "$REGION"
aws s3 cp "eicar-${TEST_ID}.txt" "s3://$UPLOADS_BUCKET_NAME/" --region "$REGION"

### === Monitor Processing ===
echo "⏳ Monitoring scan processing (30s timeout)..."
TIMEOUT=30
INTERVAL=5
ELAPSED=0

while [ $ELAPSED -lt $TIMEOUT ]; do
    # Check clean file
    if aws s3 ls "s3://$CLEAN_BUCKET_NAME/clean-${TEST_ID}.txt" --region "$REGION" &>/dev/null; then
        echo "✅ Clean file processed successfully"
        CLEAN_PROCESSED=true
    fi
    
    # Check infected file
    if aws s3 ls "s3://$QUARANTINE_BUCKET_NAME/eicar-${TEST_ID}.txt" --region "$REGION" &>/dev/null; then
        echo "✅ EICAR file quarantined successfully"
        EICAR_PROCESSED=true
    fi
    
    # If both files processed, break
    if [ "${CLEAN_PROCESSED:-false}" = true ] && [ "${EICAR_PROCESSED:-false}" = true ]; then
        break
    fi
    
    sleep $INTERVAL
    ELAPSED=$((ELAPSED + INTERVAL))
    echo "⏳ Still waiting... ($ELAPSED/$TIMEOUT seconds)"
done

### === Final Status Check ===
echo -e "\n📊 Final Status Report:"
echo "🔍 Clean Bucket Contents:"
aws s3 ls "s3://$CLEAN_BUCKET_NAME/" --region "$REGION"

echo -e "\n🔍 Quarantine Bucket Contents:"
aws s3 ls "s3://$QUARANTINE_BUCKET_NAME/" --region "$REGION"

# Get the Lambda function name from CloudFormation
LAMBDA_FUNCTION=$(aws cloudformation describe-stack-resources \
    --region "$REGION" \
    --stack-name "$STACK_NAME" \
    --query "StackResources[?ResourceType=='AWS::Lambda::Function'].PhysicalResourceId" \
    --output text)

echo -e "\n📜 Recent CloudWatch Logs:"
aws logs get-log-events \
    --region "$REGION" \
    --limit 5 \
    --start-time $(($(date +%s) - 300))000 \
    --log-group-name "/aws/lambda/$LAMBDA_FUNCTION" \
    --query 'events[*].message' \
    --output text

# Cleanup test files
rm -f "clean-${TEST_ID}.txt" "eicar-${TEST_ID}.txt"

echo "✅ Done. Full logs available in CloudWatch."
