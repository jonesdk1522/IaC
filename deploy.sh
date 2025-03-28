#!/bin/bash
set -euo pipefail

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "Installing Node.js and npm..."
    curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install.sh | bash
    brew install node
fi

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    brew install --cask docker
fi

# Install dependencies
echo "Installing dependencies..."
npm install

# Initialize TypeScript if not present
if [ ! -f "tsconfig.json" ]; then
    echo "Initializing TypeScript..."
    npx tsc --init
fi

# Initialize and deploy
npm run all
