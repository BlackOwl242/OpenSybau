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
  return <aside class="wb-rail" aria-label="Điều hướng OpenSybau">
    <button class="wb-mark" data-page="chat" title="OpenSybau · Chat" aria-label="OpenSybau · Chat">O</button>
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
    <div class="wb-rail-bottom"><span class="wb-avatar" title="OpenSybau">O</span></div>
  </aside>;
}
