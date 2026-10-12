import { h } from "preact";
import { iconSvg } from "./icons.js";

export function Icon({ name, size = 17 }) {
  const markup = iconSvg(name, size);
  return <span class="wb-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: markup }} />;
}
