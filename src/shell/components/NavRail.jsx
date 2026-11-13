import { h } from "preact";
import { navigation } from "../navigation.js";
import { Icon } from "../../shared/ui/Icon.jsx";
import { BrandLogo } from "../../shared/ui/BrandLogo.jsx";

function resolveAttentionCount(snapshot) {
  if (Array.isArray(snapshot?.attentionTasks)) return snapshot.attentionTasks.length;
  const tasks = (snapshot?.state?.tasks || []).filter((t) => !t.archived);
  return tasks.filter(
    (t) =>
      t.status === "awaiting_approval"
      || (Array.isArray(t.pendingApprovals) && t.pendingApprovals.length > 0)
      || t.status === "failed"
  ).length;
}

function countFor(item, snapshot) {
  const { state, skills = [] } = snapshot;
  if (!state) return "";
  if (item.id === "chat") {
    const attn = resolveAttentionCount(snapshot);
    return attn > 0 ? attn : "";
  }
  if (item.count === "tasks") return (state.tasks || []).filter((task) => !task.archived).length || "";
  if (item.count === "running") return (state.tasks || []).filter((task) => ["queued", "running"].includes(task.status)).length || "";
  if (item.count === "workspaces") return state.workspaces?.length || "";
  if (item.count === "skills") return skills.length || "";
  if (item.count === "memory") return state.memoryCount || "";
  return "";
}

export function NavRail({ page, snapshot }) {
  const groups = ["work", "library", "system"];
  const isBusy = Boolean((snapshot.state?.tasks || []).some((task) => ["queued", "running"].includes(task.status)));
  const attentionCount = resolveAttentionCount(snapshot);

  return (
    <aside class="wb-rail" aria-label="Điều hướng OpenSybau">
      <button
        type="button"
        class={`wb-mark ${isBusy ? "is-busy" : ""}`}
        data-page="chat"
        title="OpenSybau · Trang chủ Chat"
        aria-label="OpenSybau · Trang chủ Chat"
      >
        <BrandLogo clipId="wbRailLogo" className="wb-mark-svg" size={24} />
      </button>

      <div class="wb-rail-quick">
        <button
          type="button"
          class="wb-rail-link wb-rail-cmdk-btn"
          data-action="open-command-palette"
          title="Tìm kiếm & Lệnh nhanh (Ctrl+K)"
          aria-label="Tìm kiếm & Lệnh nhanh (Ctrl+K)"
        >
          <Icon name="search" size={16} />
        </button>
      </div>

      <nav class="wb-rail-nav">
        {groups.map((group) => (
          <div class="wb-rail-group" key={group}>
            {navigation
              .filter((item) => item.group === group)
              .map((item) => {
                const count = countFor(item, snapshot);
                const isAttentionBadge = item.id === "chat" && attentionCount > 0;
                return (
                  <button
                    key={item.id}
                    type="button"
                    class={`wb-rail-link ${page === item.id ? "is-active" : ""}`}
                    data-page={item.id}
                    aria-label={item.label}
                    aria-current={page === item.id ? "page" : undefined}
                    title={item.label}
                  >
                    <Icon name={item.icon} size={16} />
                    {count ? (
                      <span
                        class={`wb-rail-count ${isAttentionBadge ? "is-attention" : ""}`}
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
