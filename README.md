# Fit Fetcher

## Environment

The scraper uses Firecrawl from a server function and requires `FIRECRAWL_API_KEY`.

For local Vite/TanStack development, copy `.env.example` to `.env.local` and replace the placeholder value:

```sh
FIRECRAWL_API_KEY=fc-YOUR_FIRECRAWL_API_KEY
```

For Cloudflare deployment, create a Worker secret:

```sh
npx wrangler secret put FIRECRAWL_API_KEY
```
