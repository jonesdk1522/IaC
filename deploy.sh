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

# Initialize and deploy
npm run all
