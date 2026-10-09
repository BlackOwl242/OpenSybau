import { h } from "preact";

export function Icon({ name, size = 17 }) {
  const markup = window.LucideIcons?.toSvg(name, size) || "";
  return <span class="wb-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: markup }} />;
}
