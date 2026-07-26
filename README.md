# English Classes

React application for a private English teacher. The project uses Vite as the development server and production build tool.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Local development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
npm run preview
```

## Environment variables

Copy `.env.example` to `.env.local` and fill in the Supabase values when the backend is connected:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Do not commit `.env.local`.

## Deployment

The project is ready for Vercel. The included `vercel.json` sends direct requests such as `/student-area` back to `index.html`, allowing React Router to handle them.
