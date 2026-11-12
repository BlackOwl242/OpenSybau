import { h } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { patchHtml } from "../../shared/dom-patch.js";
import { getLanguage, localizeDom } from "../../shared/i18n.js";

export function StableHtml({ as: Tag = "section", html, background = false, scope, ...attributes }) {
  const ref = useRef(null);
  const previousScope = useRef(scope);
  const previousHtml = useRef(null);
  const previousLang = useRef(null);
  useLayoutEffect(() => {
    const lang = getLanguage();
    if (background && previousScope.current === scope && previousHtml.current === html && previousLang.current === lang) return;
    // Navigation may deliberately replace the document; background task events
    // patch in place so they cannot reset an unrelated form or preview.
    if (previousScope.current !== scope) {
      ref.current.innerHTML = html;
      localizeDom(ref.current, lang);
    } else {
      patchHtml(ref.current, html, { background });
    }
    previousScope.current = scope;
    previousHtml.current = html;
    previousLang.current = lang;
  });
  return <Tag {...attributes} data-stable-html="true" ref={ref} />;
}
