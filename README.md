# ClipHive

ClipHive turns long-form video (streams, VODs, uploads) into short, shareable
clips: AI detects the best moments, transcribes and captions them, scores
their viral potential, and renders vertical-ready exports for TikTok, Reels,
and Shorts.

## Monorepo layout

This is a pnpm + Turbo monorepo.

| Path | What it is |
|---|---|
| `apps/web` | Next.js 14 frontend (marketing site, dashboard, clip editor, auth) |
| `apps/server` | Fastify + tRPC API: clip jobs, uploads, billing, queue workers |
| `apps/ml` | Python (FastAPI) ML microservice: scene detection, transcription, virality scoring, captions, thumbnails |
| `packages/db` | Drizzle ORM schema, migrations, seed scripts (`@cliphive/db`) |
| `packages/shared` | Shared TypeScript types, constants, and utils (`@cliphive/shared`) |
| `packages/tsconfig.base.json` | Shared strict TypeScript base config for the packages |
| `eslint.config.mjs` | Root ESLint flat config covering `apps/*` and `packages/*` |
| `docker-compose.yml` | Local Postgres, Redis, and MinIO (S3-compatible storage) |
| `.github/workflows/` | CI (lint, type-check, build, tests) + deploy workflows |

## Prerequisites

- Node.js 20 (see `.nvmrc`; `nvm use` picks it up)
- pnpm 9 (`corepack enable` or `npm i -g pnpm`)
- Docker + Docker Compose (for local Postgres, Redis, MinIO)
- Python 3.12 (only if you hack on `apps/ml`)

## Getting started

```bash
# 1. Install dependencies (frozen lockfile)
pnpm install --frozen-lockfile

# 2. Configure environment
cp .env.example .env.local   # app env (Next.js / server)
cp .env.example .env         # docker compose env (local Postgres/MinIO creds)

# 3. Start services: Postgres (pgvector), Redis, MinIO
docker compose up -d

# 4. Run database migrations + seed
pnpm --filter @cliphive/db db:migrate
pnpm --filter @cliphive/db db:seed

# 5. Start everything
pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:3001
- ML service: http://localhost:8000 (run `uvicorn app.main:app --reload` in `apps/ml`)
- MinIO console: http://localhost:9001

### Services required

| Service | Local | Used for |
|---|---|---|
| Postgres 16 + pgvector | `docker compose` → `localhost:5432` | App data, embeddings |
| Redis 7 | `docker compose` → `localhost:6379` | Job queues (BullMQ), caching |
| S3-compatible storage | `docker compose` → MinIO `localhost:9000` | Media uploads, rendered clips |

In production, point `S3_*` at AWS S3 or Cloudflare R2 instead of MinIO.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Run all workspaces in dev mode |
| `pnpm build` | Turbo build of all workspaces |
| `pnpm lint` | Per-workspace lint via Turbo (`next lint` for web) |
| `pnpm lint:root` | Root ESLint flat config across `apps/*` and `packages/*` |
| `pnpm type-check` | `tsc --noEmit` in every TS workspace |
| `pnpm test` | Vitest suites (web, server) |
| `pnpm db:migrate` / `pnpm db:generate` | Drizzle migrations via `@cliphive/db` |

CI (`.github/workflows/ci.yml`) runs `pnpm install --frozen-lockfile`,
`eslint .`, `pnpm run lint`, `pnpm run type-check`, `pnpm run build`, then
migrations + tests against Postgres/Redis services, plus Ruff/mypy/pytest
for the Python ML service.

## Security notes

- Debug API routes that leaked environment/session info
  (`/api/test-env`, `/api/debug-auth`) have been removed. Do not re-add
  env-dumping endpoints.
- Copy `.env.example` to `.env.local`/`.env` and fill in real secrets;
  never commit `.env*` files (they are gitignored).
