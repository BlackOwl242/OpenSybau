import { buildRemoteRequestHeaders, remoteFetch, resolveRemoteUrl } from "./remote-host.js";

export function createStateLoader(fetchState = remoteFetch) {
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
    const raw = await response.text();
    let data = {};
    if (raw) {
      try { data = JSON.parse(raw); }
      catch {
        if (response.ok) throw new Error("Invalid JSON returned by /api/state");
      }
    }
    if (!response.ok) {
      const error = new Error(data?.error || raw.slice(0, 180) || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    snapshot = data;
    etag = response.headers.get("etag") || "";
    return { state: snapshot, changed: true };
  };
}
