import { h } from "preact";
import { navigation } from "../navigation.js";
import { Icon } from "../../shared/ui/Icon.jsx";

function countFor(item, snapshot) {
  const { state, skills = [] } = snapshot;
  if (!state) return "";
  if (item.count === "tasks") return state.tasks?.length || "";
  if (item.count === "running") return (state.tasks || []).filter((task) => ["queued", "running"].includes(task.status)).length || "";
  if (item.count === "workspaces") return state.workspaces?.length || "";
  if (item.count === "skills") return skills.length || "";
  if (item.count === "memory") return state.memoryCount || "";
  return "";
}

export function NavRail({ page, snapshot }) {
  const groups = ["work", "library", "system"];
  const isBusy = Boolean((snapshot.state?.tasks || []).some((task) => ["queued", "running"].includes(task.status)));
  return <aside class="wb-rail" aria-label="Điều hướng OpenSybau">
    <button class={`wb-mark ${isBusy ? "is-busy" : ""}`} data-page="chat" title="OpenSybau · Chat" aria-label="OpenSybau · Chat">
      <svg class="wb-mark-svg" viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <defs>
          <clipPath id="wbNavLogoClip">
            <circle cx="19.6" cy="19.8" r="6.8" />
            <circle cx="44.4" cy="44.2" r="6.8" />
            <path d="M29.8 24.2C29.8 23.45 30.22 22.76 30.89 22.43L48.72 13.51C49.91 12.92 51.2 13.78 51.2 15.11V24.9C51.2 25.65 50.78 26.34 50.11 26.67L35.09 34.18C34.55 34.45 34.2 35 34.2 35.61V39.8C34.2 40.55 33.78 41.24 33.11 41.57L15.28 50.49C14.09 51.08 12.8 50.22 12.8 48.89V39.1C12.8 38.35 13.22 37.66 13.89 37.33L28.91 29.82C29.45 29.55 29.8 29 29.8 28.39V24.2Z" />
          </clipPath>
        </defs>
        <g class="wireframe">
          <circle cx="19.6" cy="19.8" r="6.1" />
          <circle cx="44.4" cy="44.2" r="6.1" />
          <path d="M29.8 24.2C29.8 23.45 30.22 22.76 30.89 22.43L48.72 13.51C49.91 12.92 51.2 13.78 51.2 15.11V24.9C51.2 25.65 50.78 26.34 50.11 26.67L35.09 34.18C34.55 34.45 34.2 35 34.2 35.61V39.8C34.2 40.55 33.78 41.24 33.11 41.57L15.28 50.49C14.09 51.08 12.8 50.22 12.8 48.89V39.1C12.8 38.35 13.22 37.66 13.89 37.33L28.91 29.82C29.45 29.55 29.8 29 29.8 28.39V24.2Z" />
        </g>
        <g clip-path="url(#wbNavLogoClip)">
          <rect class="solid-fill-rect" x="-10" y="-10" width="84" height="84" fill="currentColor" />
        </g>
      </svg>
    </button>
    <nav class="wb-rail-nav">
      {groups.map((group) => <div class="wb-rail-group" key={group}>
        {navigation.filter((item) => item.group === group).map((item) => {
          const count = countFor(item, snapshot);
          return <button key={item.id} class={`wb-rail-link ${page === item.id ? "is-active" : ""}`} data-page={item.id} aria-label={item.label} aria-current={page === item.id ? "page" : undefined} title={item.label}>
            <Icon name={item.icon} />{count ? <span class="wb-rail-count">{count}</span> : null}
          </button>;
        })}
      </div>)}
    </nav>
    <div class="wb-rail-bottom"><span class="wb-avatar" title="OpenSybau · Local-first (127.0.0.1)">OS</span></div>
  </aside>;
}

