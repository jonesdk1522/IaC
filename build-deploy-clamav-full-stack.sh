#!/bin/bash
set -euo pipefail

echo "📦 Full ClamAV Lambda Layer Build, Deploy & Test (Clean + EICAR + Logging)"

### === Check system requirements ===
echo "🔍 Checking system requirements..."

# Install Docker if not present (Amazon Linux 2023 specific)
if ! command -v docker &> /dev/null; then
    echo "📦 Installing Docker..."
    sudo dnf update -y
    sudo dnf install docker -y
    sudo systemctl start docker
    sudo systemctl enable docker
    sudo usermod -aG docker ec2-user
    echo "⚠️ Please reconnect to your session for docker group changes to take effect"
    exit 1
fi

# Check if Docker daemon is running
if ! docker info >/dev/null 2>&1; then
    echo "🔄 Starting Docker daemon..."
    sudo systemctl start docker
    sleep 5  # Wait for Docker to start
fi

# Install AWS CLI if not present
if ! command -v aws &> /dev/null; then
    echo "📦 Installing AWS CLI..."
    sudo dnf install aws-cli -y
fi

### === Load config ===
ENV_FILE=".env"
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ .env file not found!"
  exit 1
fi
source "$ENV_FILE"

### === Check and download ClamAV signature files ===
echo "🔍 Checking ClamAV signature files..."
FILES_MISSING=false

# Check for either .cvd or .cld files
for base in main daily bytecode; do
  if [ ! -f "${base}.cvd" ] && [ ! -f "${base}.cld" ]; then
    FILES_MISSING=true
    break
  fi
done

if [ "$FILES_MISSING" = true ]; then
  echo "📥 Downloading ClamAV signature files..."
  
  # Create temporary directory with proper permissions
  TEMP_DIR=$(mktemp -d)
  chmod 777 "$TEMP_DIR"
  
  # Create temporary container to download files
  if ! docker run --rm \
    -v "$TEMP_DIR":/var/lib/clamav:Z \
    clamav/clamav:latest \
    freshclam --no-warnings --datadir=/var/lib/clamav; then
    echo "❌ Failed to download signature files"
    rm -rf "$TEMP_DIR"
    exit 1
  fi
  
  # Copy files to current directory
  echo "📁 Copying signature files to working directory..."
  cp "$TEMP_DIR"/*.{cvd,cld} . 2>/dev/null || true
  rm -rf "$TEMP_DIR"
  
  # Verify downloads were successful - checking both .cvd and .cld
  for base in main daily bytecode; do
    if [ ! -f "${base}.cvd" ] && [ ! -f "${base}.cld" ]; then
      echo "❌ Failed to download ${base} signature file"
      exit 1
    fi
    if [ -f "${base}.cvd" ]; then
      echo "✅ Verified ${base}.cvd"
    else
      echo "✅ Verified ${base}.cld"
    fi
  done
else
  echo "✅ All ClamAV signature files present"
fi

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
