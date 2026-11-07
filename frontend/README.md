# CivicFix web app (frontend)

React + TypeScript + Vite, Tailwind CSS v4, shadcn/ui-style components, TanStack Query, React Hook Form + Zod.

## Run

```bash
cp .env.example .env        # VITE_API_URL, defaults to http://localhost:8000/api/v1
npm install
npm run dev                 # http://localhost:5173  (the backend's CORS allows exactly this origin)
```

The API must be running too: `docker compose up` in `../backend`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run build` | type-check (`tsc -b`) + production build |
| `npm test` | Vitest + React Testing Library + msw (real axios client, mocked network) |
| `npm run lint` | oxlint |
| `npm run e2e` | real Chrome (via `playwright-core`) against the **real** backend; see `e2e/flow.mjs` |

`npm run e2e` needs a running backend + dev server and an existing super-admin:
`E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... npm run e2e` (optional: `CHROME_PATH`, `E2E_SHOTS_DIR`).

## Layout

```
src/
  routes/      route tree per layout (public, citizen) + guards
  layouts/     PublicLayout, CitizenLayout
  pages/       one file per page, composed from features/ + components/
  features/    auth/ (forms, schemas), issues/ (hooks, form, cards, badges, tally)
  components/  pure, reusable UI: Navbar, EmptyState, ErrorState, LoadingSkeleton, FormField, ui/*
  services/    axios client (+ token refresh), accountsApi, issuesApi, queryClient
  context/     AuthContext
  hooks/       useGeolocation
  types/       hand-written mirrors of the DRF serializers
```

## Auth model

- The **access token lives in memory only** (AuthContext). The **refresh token** is kept in `sessionStorage`
  so a reload can restore the session; the trade-off is that injected script could read it (an httpOnly
  cookie would not allow that, but the backend currently returns the token in the JSON body).
- A 401 triggers one **single-flight** refresh (the backend rotates and blacklists refresh tokens, so two
  parallel refreshes would log the user out), then the request is retried once. If the refresh fails the
  user is signed out and sent to `/login`.
- Route guards (`ProtectedRoute`, role from the JWT claim) are **UX only**. The security boundary is the
  Django permission classes on every endpoint.
