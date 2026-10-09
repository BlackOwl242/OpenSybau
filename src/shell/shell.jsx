import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import { NavRail } from "./components/NavRail.jsx";
import { ContextSidebar } from "./components/ContextSidebar.jsx";
import { MobileNav } from "./components/MobileNav.jsx";
import { TopBar } from "./components/TopBar.jsx";
import { pageLayouts } from "./navigation.js";

export function AppShell({ snapshot, pageMarkup }) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const page = snapshot.page || "chat";
  const home = page === "chat" && !snapshot.selected;
  const hasContextSidebar = pageLayouts[page]?.sidebar === "context";
  const hasPageSidebar = Boolean(snapshot.pageSidebarMarkup);
  const shellClasses = ["wb-app-shell", hasContextSidebar && "has-context-sidebar", hasPageSidebar && "has-page-sidebar", hasContextSidebar && hasPageSidebar && "has-both-sidebars"].filter(Boolean).join(" ");
  useEffect(() => { setMobileSidebarOpen(false); }, [page, snapshot.selected]);
  return <div class={shellClasses}>
    <NavRail page={page} snapshot={snapshot} />
    <ContextSidebar snapshot={snapshot} mobileOpen={mobileSidebarOpen} mobileOnly={!hasContextSidebar} onNavigate={() => setMobileSidebarOpen(false)} />
    {mobileSidebarOpen ? <button class="wb-mobile-sidebar-backdrop" type="button" aria-label="Đóng danh sách workspace" onClick={() => setMobileSidebarOpen(false)} /> : null}
    {hasPageSidebar && <aside class="wb-page-sidebar" dangerouslySetInnerHTML={{ __html: snapshot.pageSidebarMarkup }} />}
    <main class="wb-main">
      <TopBar snapshot={snapshot} onOpenNavigation={() => setMobileSidebarOpen(true)} />
      <section id="content" class={`content wb-page-content ${home ? "is-home" : ""} ${page === "chat" && snapshot.selected ? "is-task-detail" : ""}`} dangerouslySetInnerHTML={{ __html: pageMarkup }} />
    </main>
    <MobileNav page={page} />
  </div>;
}
