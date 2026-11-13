import { h } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { patchHtml } from "../../shared/dom-patch.js";
import { getLanguage, localizeDom } from "../../shared/i18n.js";

export function StableHtml({ as: Tag = "section", html, background = false, scope, scopeKey, ...attributes }) {
  const effectiveScope = scopeKey !== undefined ? scopeKey : scope;
  const ref = useRef(null);
  const previousScope = useRef(effectiveScope);
  const previousHtml = useRef(null);
  const previousLang = useRef(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const lang = getLanguage();
    const safeHtml = html || "";
    if (background && previousScope.current === effectiveScope && previousHtml.current === safeHtml && previousLang.current === lang) return;
    // Navigation or context switch deliberately replaces inner DOM and resets scroll;
    // background task events patch in place so they cannot reset an active form or preview.
    if (previousScope.current !== effectiveScope) {
      ref.current.innerHTML = safeHtml;
      ref.current.scrollTop = 0;
      ref.current.scrollLeft = 0;
      localizeDom(ref.current, lang);
    } else {
      patchHtml(ref.current, safeHtml, { background });
    }
    previousScope.current = effectiveScope;
    previousHtml.current = safeHtml;
    previousLang.current = lang;
  });
  return <Tag {...attributes} data-stable-html="true" ref={ref} />;
}
