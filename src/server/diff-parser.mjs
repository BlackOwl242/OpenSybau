export function parseUnifiedDiffFiles(diffText) {
  const raw = String(diffText || "");
  if (!raw.trim() || (!raw.includes("---") && !raw.includes("diff --git"))) return [];
  const lines = raw.split(/\r?\n/);
  const files = [];
  let current = null;
  let hunk = null;
  let oldLine = 1;
  let newLine = 1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("diff --git ")) {
      if (current && (current.hunks.length || current.additions || current.deletions)) files.push(current);
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      current = { path: match?.[2] || "file", oldPath: match?.[1] || "", status: "modified", additions: 0, deletions: 0, hunks: [] };
      hunk = null;
      continue;
    }
    if (line.startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) {
      const oldRaw = line.slice(4).trim().replace(/^a\//, "");
      const newRaw = lines[i + 1].slice(4).trim().replace(/^b\//, "");
      if (!current || current.hunks.length > 0) {
        if (current) files.push(current);
        current = { path: newRaw !== "/dev/null" ? newRaw : oldRaw, oldPath: oldRaw, status: "modified", additions: 0, deletions: 0, hunks: [] };
      } else {
        current.oldPath = oldRaw;
        current.path = newRaw !== "/dev/null" ? newRaw : oldRaw;
      }
      current.status = oldRaw === "/dev/null" ? "added" : newRaw === "/dev/null" ? "deleted" : "modified";
      hunk = null;
      i += 1;
      continue;
    }
    if (line.startsWith("@@ ")) {
      const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
      oldLine = m ? Number(m[1]) : 1;
      newLine = m ? Number(m[2]) : 1;
      if (!current) current = { path: "changes", oldPath: "changes", status: "modified", additions: 0, deletions: 0, hunks: [] };
      hunk = { header: line, lines: [] };
      current.hunks.push(hunk);
      continue;
    }
    if (!hunk || !current) continue;
    if (line.startsWith("\\ No newline")) continue;
    if (line.startsWith("+")) {
      hunk.lines.push({ type: "add", oldLine: null, newLine: newLine++, text: line.slice(1) });
      current.additions += 1;
    } else if (line.startsWith("-")) {
      hunk.lines.push({ type: "del", oldLine: oldLine++, newLine: null, text: line.slice(1) });
      current.deletions += 1;
    } else if (line.startsWith(" ") || line === "") {
      hunk.lines.push({ type: "ctx", oldLine: oldLine++, newLine: newLine++, text: line.startsWith(" ") ? line.slice(1) : "" });
    }
  }
  if (current && (current.hunks.length || current.additions || current.deletions)) files.push(current);
  return files.slice(0, 60);
}
