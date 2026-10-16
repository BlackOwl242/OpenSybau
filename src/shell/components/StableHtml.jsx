import { h } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { patchHtml } from "../../shared/dom-patch.js";

export function StableHtml({ as: Tag = "section", html, background = false, scope, ...attributes }) {
  const ref = useRef(null);
  const previousScope = useRef(scope);
  const previousHtml = useRef(null);
  useLayoutEffect(() => {
    if (background && previousScope.current === scope && previousHtml.current === html) return;
    // Navigation may deliberately replace the document; background task events
    // patch in place so they cannot reset an unrelated form or preview.
    if (previousScope.current !== scope) ref.current.innerHTML = html;
    else patchHtml(ref.current, html, { background });
    previousScope.current = scope;
    previousHtml.current = html;
  });
  return <Tag {...attributes} ref={ref} />;
}
