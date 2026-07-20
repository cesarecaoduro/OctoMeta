# Better Auth + Convex integration record (SvelteKit)

*Status: implemented and extended by R1.6 on 2026-07-20.*

The dependency wiring and UI below landed. R1.6 then superseded the original
no-gating boundary: `/app` is server-gated, every product Convex function
authenticates and enforces `ownerId`, and file claims/serving are owner-scoped.
Playwright proves signed-out redirect and an isolated authenticated owner.
Email/password and magic link are enabled; Google remains conditional on both
credentials. Current setup instructions live in [../README.md](../README.md).

The later “no route gating / no ownership” wording is retained as historical
planning context only and is superseded by R1-0/R1-7 in
[v1-6-workbench-plan.md](v1-6-workbench-plan.md).

## Context

Auth was always planned (PRD M5 names Better Auth) but nothing exists yet: no auth files, no hooks, no login routes. This plan integrates the official Convex Better Auth component (https://labs.convex.dev/better-auth, SvelteKit guide: https://labs.convex.dev/better-auth/framework-guides/sveltekit) with **email + password, magic link via the existing Resend component, and Google OAuth**, plus a **minimal tokens-styled auth UI**. No route gating and **no schema surgery**: documents stay unowned (SCHEMA.md defers users/memberships/permissions), so this lands identity without touching product tables.

Repo facts the plan builds on (verified 2026-07-20):

- Convex functions already live at `src/convex/` (`convex.json`), exactly what the SvelteKit guide requires.
- `src/convex/convex.config.ts` already uses the component pattern (`app.use(resend)`); `src/convex/http.ts` already exports an `httpRouter`.
- `convex-svelte@0.14.0` is the **official** package and already includes the SSR helpers the guide needs (`withServerConvexToken` in `convex-svelte/sveltekit/server`, verified in node_modules). The guide's `@mmailaender/convex-svelte` fork is deprecated and merged back into the official package: **do not install it**.
- `@better-auth/infra@^0.3.6` in package.json is a stray, unused dashboard plugin (zero imports in `src/`): remove it.
- `src/lib/persistence/boundary.test.ts` enforces that `convex`/`convex-svelte` are imported only under `src/lib/persistence/` and `src/convex/`. The new `src/hooks.server.ts` therefore must NOT import `convex-svelte/sveltekit/server` directly; add a re-export in the persistence layer (see §4).
- Resend is wired in `src/convex/emails.ts` + `emailTemplates.ts`: reuse for the magic-link email.
- No `svelte.config.js`; SvelteKit is configured inline in `vite.config.ts`. No alias changes needed (relative imports are fine, matching existing code).

## 1. Dependencies

```bash
npm install @convex-dev/better-auth @mmailaender/convex-better-auth-svelte better-auth@~1.6.23
npm uninstall @better-auth/infra
```

Version constraints (verified on npm): `@convex-dev/better-auth@0.12.5` requires `better-auth >=1.6.11 <1.7.0`; `@mmailaender/convex-better-auth-svelte@0.8.2` peers are all satisfied by current repo versions (convex ^1.42, convex-svelte 0.14, svelte 5).

## 2. Environment

Convex deployment vars:

```bash
npx convex env set BETTER_AUTH_SECRET=$(openssl rand -base64 32)
npx convex env set SITE_URL http://localhost:5173
# Google OAuth, credentials from Google Cloud Console:
npx convex env set GOOGLE_CLIENT_ID <id>
npx convex env set GOOGLE_CLIENT_SECRET <secret>
```

`.env.local`: add `PUBLIC_SITE_URL=http://localhost:5173` (`PUBLIC_CONVEX_URL` / `PUBLIC_CONVEX_SITE_URL` already present).

Google redirect URI (for the Google Cloud OAuth client): `http://localhost:5173/api/auth/callback/google`. Code will conditionally enable Google only when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set, so the app works before credentials exist.

## 3. Convex backend (`src/convex/`)

- **`convex.config.ts`**: add alongside resend:

  ```ts
  import betterAuth from '@convex-dev/better-auth/convex.config';
  app.use(betterAuth);
  ```

- **`auth.config.ts`** (new):

  ```ts
  import { getAuthConfigProvider } from '@convex-dev/better-auth/auth-config';
  import type { AuthConfig } from 'convex/server';
  export default { providers: [getAuthConfigProvider()] } satisfies AuthConfig;
  ```

- **`auth.ts`** (new), per the guide:
  - `export const authComponent = createClient<DataModel>(components.betterAuth);`
  - `export const createAuth = (ctx: GenericCtx<DataModel>) => betterAuth({ ... })` using `betterAuth` from `better-auth/minimal`, `baseURL: process.env.SITE_URL`, `database: authComponent.adapter(ctx)`, with:
    - `emailAndPassword: { enabled: true, requireEmailVerification: false }`
    - `socialProviders: { google: { clientId, clientSecret } }`, included only when both env vars are set
    - `plugins: [convex({ authConfig }), magicLink({ sendMagicLink })]` (`magicLink` from `better-auth/plugins`); `sendMagicLink({ email, url })` sends through the existing `resend` client from `./emails` with a new branded template in `emailTemplates.ts` (follow the waitlist-email pattern)
  - `export const getCurrentUser = query({ args: {}, handler: (ctx) => authComponent.getAuthUser(ctx) })`: public read of the signed-in user (null when signed out; use `safeGetAuthUser` if that is the current name of the non-throwing variant).
- **`http.ts`**: add `authComponent.registerRoutes(http, createAuth);` to the existing router (keep the Resend webhook route).

## 4. SvelteKit wiring

- **`src/lib/auth-client.ts`** (new): `createAuthClient` from `better-auth/svelte` with `plugins: [convexClient(), magicLinkClient()]` (`convexClient` from `@convex-dev/better-auth/client/plugins`, `magicLinkClient` from `better-auth/client/plugins`).
- **`src/routes/api/auth/[...all]/+server.ts`** (new): `export const { GET, POST } = createSvelteKitHandler();` from `@mmailaender/convex-better-auth-svelte/sveltekit` (proxies auth traffic to the Convex deployment).
- **`src/lib/persistence/server.ts`** (new, inside the boundary-allowed dir): `export { withServerConvexToken } from 'convex-svelte/sveltekit/server';`. This keeps `hooks.server.ts` clean of direct convex-svelte imports so `boundary.test.ts` stays green.
- **`src/hooks.server.ts`** (new): `getToken(event.cookies)` from `@mmailaender/convex-better-auth-svelte/sveltekit`, store on `event.locals.token`, wrap `resolve` in `withServerConvexToken` imported from `$lib/persistence/server`.
- **`src/app.d.ts`**: declare `App.Locals { token: string | undefined }` (currently empty/commented).
- **`src/routes/+layout.svelte`**: after `setupPersistence(PUBLIC_CONVEX_URL)`, call `createSvelteAuthClient({ authClient })` from `@mmailaender/convex-better-auth-svelte/svelte` (order matters: it wires the token into the Convex client registered by setup).

The adapter package imports convex-svelte internally from node_modules; the boundary test only scans `src/`, so this passes. Only the direct `convex-svelte/sveltekit/server` import needed the persistence shim.

## 5. Minimal auth UI (tokens-styled, no gating)

- **`src/routes/signin/+page.svelte`** (new): one card on `--paper` using existing tokens (`tokens.css` is global via the root layout). Email + password sign-in/sign-up toggle (`authClient.signIn.email` / `authClient.signUp.email`), "email me a magic link" action (`authClient.signIn.magicLink`), and a "Continue with Google" button (`authClient.signIn.social({ provider: 'google' })`). Inline error text uses `--error`. Redirect to `/app` on success.
- **`src/lib/components/UserBadge.svelte`** (new): uses `useAuth()` from `@mmailaender/convex-better-auth-svelte/svelte` + `authClient`. When signed in, show the user's email and a sign-out action (`authClient.signOut()`); when signed out, link to `/signin`. Mount it on `src/routes/app/+page.svelte` (document list header). `/app` remains accessible signed-out.

## 6. Verification

1. `npx convex dev`: component installs, codegen runs, deployment accepts `auth.config.ts`/`http.ts` (watch for push errors).
2. `npm run check`: types clean (new `app.d.ts`, generated `components.betterAuth`).
3. `npm test`: existing suite, especially `boundary.test.ts`, stays green.
4. Manual flow with `npm run dev`: visit `/signin`, sign up with email+password, land on `/app`, UserBadge shows email; `getCurrentUser` returns the user (check via dashboard or badge); sign out works; request a magic link, email arrives via Resend (dev: check Resend test mode/dashboard) and the link signs in; Google button works once OAuth credentials are added (skippable until then).
5. `npm run test:e2e`: confirm existing Playwright specs still pass (auth gates nothing, so no spec changes expected).

## Out of scope (explicit)

- No route gating, no document ownership/`userId` fields, no ACLs: that is the M5 sharing track (SCHEMA.md §10).
- GitHub OAuth not requested.
- Email verification off initially (`requireEmailVerification: false`).
