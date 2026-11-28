# TripVote frontend

## Design directions

| Direction | Main screen | Best fit |
| --- | --- | --- |
| Trip workspace (implemented) | Destination suggestions and the private ballot side by side, stacked on phones | Groups that want to compare options and update a ballot in one view |
| Guided flow | Separate Suggestions, Ballot, and Results screens | First-time voters who benefit from one action per screen |
| Destination gallery | Image-led choices with a ballot drawer | Groups comparing a curated list of destinations with supplied images |

The trip workspace keeps voting progress visible and places organizer controls below the member workflow. Rank controls support pointer drag-and-drop and labeled up/down buttons.

## Requirements and API coverage

| UI | SRS | Existing Express support |
| --- | --- | --- |
| Create, invite, join, session restore | FR-01–04, FR-31 | Create trip, preview trip, join, verify member session |
| Suggest and rank destinations | FR-05–10, FR-26 | List and add destinations, read and replace the signed-in member's ballot, aggregate progress |
| Organizer poll controls | FR-11–12, FR-19 | Manual close and destination removal |
| Results and itinerary | FR-13–18, FR-22–25, FR-27–30 | Follow-on work. The API stores an optional deadline, while automatic closing, tally rounds, tie resolution, and itinerary APIs are pending. |

## Run locally

From the repository root, run `npm ci`. Configure `server/.env` from `server/.env.example` and start `npm run dev:server` and `npm run dev:client` in separate terminals. Vite forwards local API calls to Express on port 3001. The database connection stays on the server.

## Hosting on Vercel

The frontend and the API are deployed together as one Vercel project, as SRS 3.2.3 describes. See [deployment.md](deployment.md) for the steps. The frontend calls the API on the same origin, so `VITE_API_BASE_URL` stays unset and no CORS setup is needed.
