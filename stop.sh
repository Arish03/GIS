#!/bin/bash

# Stop Script for Plantation & Tree Analytics Dashboard

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}====================================================${NC}"
echo -e "${BLUE}   🛑 Stopping Plantation Analytics Dashboard      ${NC}"
echo -e "${BLUE}====================================================${NC}"

cd "$(dirname "$0")"

# Show current status
echo -e "${YELLOW}Current running containers:${NC}"
docker compose ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null

echo ""
echo -e "${YELLOW}Stopping all services...${NC}"
docker compose down

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ All services stopped successfully.${NC}"
else
    echo -e "${RED}❌ Failed to stop services.${NC}"
    exit 1
fi

echo ""
echo -e "${YELLOW}Note: Data volumes (database, uploads, tiles) are preserved.${NC}"
echo -e "${YELLOW}To remove volumes too: ${NC}docker compose down -v"
echo -e "${BLUE}====================================================${NC}"
