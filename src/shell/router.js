import { navigation } from "./navigation.js";

const pages = new Set(navigation.map(({ id }) => id));
const selectedPages = new Set(["chat", "flows", "workspaces"]);

export function readBrowserRoute(location = window.location) {
  const match = /^#\/?([^?]*)?(?:\?(.*))?$/.exec(location.hash || "");
  const candidate = match?.[1] || "chat";
  const page = pages.has(candidate) ? candidate : "chat";
  const params = new URLSearchParams(match?.[2] || "");
  const selected = selectedPages.has(page) ? params.get("id") || null : null;

  return {
    page,
    selected,
    workspaceDir: page === "workspaces" && selected ? params.get("dir") || "" : "",
    vaultDir: page === "knowledge" ? params.get("dir") || "" : "",
  };
}

export function browserRouteHash(view) {
  const page = pages.has(view.page) ? view.page : "chat";
  const params = new URLSearchParams();
  if (selectedPages.has(page) && view.selected) params.set("id", view.selected);
  if (page === "workspaces" && view.selected && view.workspaceDir) params.set("dir", view.workspaceDir);
  if (page === "knowledge" && view.vaultDir) params.set("dir", view.vaultDir);
  const query = params.toString();
  return `#/${page}${query ? `?${query}` : ""}`;
}

export function syncBrowserRoute(view, { replace = false } = {}) {
  const hash = browserRouteHash(view);
  if (window.location.hash === hash) return false;
  const url = `${window.location.pathname}${window.location.search}${hash}`;
  if (replace) window.history.replaceState(window.history.state, "", url);
  else window.history.pushState({ opensybau: true }, "", url);
  return true;
}
