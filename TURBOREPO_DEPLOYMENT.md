# Turborepo Monorepo Deployment Guide - Vercel

This guide walks through deploying the Windborne Weather Balloon Tracker as a Turborepo monorepo on Vercel with PostgreSQL.

## Architecture

- **Monorepo**: Turborepo for build orchestration
- **Frontend**: React + Vite (deployed as separate Vercel project)
- **Backend**: Node.js + Express API (deployed as separate Vercel project)
- **Database**: Vercel Postgres (connected to backend)

## Why Turborepo + Separate Projects?

- **Faster builds**: Turborepo caches build outputs intelligently
- **Independent scaling**: Frontend and backend scale separately
- **Better control**: Each project has its own environment variables and settings
- **Cleaner URLs**: Frontend gets your main domain, backend gets api subdomain

## Prerequisites

1. [Vercel Account](https://vercel.com/signup)
2. [Vercel CLI](https://vercel.com/docs/cli): `npm i -g vercel`
3. Git repository (GitHub, GitLab, or Bitbucket)
4. Node.js 18+ installed

## Project Structure

```
windborne/
├── package.json          # Root workspace config
├── turbo.json           # Turborepo configuration
├── frontend/
│   ├── package.json
│   ├── vercel.json      # Frontend Vercel config
│   └── src/
└── backend/
    ├── package.json
    ├── vercel.json      # Backend Vercel config
    └── src/
```

## Step 1: Install Dependencies

From the project root:

```bash
npm install
```

This installs Turborepo and all workspace dependencies.

## Step 2: Test Local Build

```bash
# Build everything
npm run build

# Run dev servers (both frontend and backend)
npm run dev
```

Frontend: http://localhost:5173
Backend: http://localhost:3000

## Step 3: Push to Git

```bash
git add .
git commit -m "Configure Turborepo monorepo"
git push origin main
```

## Step 4: Deploy Backend to Vercel

### A. Create Vercel Postgres Database

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. **Storage** → **Create Database** → **Postgres**
3. Name it `windborne-db`
4. Note the region (choose closest to users)

### B. Deploy Backend

```bash
cd backend
vercel
```

Follow prompts:
- **Set up and deploy**: Yes
- **Which scope**: Select your account
- **Link to existing project**: No
- **Project name**: `windborne-backend` (or your choice)
- **Directory**: `./backend` (current directory)
- **Override settings**: No

After deployment:
- Note the production URL: `https://windborne-backend.vercel.app`

### C. Connect Database to Backend

1. Go to backend project in Vercel Dashboard
2. **Storage** → **Connect Store**
3. Select your Postgres database
4. Connect to all environments (Production, Preview, Development)

### D. Add Environment Variables

In backend project settings → **Environment Variables**:

```bash
DATABASE_TYPE=postgres
NODE_ENV=production
```

The `DATABASE_URL` (or `POSTGRES_URL`) is automatically provided by Vercel Postgres.

### E. Redeploy Backend

```bash
vercel --prod
```

### F. Test Backend

```bash
curl https://windborne-backend.vercel.app/api/health
```

Should return:
```json
{
  "status": "ok",
  "timestamp": "2025-01-03T..."
}
```

## Step 5: Deploy Frontend to Vercel

### A. Update API URL

Edit `frontend/vercel.json` and replace the backend URL:

```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://windborne-backend.vercel.app/api/:path*"
    }
  ]
}
```

Commit this change:
```bash
git add frontend/vercel.json
git commit -m "Update backend API URL"
git push
```

### B. Deploy Frontend

```bash
cd ../frontend
vercel
```

Follow prompts:
- **Set up and deploy**: Yes
- **Which scope**: Select your account
- **Link to existing project**: No
- **Project name**: `windborne-tracker` (or your choice)
- **Directory**: `./frontend`
- **Override settings**: No

After deployment:
- Note the production URL: `https://windborne-tracker.vercel.app`

### C. Deploy to Production

```bash
vercel --prod
```

### D. Test Frontend

Visit `https://windborne-tracker.vercel.app/` in your browser.

The map should load with balloon data from the backend API.

## Step 6: Configure Custom Domain (Optional)

### For Frontend:
1. Go to frontend project → **Settings** → **Domains**
2. Add your domain: `sondelink.com`
3. Configure DNS as instructed

### For Backend:
1. Go to backend project → **Settings** → **Domains**
2. Add subdomain: `api.sondelink.com`
3. Configure DNS as instructed

Update `frontend/vercel.json`:
```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://api.sondelink.com/api/:path*"
    }
  ]
}
```

## Turborepo Benefits

### Build Caching
Turborepo caches build outputs. If you rebuild without changes:
- **Without Turbo**: 2-3 minutes
- **With Turbo**: 5-10 seconds (100% cache hit)

### Parallel Execution
```bash
npm run build  # Builds frontend and backend in parallel
```

### Filtered Builds
```bash
npx turbo run build --filter=frontend  # Only build frontend
npx turbo run build --filter=backend   # Only build backend
```

## Continuous Deployment

### Automatic Deploys

Vercel will auto-deploy when you push to Git:

1. **Backend** auto-deploys when `backend/` files change
2. **Frontend** auto-deploys when `frontend/` files change

### Manual Deploys

```bash
# Deploy backend only
cd backend && vercel --prod

# Deploy frontend only
cd frontend && vercel --prod
```

## Environment Variables

### Backend (.env)
```bash
# Production (set in Vercel Dashboard)
DATABASE_TYPE=postgres
NODE_ENV=production
# DATABASE_URL is auto-provided by Vercel Postgres

# Local development
DATABASE_TYPE=sqlite
NODE_ENV=development
PORT=3000
```

### Frontend (.env)
```bash
# Local development only
VITE_API_URL=http://localhost:3000/api

# Production uses vercel.json rewrites, no env var needed
```

## Monitoring

### View Logs

```bash
# Backend logs
cd backend && vercel logs --follow

# Frontend logs
cd frontend && vercel logs --follow
```

### Database Monitoring

1. Go to Vercel Dashboard → **Storage** → Your database
2. View:
   - Query performance
   - Connection pool status
   - Storage usage

## Troubleshooting

### Build Fails: "Turbo not found"

**Solution**: Ensure root `package.json` is committed with turbo in devDependencies.

### Backend 502 Error

**Possible causes**:
1. Database not connected → Check **Storage** tab
2. Missing `DATABASE_URL` → Verify environment variables
3. Cold start timeout → Wait 10-15 seconds and retry

### Frontend Shows 404 for API Calls

**Solution**: Verify `frontend/vercel.json` has correct backend URL in rewrites.

### CORS Errors

Backend already has CORS enabled. If you still see errors:
- Check backend URL in frontend vercel.json
- Verify backend is deployed and responding

## Cost Estimation

### Free Tier (Hobby Plan)
- **Frontend**: Free (static hosting)
- **Backend**: Free (serverless functions, 100GB bandwidth)
- **Database**: Free tier (1GB storage)
- **Total**: $0/month for hobby projects

### Pro Plan ($20/month)
- **Frontend**: Included
- **Backend**: Included (1TB bandwidth)
- **Database**: Starts at $10/month (512MB) up to $400/month (10GB)
- **Total**: $30-420/month depending on database size

For this project (1,000 balloons, hourly updates):
- **Database usage**: ~50-100MB
- **Bandwidth**: ~5-10GB/month
- **Fits comfortably in**: Free tier or $30/month Pro plan

## Useful Commands

```bash
# Development
npm run dev              # Run both frontend and backend
npm run dev --filter=frontend  # Run only frontend

# Build
npm run build            # Build both
npm run build --filter=backend # Build only backend

# Deployment
cd frontend && vercel --prod    # Deploy frontend
cd backend && vercel --prod     # Deploy backend

# Clean
npm run clean            # Clean all build artifacts
rm -rf node_modules */node_modules  # Fresh install
npm install
```

## Best Practices

1. **Always test locally** before deploying: `npm run build`
2. **Use environment variables** for configuration (never hardcode URLs)
3. **Deploy backend first**, then frontend (frontend depends on backend URL)
4. **Monitor logs** after deployment to catch errors early
5. **Use preview deployments** for testing: `vercel` (without --prod)

## Next Steps

- [ ] Set up custom domain
- [ ] Configure monitoring/alerts
- [ ] Add GitHub Actions for CI/CD
- [ ] Set up staging environment (separate Vercel projects)
- [ ] Add Sentry or error tracking
- [ ] Configure caching strategies

## Resources

- [Turborepo Documentation](https://turbo.build/repo/docs)
- [Vercel Monorepo Guide](https://vercel.com/docs/monorepos/turborepo)
- [Vercel Postgres](https://vercel.com/docs/storage/vercel-postgres)
- [Vercel CLI Reference](https://vercel.com/docs/cli)

## Support

For issues:
1. Check Vercel deployment logs
2. Review Turborepo build output
3. Test locally with `npm run build`
4. Open an issue in the repository
