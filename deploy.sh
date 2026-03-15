#!/bin/bash

# 1. SET THESE VALUES
PROJECT_ID="xoxo"
REGION="us-central1"
SERVICE_NAME="glyph-server"

# 2. YOUR ENV VARS
SUPABASE_URL="..."
SUPABASE_KEY="..." # Keep your full key here
GEMINI_KEY="..." # Keep your full key here

echo "Step 1: Enabling Google APIs..."
gcloud services enable run.googleapis.com cloudbuild.googleapis.com

echo "Step 2: Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
  --source . \
  --region $REGION \
  --project $PROJECT_ID \
  --allow-unauthenticated \
  --set-env-vars="SUPABASE_URL=$SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_KEY,GEMINI_API_KEY=$GEMINI_KEY"