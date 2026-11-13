import { h } from "preact";
import { BRAND_RIBBON_PATH } from "./icons.js";

export function BrandLogo({ clipId = "wbBrandClip", className = "wb-brand-svg", class: classAlias = "", size = 24 }) {
  const safeClipId = String(clipId || "wbBrandClip").replace(/[^a-zA-Z0-9_-]/g, "") || "wbBrandClip";
  const classes = [className, classAlias].filter(Boolean).join(" ") || "wb-brand-svg";
  const dimension = Math.max(12, Number(size) || 24);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      class={classes}
      width={dimension}
      height={dimension}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={safeClipId}>
          <circle cx="19.6" cy="19.8" r="6.8" />
          <circle cx="44.4" cy="44.2" r="6.8" />
          <path d={BRAND_RIBBON_PATH} />
        </clipPath>
      </defs>
      <g class="wireframe">
        <circle cx="19.6" cy="19.8" r="6.1" />
        <circle cx="44.4" cy="44.2" r="6.1" />
        <path d={BRAND_RIBBON_PATH} />
      </g>
      <g clip-path={`url(#${safeClipId})`}>
        <rect class="solid-fill-rect" x="-10" y="-10" width="84" height="84" fill="currentColor" />
      </g>
    </svg>
  );
}
