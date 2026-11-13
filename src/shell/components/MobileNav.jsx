import { h } from "preact";
import { useState } from "preact/hooks";
import { navigation } from "../navigation.js";
import { Icon } from "../../shared/ui/Icon.jsx";

const primaryIds = ["chat", "tasks", "flows", "workspaces"];
const mobileShortLabels = {
  chat: "Trò chuyện",
  tasks: "Công việc",
  flows: "Luồng",
  workspaces: "Dự án",
};

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

export function MobileNav({ page, snapshot }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const primary = primaryIds.map((id) => navigation.find((item) => item.id === id)).filter(Boolean);
  const more = navigation.filter((item) => !primaryIds.includes(item.id));
  const moreActive = more.some((item) => item.id === page);
  const attentionCount = resolveAttentionCount(snapshot);
  const isViewingWorktrees = page === "chat" && snapshot?.mobileScreen === "worktrees";

  const handleNavigate = (event, targetPage) => {
    setMoreOpen(false);
    if (event.currentTarget && typeof event.currentTarget.blur === "function") {
      event.currentTarget.blur();
    }
    if (typeof window !== "undefined" && typeof window.__opensybauNavigate === "function") {
      window.__opensybauNavigate(targetPage);
    }
  };

  return (
    <>
      {moreOpen ? (
        <div
          class="wb-mobile-more-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setMoreOpen(false);
          }}
        >
          <section class="wb-mobile-more-menu" role="menu" aria-label="Thêm trang">
            {more.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                data-page={item.id}
                class={page === item.id ? "is-active" : ""}
                aria-current={page === item.id ? "page" : undefined}
                onClick={(event) => handleNavigate(event, item.id)}
              >
                <Icon name={item.icon} size={20} />
                <span>{item.label}</span>
              </button>
            ))}
          </section>
        </div>
      ) : null}
      <nav class="wb-mobile-nav" aria-label="Điều hướng chính">
        {primary.map((item) => {
          const isRouteMatch = item.id === "chat"
            ? page === "chat" && !isViewingWorktrees
            : page === item.id;
          const showBadge = attentionCount > 0 && (item.id === "tasks" || (item.id === "chat" && !isRouteMatch));
          return (
            <button
              key={item.id}
              type="button"
              data-page={item.id}
              class={isRouteMatch && !moreOpen ? "is-active" : ""}
              aria-current={isRouteMatch ? "page" : undefined}
              onClick={(event) => handleNavigate(event, item.id)}
            >
              <span class="wb-mobile-nav-icon-wrap">
                <Icon name={item.icon} size={20} />
                {showBadge ? (
                  <span class="wb-mobile-nav-badge" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {attentionCount > 99 ? "99+" : attentionCount}
                  </span>
                ) : null}
              </span>
              <span>{mobileShortLabels[item.id] || item.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          class={`wb-mobile-more-trigger ${moreActive || moreOpen ? "is-active" : ""}`}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((value) => !value)}
        >
          <Icon name="ellipsis" size={20} />
          <span>Thêm</span>
        </button>
      </nav>
    </>
  );
}
