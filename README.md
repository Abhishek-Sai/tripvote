# TripVote

A web app that helps small groups choose a trip destination by ranked-choice
vote, then plan the trip in a shared itinerary. MSCS 2101, Group 3.

| Part     | Stack                     | Folder    |
| -------- | ------------------------- | --------- |
| Frontend | React (Vite)              | `client/` |
| Backend  | Node.js, Express          | `server/` |
| Database | Supabase PostgreSQL       | accessed only by `server/` |

## Getting started

Requires Node.js 20 or newer.

```bash
npm install
cp server/.env.example server/.env
```

Fill in `server/.env` with your Supabase development project's values, then
run each app in its own terminal:

```bash
npm run dev:server
```

```bash
npm run dev:client
```

Open http://localhost:5173. The page shows whether it can reach the API.

Run the tests with `npm test`.

## Security rule

The browser never talks to the database directly. `SUPABASE_SERVICE_ROLE_KEY`
stays in `server/.env`, must never be committed, and must never be used in
`client/` (SRS SEC-07).
