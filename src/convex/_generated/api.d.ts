/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as assetClaims from "../assetClaims.js";
import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as documents from "../documents.js";
import type * as documentVersions from "../documentVersions.js";
import type * as emailTemplates from "../emailTemplates.js";
import type * as emails from "../emails.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as maintenance from "../maintenance.js";
import type * as waitlist from "../waitlist.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  assetClaims: typeof assetClaims;
  auth: typeof auth;
  crons: typeof crons;
  documents: typeof documents;
  documentVersions: typeof documentVersions;
  emailTemplates: typeof emailTemplates;
  emails: typeof emails;
  files: typeof files;
  http: typeof http;
  maintenance: typeof maintenance;
  waitlist: typeof waitlist;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
};
