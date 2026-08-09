// The API base URL. On a simulator, localhost works. On a physical device, set this
// to your computer's LAN IP (for example http://192.168.1.20:8080) via the
// EXPO_PUBLIC_API_URL environment variable, or edit app.json extra.apiBaseUrl.
declare const process: { env: Record<string, string | undefined> };

let baseUrl = (typeof process !== "undefined" && process.env?.EXPO_PUBLIC_API_URL) || "http://localhost:8080";

export function getApiBaseUrl(): string { return baseUrl; }
export function setApiBaseUrl(url: string): void { baseUrl = url; }
