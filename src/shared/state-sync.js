export function createStateLoader(fetchState = globalThis.fetch) {
  let etag = "";
  let snapshot;
  return async function loadState() {
    const response = await fetchState("/api/state", {
      cache: "no-store",
      headers: etag ? { "If-None-Match": etag } : {},
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
