import { h } from "preact";
import { iconSvg } from "./icons.js";

export function Icon({ name, size = 16, className = "", class: classAlias = "" }) {
  const markup = iconSvg(name, size);
  const resolvedClass = [className, classAlias].filter(Boolean).join(" ");
  const classes = resolvedClass ? `wb-icon ${resolvedClass}` : "wb-icon";
  return <span class={classes} aria-hidden="true" dangerouslySetInnerHTML={{ __html: markup }} />;
}
