# Deploying TripVote to Vercel

TripVote runs as **one Vercel project**: the React app is served as static files
and the Express API runs as a serverless function (SRS 2.4, 3.2.3). Both use the
same address, so the browser calls `/api/...` with no CORS setup, over HTTPS
(SEC-06).

| Path | Served by |
| --- | --- |
| `/`, `/trip/...` | `client/dist` (the Vite build); `/trip/*` falls back to `index.html` |
| `/api/...` | `api/index.js`, which wraps the Express app from `server/src/app.js` |

`vercel.json` holds this setup. It also bundles `server/certs/supabase-ca.crt`
with the function, so the API verifies the database certificate in production.

## One-time setup

1. Sign in at vercel.com with GitHub and choose **Add New → Project**.
2. Import `Abhishek-Sai/tripvote`. Keep **Root Directory** as the repository root.
   Vercel reads the build settings from `vercel.json`; leave the overrides off.
3. Under **Environment Variables**, add:

   | Name | Value | Environments |
   | --- | --- | --- |
   | `DATABASE_URL` | Supabase transaction pooler string (port 6543), same format as `server/.env` | Production, Preview |
   | `DATABASE_POOL_MAX` | `2` | Production, Preview |

   `NODE_ENV=production` is set by Vercel, so the API refuses to start without
   certificate verification. Do not add `VITE_API_BASE_URL` or any Supabase key
   with a `VITE_` prefix: those are copied into the browser bundle (SEC-07).
4. Click **Deploy**.

Every push to a branch then gets a preview URL, and merging into `main`
updates the production URL.

## Check a deployment

1. `https://<your-app>.vercel.app/api/health` returns
   `{"status":"ok","databaseConfigured":true}`.
2. Create a trip, open the organizer link, and add two destinations.
3. Open the member invite in a private window, join, and vote.
4. Close the poll and check that the results show in both windows.
5. Reload an invite link directly (not from the home page): it should open the
   trip, not a 404.

If the API answers 500, open the project's **Logs** in Vercel. `password
authentication failed` means `DATABASE_URL` is wrong; `No database CA
certificate` means the certificate was not bundled.

## Notes

- Deadline closing (FR-28) needs no scheduled job: the API closes a poll whose
  deadline has passed on the next request for that trip.
- Previews and production use the same database unless you give Preview a
  different `DATABASE_URL`. Use the development Supabase project for both
  until there is a separate production project.
- Run the database migrations against the project's database before deploying
  code that needs them: `npx supabase db push --linked`.
