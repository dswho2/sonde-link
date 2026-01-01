# Deployment Guide - Vercel + PostgreSQL

This guide walks through deploying the Windborne Weather Balloon Tracker to Vercel with PostgreSQL database support.

## Architecture Overview

- **Frontend**: React + TypeScript + Vite (Static Build)
- **Backend**: Node.js + Express API
- **Database**: PostgreSQL (Vercel Postgres) or SQLite (local development)
- **Hosting**: Vercel (serverless functions + static hosting)

## Prerequisites

1. [Vercel Account](https://vercel.com/signup)
2. [Vercel CLI](https://vercel.com/docs/cli) installed: `npm i -g vercel`
3. Git repository (GitHub, GitLab, or Bitbucket)

## Step 1: Set Up Vercel Postgres

### Option A: Via Vercel Dashboard

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Navigate to **Storage** → **Create Database**
3. Select **Postgres**
4. Choose your database region (select closest to your users)
5. Name your database (e.g., `windborne-db`)
6. Click **Create**

### Option B: Via Vercel CLI

```bash
vercel postgres create windborne-db
```

The database will automatically provide these environment variables:
- `POSTGRES_URL` - Full connection string
- `POSTGRES_PRISMA_URL` - Connection string for Prisma (not used in this project)
- `POSTGRES_URL_NON_POOLING` - Direct connection without pooling

## Step 2: Link Your Project

### If deploying from Git:

1. Push your code to GitHub/GitLab/Bitbucket
2. Import the repository in Vercel Dashboard
3. Select the repository
4. Vercel will auto-detect the monorepo structure

### If deploying via CLI:

```bash
# From project root
vercel

# Follow the prompts to link or create a project
```

## Step 3: Configure Environment Variables

In your Vercel project settings, add these environment variables:

### Required Variables

```bash
# Database Configuration
DATABASE_TYPE=postgres
# DATABASE_URL is automatically provided by Vercel Postgres

# Server Configuration
NODE_ENV=production

# API Endpoints (optional, defaults are set)
WINDBORNE_API_BASE=https://a.windbornesystems.com/treasure
OPEN_METEO_API_BASE=https://archive-api.open-meteo.com/v1/archive
```

### Setting via Dashboard:

1. Go to Project → **Settings** → **Environment Variables**
2. Add each variable
3. Select **Production**, **Preview**, and **Development** scopes as needed

### Setting via CLI:

```bash
vercel env add DATABASE_TYPE
# Enter: postgres

vercel env add NODE_ENV
# Enter: production
```

## Step 4: Update Build Settings

Vercel should auto-detect settings, but verify:

### Frontend Build Settings:
- **Framework Preset**: Vite
- **Build Command**: `cd frontend && npm install && npm run build`
- **Output Directory**: `frontend/dist`
- **Install Command**: `npm install`

### Backend Build Settings:
- **Build Command**: `cd backend && npm install && npm run build`
- **Output Directory**: `backend/dist`

## Step 5: Connect Database to Project

1. In Vercel Dashboard, go to your project
2. Navigate to **Storage** tab
3. Click **Connect Store**
4. Select your Postgres database
5. Choose **Production**, **Preview**, and **Development** environments

This automatically injects the `POSTGRES_URL` environment variable.

## Step 6: Deploy

### Via Git (Automatic):

Push to your main/master branch:
```bash
git add .
git commit -m "Configure for Vercel deployment"
git push origin main
```

Vercel will automatically build and deploy.

### Via CLI (Manual):

```bash
# Production deployment
vercel --prod

# Preview deployment
vercel
```

## Step 7: Verify Deployment

After deployment, test your endpoints:

### Backend API:
```bash
curl https://your-project.vercel.app/api/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2025-01-03T10:00:00.000Z"
}
```

### Frontend:
Visit `https://your-project.vercel.app/` in your browser

### Database Connection:
```bash
curl https://your-project.vercel.app/api/balloons
```

Should return balloon data (may take 1-2 seconds on cold start).

## Local Development

For local development, continue using SQLite:

```bash
# backend/.env
DATABASE_TYPE=sqlite
NODE_ENV=development
PORT=3000
```

Run locally:
```bash
# Terminal 1 - Backend
cd backend
npm run dev

# Terminal 2 - Frontend
cd frontend
npm run dev
```

## Database Migrations

The application automatically creates tables on startup. For production, you may want to add a migration system.

### Manual Table Creation (if needed):

Connect to your Vercel Postgres database:

```bash
# Get connection string from Vercel dashboard
vercel env pull

# Connect using psql or any Postgres client
psql "your_postgres_url"
```

Tables will be auto-created on first API request, but you can manually run:

```sql
CREATE TABLE IF NOT EXISTS wind_cache ( ... );
CREATE TABLE IF NOT EXISTS balloon_snapshots ( ... );
CREATE TABLE IF NOT EXISTS tracked_balloons ( ... );
```

See `backend/src/services/database.postgres.ts` for full schema.

## Monitoring & Debugging

### View Logs:

```bash
vercel logs
# or
vercel logs --follow
```

### View Database:

Use Vercel's built-in Postgres explorer or connect with any SQL client using the connection string.

## Performance Considerations

1. **Cold Starts**: First request after inactivity may take 2-3 seconds (Vercel serverless limitation)
2. **Connection Pooling**: The app uses `pg.Pool` for efficient connection management
3. **Database Indexes**: Pre-configured indexes on frequently queried columns
4. **Caching**: Wind data and balloon positions are cached to reduce database queries

## Cost Estimation

- **Vercel Hobby Plan** (Free):
  - 100GB bandwidth/month
  - Unlimited serverless function invocations
  - 1GB storage for Postgres (Free tier)

- **Vercel Pro Plan** ($20/month):
  - 1TB bandwidth/month
  - Higher serverless limits
  - 512MB-10GB Postgres storage ($10-$400/month add-on)

For this project's use case (1,000+ balloons, hourly updates):
- **Storage**: ~50-100MB database size
- **Bandwidth**: ~1-5GB/month (depends on usage)
- **Functions**: Well within free tier limits

## Troubleshooting

### "Cannot find module 'pg'"
- Ensure `pg` is in `dependencies` (not `devDependencies`)
- Run `npm install` in backend directory

### "DATABASE_URL not defined"
- Verify Vercel Postgres is connected to your project
- Check Environment Variables in Vercel Dashboard
- Redeploy after connecting database

### "Table does not exist"
- Tables are created automatically on first request
- Check logs to verify initialization completed
- Manually run table creation SQL if needed

### API returns 404
- Verify `vercel.json` routes are correct
- Check backend is built and deployed
- Review deployment logs for build errors

## Additional Resources

- [Vercel Documentation](https://vercel.com/docs)
- [Vercel Postgres Guide](https://vercel.com/docs/storage/vercel-postgres)
- [Node.js on Vercel](https://vercel.com/docs/frameworks/nodejs)
- [Vite Deployment Guide](https://vitejs.dev/guide/static-deploy.html#vercel)

## Support

For issues specific to this project, check the main README.md or open an issue in the repository.
