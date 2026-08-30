// Where the API is.
//
// Set `EXPO_PUBLIC_API_URL` and this reads it. On a simulator localhost works; on a
// physical phone localhost means the phone itself, so it wants the machine's LAN
// address. In a store build it wants the real host, over HTTPS.
//
// The line below has to stay a plain property access. `babel-preset-expo` inlines
// `EXPO_PUBLIC_*` with a visitor that matches `MemberExpression` and nothing else,
// so writing `process.env?.EXPO_PUBLIC_API_URL` — which parses as an
// `OptionalMemberExpression` — is never visited, never inlined, and silently falls
// back to the default. It did, and a build that looked configured was quietly
// pointing at localhost. `scripts/verify-env-inlining.mjs` runs the real Babel
// transform over this file and fails if the value stops surviving it.
//
// After the transform there is no `process` left in the bundle at all: a production
// build gets the string, and a development build gets a reference to Expo's own env
// module. Under vitest, where the transform does not run, this is Node's process
// and the variable is simply unset.
declare const process: { env: { EXPO_PUBLIC_API_URL?: string } };

// eslint-disable-next-line no-undef -- replaced at build time; see above.
let baseUrl = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8080";

export function getApiBaseUrl(): string { return baseUrl; }
export function setApiBaseUrl(url: string): void { baseUrl = url; }
