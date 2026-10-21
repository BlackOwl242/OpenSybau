import { h } from "preact";
import { iconSvg } from "./icons.js";

export function Icon({ name, size = 17, class: className = "" }) {
  const markup = iconSvg(name, size);
  const classes = className ? `wb-icon ${className}` : "wb-icon";
  return <span class={classes} aria-hidden="true" dangerouslySetInnerHTML={{ __html: markup }} />;
}
