# OctoMeta

*The living engineering document. Edit once, everything follows.*

OctoMeta is the living engineering document: your calculations, your report, and your 3D model are views of a single intelligent graph. Edit anywhere, and everything follows.

**Current state:** marketing landing page (SvelteKit + Svelte 5) with a Convex backend. The waitlist form writes to the `waitlist` table via `waitlist.join`, and confirmation emails are queued through the [Resend component](https://www.convex.dev/components/resend). The site deploys to Vercel (project `octometa`, live at [octometa.vercel.app](https://octometa.vercel.app)). See [ARCHITECTURE.md](ARCHITECTURE.md) for what exists and where, and [PRD.md](PRD.md) for the product plan.

## Prerequisites

- Node 20+ and [pnpm](https://pnpm.io)
- A [Convex](https://convex.dev) account (free) for the dev deployment

## Setup

```sh
pnpm install
npx convex dev --once   # provisions/links a Convex dev deployment, writes .env.local
```

`.env.local` (gitignored) holds `CONVEX_DEPLOYMENT` and `PUBLIC_CONVEX_URL`. If you're a new contributor, `npx convex dev --once` will walk you through creating or linking a deployment.

## Developing

```sh
pnpm dev          # dev server at http://localhost:5173
pnpm check        # svelte-check (types + a11y)
```

When backend functions exist, run `npx convex dev` alongside `pnpm dev` so function changes deploy on save.

## Building

```sh
pnpm build        # production build
pnpm preview      # serve the production build locally
```

## Deploying (Vercel)

The site deploys to the Vercel project `octometa` (linked via `.vercel/`, gitignored). `@sveltejs/adapter-auto` picks the Vercel adapter at build time.

```sh
vercel deploy --prod --archive=tgz
```

`PUBLIC_CONVEX_URL` and `PUBLIC_CONVEX_SITE_URL` are set as Vercel env vars (currently pointing at the dev Convex deployment; repoint them after running `npx convex deploy` to provision production).

## Email (Resend)

All email goes through the Convex Resend component: `src/convex/emails.ts` holds the shared client, `waitlist.join` queues the confirmation email, `http.ts` mounts the delivery webhook, and `crons.ts` cleans up old component data.

Until a sending domain is verified, `testMode` stays on (only `*@resend.dev` addresses can be enqueued) and signups save fine without email. To go live, set on the Convex deployment:

- `RESEND_API_KEY`: from the Resend dashboard
- `RESEND_WEBHOOK_SECRET`: create a webhook pointing at `https://<deployment>.convex.site/resend-webhook` with `email.*` events enabled

then set `testMode: false` in `src/convex/emails.ts` and update `FROM_ADDRESS` to the verified domain.

## Project documents

| File | What it is |
|---|---|
| [PRD.md](PRD.md) | Product requirements, milestones, task graph |
| [SCHEMA.md](SCHEMA.md) | Typed dependency-graph data model |
| [DESIGN.md](DESIGN.md) | Brand, logo, and design tokens |
| [ARCHITECTURE.md](ARCHITECTURE.md) | What's built, how it's laid out, decisions taken |
| `docs/references/` | Static HTML mockups the landing page was built from |
