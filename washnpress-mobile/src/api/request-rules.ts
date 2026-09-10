// When a request has waited long enough, when it is worth asking again, and what a
// failure that never reached the server is allowed to say to the person holding the
// phone.
//
// The client was a bare `fetch`. No timeout, so a request to a host that accepts the
// connection and then says nothing — a backend behind a load balancer that has lost
// its upstream, a captive portal in a society clubhouse — hung until the platform
// gave up, which on iOS is sixty seconds and on Android is longer. No retry, so a
// single dropped packet on a lift-lobby signal was a failed sign-in. And no wrapping,
// so the rejection `fetch` throws arrived at the screen as its own message: the red
// box that said "Network request failed", and the operator report of a login that
// failed with `requestTimedOut`. Both are the platform talking to itself.
//
// Kept out of the client because "how long is too long" and "is this worth trying
// again" are decisions, and a decision buried in a fetch call is a decision nobody
// can test.

// Long enough for a cold backend on a slow connection, short enough that somebody
// standing in a doorway knows it has failed. The platform's own default is a minute
// or more, which is indistinguishable from the app having hung.
export const REQUEST_TIMEOUT_MS = 15_000;

// The first attempt plus two more. A third retry buys almost nothing against a
// genuine outage and costs the person another ten seconds of watching a spinner.
export const MAX_ATTEMPTS = 3;

// The two ways a request can fail without the server ever having answered. They are
// codes rather than message matching: the previous check was a regular expression
// over the error text, which meant a support ticket whose body contained the word
// "network" could be mistaken for connectivity loss.
export const NETWORK_ERROR_CODE = "network_unreachable";
export const TIMEOUT_ERROR_CODE = "network_timeout";

// Whether this failure means "we never reached the server", as opposed to the server
// having answered with a refusal. Only the first kind is worth queueing offline or
// retrying.
//
// Takes the error structurally rather than as an ApiError, so this module stays free
// of the client that imports it.
export function isConnectivityFailure(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return code === NETWORK_ERROR_CODE || code === TIMEOUT_ERROR_CODE;
}

// What to say. Not what the platform said.
//
// Every one of these names something the person can do, because a message that only
// reports a fault leaves them tapping the same button. They are also the strings the
// error box shows verbatim, so they are sentences rather than labels.
export function connectivityMessage(code: string): string {
  return code === TIMEOUT_ERROR_CODE
    ? "Wash N Press is taking too long to answer. Check your connection and try again."
    : "Could not reach Wash N Press. Check your connection and try again.";
}

// Whether to send this one again.
//
// Only reads, and only when nothing came back. A POST that timed out may well have
// been carried out — repeating a pickup confirmation or a payment because the reply
// was lost is worse than reporting the failure — so a write is asked once and the
// answer is whatever it is. A server that answered, even with a 500, has been
// reached, and asking it the same thing twice more changes nothing.
export function shouldRetry(method: string, attempt: number, error: unknown): boolean {
  if (attempt >= MAX_ATTEMPTS) return false;
  if (!isConnectivityFailure(error)) return false;
  return method.toUpperCase() === "GET";
}

// A short backoff, doubling. Retrying instantly on a connection that has just
// dropped simply fails three times in the same tenth of a second and reports the
// same thing, having proved nothing.
export function retryDelayMs(attempt: number): number {
  return 300 * 2 ** (attempt - 1);
}
