#!/bin/bash

# Deploy Script for Plantation & Tree Analytics Dashboard
# Rebuilds images and restarts services with the latest code.
# Usage:
#   ./deploy.sh                    # Rebuild & deploy all services
#   ./deploy.sh --service backend  # Rebuild only backend
#   ./deploy.sh --push             # Git push before deploying

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

cd "$(dirname "$0")"

echo -e "${BLUE}====================================================${NC}"
echo -e "${BLUE}   🚀 Deploy Plantation Analytics Dashboard 🚀     ${NC}"
echo -e "${BLUE}====================================================${NC}"

# Parse args
SERVICES=""
PUSH=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --service) SERVICES="$SERVICES $2"; shift 2 ;;
        --push)    PUSH=true; shift ;;
        -h|--help)
            echo "Usage: ./deploy.sh [--service <name>]... [--push]"
            echo ""
            echo "Options:"
            echo "  --service <name>  Rebuild specific service (backend, frontend, celery-worker)"
            echo "  --push            Git add, commit, and push before deploying"
            echo ""
            echo "Examples:"
            echo "  ./deploy.sh                              # Rebuild everything"
            echo "  ./deploy.sh --service backend             # Rebuild backend only"
            echo "  ./deploy.sh --service backend --service frontend"
            echo "  ./deploy.sh --push                        # Push to git + rebuild all"
            exit 0
            ;;
        *) echo -e "${RED}Unknown arg: $1. Use --help${NC}"; exit 1 ;;
    esac
done

# Step 1: Optional git push
if [ "$PUSH" = true ]; then
    echo -e "${YELLOW}Pushing changes to git...${NC}"
    if git rev-parse --is-inside-work-tree &>/dev/null; then
        git add .
        git commit -m "deploy: $(date '+%Y-%m-%d %H:%M')" 2>/dev/null || true
        git push origin main
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ Pushed to origin/main${NC}"
        else
            echo -e "${RED}❌ Git push failed${NC}"
            exit 1
        fi
    else
        echo -e "${YELLOW}Not a git repo, skipping push.${NC}"
    fi
    echo ""
fi

# Step 2: Build and deploy
if [ -z "$SERVICES" ]; then
    echo -e "${YELLOW}Rebuilding and deploying all services...${NC}"
    docker compose up -d --build
else
    echo -e "${YELLOW}Rebuilding:${GREEN}$SERVICES${NC}"
    docker compose up -d --build $SERVICES
fi

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Deploy failed.${NC}"
    exit 1
fi

# Step 3: Wait for backend
echo -ne "${YELLOW}Waiting for backend"
for i in $(seq 1 30); do
    if curl -sf http://localhost:8000/api/health &>/dev/null; then
        echo -e " ${GREEN}✅${NC}"
        break
    fi
    echo -n "."
    sleep 2
    if [ $i -eq 30 ]; then
        echo -e " ${YELLOW}(still starting)${NC}"
    fi
done

# Status
echo ""
echo -e "${GREEN}Deployment complete:${NC}"
docker compose ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null

echo ""
echo -e "${BLUE}====================================================${NC}"
echo -e "  Frontend:  ${GREEN}http://localhost:5173${NC}"
echo -e "  API Docs:  ${GREEN}http://localhost:8000/api/docs${NC}"
echo -e "${BLUE}====================================================${NC}"
