#!/bin/bash

# Setup Script — downloads required model assets after cloning

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

cd "$(dirname "$0")"

MODEL_DIR="tools/assets"
MODEL_FILE="$MODEL_DIR/yolov9_trees.onnx"
MODEL_URL="https://chmura.put.poznan.pl/public.php/dav/files/A9zdp4mKAATEAGu/?accept=zip"
ZIP_FILE="$MODEL_DIR/yolov9_trees.zip"

mkdir -p "$MODEL_DIR"

if [ -f "$MODEL_FILE" ]; then
    echo -e "${GREEN}✅ Model already exists at $MODEL_FILE${NC}"
    exit 0
fi

echo -e "${YELLOW}Downloading YOLOv9 tree detection model...${NC}"

if ! command -v curl &>/dev/null && ! command -v wget &>/dev/null; then
    echo -e "${RED}Error: curl or wget is required to download the model.${NC}"
    exit 1
fi

if command -v curl &>/dev/null; then
    curl -L -o "$ZIP_FILE" "$MODEL_URL"
elif command -v wget &>/dev/null; then
    wget -O "$ZIP_FILE" "$MODEL_URL"
fi

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to download model.${NC}"
    rm -f "$ZIP_FILE"
    exit 1
fi

# Extract the zip
if command -v unzip &>/dev/null; then
    unzip -o "$ZIP_FILE" -d "$MODEL_DIR"
    rm -f "$ZIP_FILE"
else
    echo -e "${RED}Error: unzip is required to extract the model.${NC}"
    exit 1
fi

if [ -f "$MODEL_FILE" ]; then
    echo -e "${GREEN}✅ Model downloaded to $MODEL_FILE${NC}"
else
    echo -e "${YELLOW}⚠️  Extracted files:${NC}"
    ls -lh "$MODEL_DIR/"
    echo -e "${YELLOW}If the .onnx file has a different name, rename it to yolov9_trees.onnx${NC}"
fi
