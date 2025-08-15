# Next.js Frontend Deployment Guide - Vercel

## Overview
This guide explains how to deploy your Next.js frontend to Vercel and configure it to connect to your deployed ADK agent backend. The frontend automatically detects the deployment environment and configures endpoints accordingly.

## Prerequisites

### 1. Vercel Account Setup
1. Go to [vercel.com](https://vercel.com) and sign up/sign in
2. Connect your GitHub/GitLab/Bitbucket account


### 2. Backend Deployment
Your Next.js frontend needs a backend to connect to:
- **Agent Engine** - Follow the [ADK Deployment Guide](./ADK_DEPLOYMENT_GUIDE.md)


## Environment Variables by Deployment Type

The frontend automatically detects which backend type to use based on available environment variables. Here's what you need for each deployment scenario:

### 🚀 Agent Engine Backend (Recommended)

**Required Variables:**
```bash
# Google Cloud Configuration
GOOGLE_CLOUD_PROJECT=your-project-id
REASONING_ENGINE_ID=your-reasoning-engine-id
GOOGLE_SERVICE_ACCOUNT_KEY_BASE64=your-base64-encoded-service-account-key
ADK_APP_NAME=your-adk-app-name
AGENT_ENGINE_ENDPOINT=your-agent-engine-endpoint
GOOGLE_CLOUD_LOCATION=us-central1
```

**How to get these values:**
1. **GOOGLE_CLOUD_PROJECT**: Your Google Cloud project ID
2. **REASONING_ENGINE_ID**: From your ADK deployment output (e.g., `projects/123/locations/us-central1/reasoningEngines/abc123` → use `abc123`)
3. **GOOGLE_CLOUD_LOCATION**: Region where you deployed your agent (default: `us-central1`)
4. **GOOGLE_SERVICE_ACCOUNT_KEY_BASE64**: Base64-encoded service account key (see setup instructions below)

## Service Account Setup for Agent Engine

If you're using Agent Engine backend, you need to create a Google Cloud service account and configure authentication. This is required for the frontend to authenticate with Google Cloud's Vertex AI API.

### Step 1: Create Service Account

1. **Go to Google Cloud Console:**
   - Navigate to [Google Cloud Console](https://console.cloud.google.com)
   - Select your project (the same one where you deployed your ADK agent)

2. **Navigate to Service Accounts:**
   - Go to **IAM & Admin** → **Service Accounts**
   - Click **"Create Service Account"**

3. **Configure Service Account:**
   - **Service account name**: `agent-engine-frontend` (or any descriptive name)
   - **Service account ID**: Will be auto-generated
   - **Description**: `Service account for frontend to access Agent Engine`
   - Click **"Create and Continue"**

4. **Add Required Roles:**
   Add these roles to your service account:
   - **Vertex AI User** (`roles/aiplatform.user`) - Required for Agent Engine API access
   - **Service Account Token Creator** (`roles/iam.serviceAccountTokenCreator`) - Required for token generation
   
   Click **"Continue"** then **"Done"**

### Step 2: Generate Service Account Key

1. **Access Service Account:**
   - In the Service Accounts list, click on the service account you just created
   - Go to the **"Keys"** tab

2. **Create New Key:**
   - Click **"Add Key"** → **"Create new key"**
   - Select **"JSON"** as the key type
   - Click **"Create"**

3. **Download Key:**
   - The JSON key file will be automatically downloaded to your computer
   - **Important**: Store this file securely and never commit it to version control

### Step 3: Convert JSON Key to Base64

You need to convert the JSON key to base64 for safe storage in environment variables.

**Option A: Using Terminal/Command Line (Recommended)**

```bash
# On macOS/Linux
cat path/to/your-service-account-key.json | base64

# On Windows (PowerShell)
[Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((Get-Content path/to/your-service-account-key.json -Raw)))
```

**Option B: Using Node.js**

```javascript
const fs = require('fs');
const keyFile = fs.readFileSync('path/to/your-service-account-key.json', 'utf8');
const base64Key = Buffer.from(keyFile).toString('base64');
console.log(base64Key);
```

**Option C: Using Online Tool**

1. Go to [base64encode.org](https://www.base64encode.org/)
2. Copy the entire contents of your JSON key file
3. Paste it into the encoder
4. Copy the base64 output


**For Vercel Production:**
1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Add a new environment variable:
   - **Name**: `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64`
   - **Value**: The base64 string you generated
   - **Environments**: Select Production, Preview, and Development


## Deploy via Vercel Dashboard (Recommended)

1. **Import Your Repository:**
   - Go to [Vercel Dashboard](https://vercel.com/dashboard)
   - Click "New Project"
   - Import your Git repository
   - Select the `nextjs` folder as the root directory

2. **Configure Build Settings:**
   - **Framework Preset**: Next.js
   - **Root Directory**: `nextjs`
   - **Build Command**: `npm run build`
   - **Output Directory**: Leave empty (uses default)

3. **Set Environment Variables:**
   - In project settings, go to "Environment Variables"
   - Add your variables based on your backend type (see sections above)
   - Set for "Production", "Preview", and "Development" as needed

4. **Deploy:**
   - Click "Deploy"
   - Vercel will build and deploy your app

