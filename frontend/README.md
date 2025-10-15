# CEI Frontend

Production-ready React + TypeScript frontend for Carbon Efficiency Intelligence (CEI).

## Environment Variables

Set these in Vercel or `.env`:

```
VITE_API_URL=https://cei-mvp.onrender.com/api/v1
```

For preview deployments, set `VITE_API_URL` to your preview backend URL.

## Scripts

- `npm run dev` — start local dev server
- `npm run build` — build for production
- `npm run preview` — preview production build

## Features

- Routing, authentication, charts, forms, pagination, error handling
- API integration with `/api/v1`
- Tailwind CSS styling
- React Query for caching and server state

## File Structure

See `src/` for modular pages, components, hooks, and types.