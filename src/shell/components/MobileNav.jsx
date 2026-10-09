import { h } from "preact";
import { useState } from "preact/hooks";
import { navigation } from "../navigation.js";
import { Icon } from "../../shared/ui/Icon.jsx";

const primaryIds = ["chat", "tasks", "flows", "workspaces"];

export function MobileNav({ page }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const primary = primaryIds.map((id) => navigation.find((item) => item.id === id)).filter(Boolean);
  const more = navigation.filter((item) => !primaryIds.includes(item.id));
  const moreActive = more.some((item) => item.id === page);

  return <>
    {moreOpen ? <div class="wb-mobile-more-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setMoreOpen(false); }}>
      <section class="wb-mobile-more-menu" role="menu" aria-label="Thêm trang">
        {more.map((item) => <button key={item.id} role="menuitem" data-page={item.id} class={page === item.id ? "is-active" : ""} onClick={() => setMoreOpen(false)}><Icon name={item.icon} size={18} /><span>{item.label}</span></button>)}
      </section>
    </div> : null}
    <nav class="wb-mobile-nav" aria-label="Điều hướng chính">
      {primary.map((item) => <button key={item.id} type="button" data-page={item.id} class={page === item.id ? "is-active" : ""} aria-current={page === item.id ? "page" : undefined}>
        <Icon name={item.icon} size={19} /><span>{item.id === "workspaces" ? "Dự án" : item.label}</span>
      </button>)}
      <button type="button" class={`wb-mobile-more-trigger ${moreActive || moreOpen ? "is-active" : ""}`} aria-expanded={moreOpen} onClick={() => setMoreOpen((value) => !value)}>
        <Icon name="ellipsis" size={19} /><span>Thêm</span>
      </button>
    </nav>
  </>;
}
