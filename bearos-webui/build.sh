#!/bin/bash
set -euo pipefail

npm ci
npm run build

mkdir -p .ignore
rm -f .ignore/webui.zip
cd dist && zip -r ../.ignore/webui.zip .
