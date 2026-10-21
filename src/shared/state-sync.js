import { buildRemoteRequestHeaders, resolveRemoteUrl } from "./remote-host.js";

export function createStateLoader(fetchState = globalThis.fetch) {
  let etag = "";
  let snapshot;
  let lastTargetUrl = "";
  return async function loadState() {
    const targetUrl = resolveRemoteUrl("/api/state");
    if (targetUrl !== lastTargetUrl) {
      etag = "";
      snapshot = undefined;
      lastTargetUrl = targetUrl;
    }
    const response = await fetchState(targetUrl, {
      cache: "no-store",
      headers: buildRemoteRequestHeaders(etag ? { "If-None-Match": etag } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 304 && snapshot) return { state: snapshot, changed: false };
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    snapshot = data;
    etag = response.headers.get("etag") || "";
    return { state: snapshot, changed: true };
  };
}
