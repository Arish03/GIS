#!/bin/bash

# Start Script for Plantation & Tree Analytics Dashboard
# Starts all services without rebuilding images.

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

cd "$(dirname "$0")"

echo -e "${BLUE}====================================================${NC}"
echo -e "${BLUE}   🌲 Plantation & Tree Analytics Dashboard 🌲     ${NC}"
echo -e "${BLUE}====================================================${NC}"

# Check prerequisites
for cmd in docker curl; do
    if ! command -v $cmd &>/dev/null; then
        echo -e "${RED}Error: $cmd is not installed.${NC}"
        exit 1
    fi
done

if ! docker compose version &>/dev/null; then
    echo -e "${RED}Error: docker compose is not available.${NC}"
    exit 1
fi

# Download model if missing
if [ ! -f "tools/assets/yolov9_trees.onnx" ]; then
    echo -e "${YELLOW}Model not found. Running setup...${NC}"
    bash setup.sh
fi

# Start services (no rebuild)
echo -e "${YELLOW}Starting all services...${NC}"
docker compose up -d

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to start services.${NC}"
    exit 1
fi

# Wait for backend health
echo -ne "${YELLOW}Waiting for backend"
for i in $(seq 1 30); do
    if curl -sf http://localhost:8080/api/health &>/dev/null; then
        echo -e " ${GREEN}✅${NC}"
        break
    fi
    echo -n "."
    sleep 2
    if [ $i -eq 30 ]; then
        echo -e " ${YELLOW}(still starting, give it a moment)${NC}"
    fi
done

# Status
echo ""
echo -e "${GREEN}Services running:${NC}"
docker compose ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null

echo ""
echo -e "${BLUE}====================================================${NC}"
echo -e "  Frontend:  ${GREEN}http://localhost:5173${NC}"
echo -e "  API Docs:  ${GREEN}http://localhost:8000/api/docs${NC}"
echo -e "  Logs:      ${YELLOW}docker compose logs -f${NC}"
echo -e "  Stop:      ${YELLOW}./stop.sh${NC}"
echo -e "${BLUE}====================================================${NC}"

# Open browser
if command -v xdg-open &>/dev/null; then
    xdg-open http://localhost:5173 &>/dev/null
elif command -v open &>/dev/null; then
    open http://localhost:5173 &>/dev/null
fi
