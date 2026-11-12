use crate::json::write_escaped_str;

#[derive(Debug, Clone)]
pub struct DiffLine {
    pub kind: &'static str, // "add" | "del" | "ctx"
    pub old_line: Option<u32>,
    pub new_line: Option<u32>,
    pub text: String,
}

#[derive(Debug, Clone)]
pub struct DiffHunk {
    pub header: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone)]
pub struct DiffFile {
    pub path: String,
    pub old_path: String,
    pub status: &'static str, // "added" | "deleted" | "modified"
    pub additions: u32,
    pub deletions: u32,
    pub hunks: Vec<DiffHunk>,
}

pub fn unquote_git_path(raw: &str) -> String {
    let mut s = raw.trim().to_string();
    if s.len() >= 2 && s.starts_with('"') && s.ends_with('"') {
        s = s[1..s.len() - 1].to_string();
    }
    // Recover octal sequences where '/' replaced '\' (e.g. /341/273/207 -> \341\273\207)
    s = recover_slash_octal(&s);
    if !s.contains('\\') {
        return s;
    }
    let bytes = s.as_bytes();
    let mut out_bytes: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\' && i + 1 < bytes.len() {
            if i + 3 < bytes.len()
                && (b'0'..=b'3').contains(&bytes[i + 1])
                && (b'0'..=b'7').contains(&bytes[i + 2])
                && (b'0'..=b'7').contains(&bytes[i + 3])
            {
                let oct = (bytes[i + 1] - b'0') * 64
                    + (bytes[i + 2] - b'0') * 8
                    + (bytes[i + 3] - b'0');
                out_bytes.push(oct);
                i += 4;
                continue;
            }
            match bytes[i + 1] {
                b'"' => {
                    out_bytes.push(b'"');
                    i += 2;
                    continue;
                }
                b't' => {
                    out_bytes.push(b'\t');
                    i += 2;
                    continue;
                }
                b'n' => {
                    out_bytes.push(b'\n');
                    i += 2;
                    continue;
                }
                b'\\' => {
                    out_bytes.push(b'\\');
                    i += 2;
                    continue;
                }
                _ => {}
            }
        }
        out_bytes.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out_bytes).into_owned()
}

fn recover_slash_octal(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        // Check for at least 2 consecutive /ooo octal sequences
        let mut count = 0;
        let mut j = i;
        while j + 3 < bytes.len()
            && bytes[j] == b'/'
            && (b'0'..=b'3').contains(&bytes[j + 1])
            && (b'0'..=b'7').contains(&bytes[j + 2])
            && (b'0'..=b'7').contains(&bytes[j + 3])
        {
            count += 1;
            j += 4;
        }
        if count >= 2 {
            for k in 0..count {
                let base = i + k * 4;
                out.push(b'\\');
                out.push(bytes[base + 1]);
                out.push(bytes[base + 2]);
                out.push(bytes[base + 3]);
            }
            i = j;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn clean_diff_header_path(raw: &str, prefix: &str) -> String {
    let mut s = unquote_git_path(raw.trim());
    if !prefix.is_empty() && s.starts_with(prefix) {
        s = s[prefix.len()..].to_string();
    }
    let normalized = s.replace('\\', "/");
    normalized.trim_start_matches('/').to_string()
}

fn parse_git_diff_header(line: &str) -> Option<(String, String)> {
    // Match `diff --git "?a/(.+?)"? "?b/(.+?)"?$`
    let rest = line.strip_prefix("diff --git ")?.trim();
    if let Some(pos) = rest.find(" \"b/") {
        let left = rest[..pos].trim().trim_matches('"');
        let right = rest[pos + 1..].trim().trim_matches('"');
        let old_p = left.strip_prefix("a/").unwrap_or(left);
        let new_p = right.strip_prefix("b/").unwrap_or(right);
        return Some((
            clean_diff_header_path(old_p, ""),
            clean_diff_header_path(new_p, ""),
        ));
    }
    if let Some(pos) = rest.find(" b/") {
        let left = rest[..pos].trim().trim_matches('"');
        let right = rest[pos + 1..].trim().trim_matches('"');
        let old_p = left.strip_prefix("a/").unwrap_or(left);
        let new_p = right.strip_prefix("b/").unwrap_or(right);
        return Some((
            clean_diff_header_path(old_p, ""),
            clean_diff_header_path(new_p, ""),
        ));
    }
    None
}

fn parse_hunk_header_lines(line: &str) -> (u32, u32) {
    // Match `^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@`
    if let Some(rest) = line.strip_prefix("@@ -") {
        if let Some(end_at) = rest.find(" @@") {
            let range_part = &rest[..end_at];
            let mut parts = range_part.split_whitespace();
            if let (Some(old_part), Some(new_part)) = (parts.next(), parts.next()) {
                let old_num_str = old_part.split(',').next().unwrap_or("1");
                let new_num_str = new_part
                    .strip_prefix('+')
                    .unwrap_or(new_part)
                    .split(',')
                    .next()
                    .unwrap_or("1");
                if let (Ok(old_n), Ok(new_n)) = (old_num_str.parse::<u32>(), new_num_str.parse::<u32>()) {
                    return (old_n, new_n);
                }
            }
        }
    }
    (1, 1)
}

pub fn parse_unified_diff_files(diff_text: &str) -> Vec<DiffFile> {
    if diff_text.trim().is_empty()
        || (!diff_text.contains("---") && !diff_text.contains("diff --git"))
    {
        return Vec::new();
    }

    let trimmed_input = diff_text
        .strip_suffix("\r\n")
        .or_else(|| diff_text.strip_suffix('\n'))
        .unwrap_or(diff_text);
    let lines: Vec<&str> = trimmed_input
        .split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l))
        .collect();

    let mut files: Vec<DiffFile> = Vec::new();
    let mut current: Option<DiffFile> = None;
    let mut old_line: u32 = 1;
    let mut new_line: u32 = 1;

    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        if line.starts_with("diff --git ") {
            if let Some(cur) = current.take() {
                if !cur.hunks.is_empty() || cur.additions > 0 || cur.deletions > 0 {
                    files.push(cur);
                }
            }
            let (old_p, new_p) = parse_git_diff_header(line)
                .unwrap_or_else(|| (String::new(), "file".to_string()));
            let path = if new_p.is_empty() {
                "file".to_string()
            } else {
                new_p
            };
            current = Some(DiffFile {
                path,
                old_path: old_p,
                status: "modified",
                additions: 0,
                deletions: 0,
                hunks: Vec::new(),
            });
            i += 1;
            continue;
        }

        if line.starts_with("--- ") && i + 1 < lines.len() && lines[i + 1].starts_with("+++ ") {
            let old_raw = clean_diff_header_path(&line[4..], "a/");
            let new_raw = clean_diff_header_path(&lines[i + 1][4..], "b/");
            let resolved_path = if new_raw != "dev/null" && new_raw != "/dev/null" {
                new_raw.clone()
            } else {
                old_raw.clone()
            };
            let status = if old_raw == "dev/null" || old_raw == "/dev/null" {
                "added"
            } else if new_raw == "dev/null" || new_raw == "/dev/null" {
                "deleted"
            } else {
                "modified"
            };

            let needs_new = match &current {
                None => true,
                Some(cur) => !cur.hunks.is_empty(),
            };
            if needs_new {
                if let Some(cur) = current.take() {
                    files.push(cur);
                }
                current = Some(DiffFile {
                    path: resolved_path,
                    old_path: old_raw,
                    status,
                    additions: 0,
                    deletions: 0,
                    hunks: Vec::new(),
                });
            } else if let Some(cur) = current.as_mut() {
                cur.old_path = old_raw;
                cur.path = resolved_path;
                cur.status = status;
            }
            i += 2;
            continue;
        }

        if line.starts_with("@@ ") {
            let (o, n) = parse_hunk_header_lines(line);
            old_line = o;
            new_line = n;
            if current.is_none() {
                current = Some(DiffFile {
                    path: "changes".to_string(),
                    old_path: "changes".to_string(),
                    status: "modified",
                    additions: 0,
                    deletions: 0,
                    hunks: Vec::new(),
                });
            }
            if let Some(cur) = current.as_mut() {
                cur.hunks.push(DiffHunk {
                    header: line.to_string(),
                    lines: Vec::new(),
                });
            }
            i += 1;
            continue;
        }

        if let Some(cur) = current.as_mut() {
            if let Some(hunk) = cur.hunks.last_mut() {
                if line.starts_with("\\ No newline") {
                    i += 1;
                    continue;
                }
                if let Some(rest) = line.strip_prefix('+') {
                    hunk.lines.push(DiffLine {
                        kind: "add",
                        old_line: None,
                        new_line: Some(new_line),
                        text: rest.to_string(),
                    });
                    new_line += 1;
                    cur.additions += 1;
                } else if let Some(rest) = line.strip_prefix('-') {
                    hunk.lines.push(DiffLine {
                        kind: "del",
                        old_line: Some(old_line),
                        new_line: None,
                        text: rest.to_string(),
                    });
                    old_line += 1;
                    cur.deletions += 1;
                } else if line.starts_with(' ') || line.is_empty() {
                    let text = line.strip_prefix(' ').unwrap_or("").to_string();
                    hunk.lines.push(DiffLine {
                        kind: "ctx",
                        old_line: Some(old_line),
                        new_line: Some(new_line),
                        text,
                    });
                    old_line += 1;
                    new_line += 1;
                }
            }
        }
        i += 1;
    }

    if let Some(cur) = current.take() {
        if !cur.hunks.is_empty() || cur.additions > 0 || cur.deletions > 0 {
            files.push(cur);
        }
    }
    files.truncate(60);
    files
}

pub fn serialize_diff_files_json(files: &[DiffFile]) -> String {
    let mut out = String::with_capacity(files.len() * 256 + 2);
    out.push('[');
    for (fi, file) in files.iter().enumerate() {
        if fi > 0 {
            out.push(',');
        }
        out.push_str("{\"path\":");
        write_escaped_str(&mut out, &file.path);
        out.push_str(",\"oldPath\":");
        write_escaped_str(&mut out, &file.old_path);
        out.push_str(",\"status\":");
        write_escaped_str(&mut out, file.status);
        out.push_str(&format!(
            ",\"additions\":{},\"deletions\":{},\"hunks\":[",
            file.additions, file.deletions
        ));
        for (hi, hunk) in file.hunks.iter().enumerate() {
            if hi > 0 {
                out.push(',');
            }
            out.push_str("{\"header\":");
            write_escaped_str(&mut out, &hunk.header);
            out.push_str(",\"lines\":[");
            for (li, line) in hunk.lines.iter().enumerate() {
                if li > 0 {
                    out.push(',');
                }
                out.push_str("{\"type\":");
                write_escaped_str(&mut out, line.kind);
                out.push_str(",\"oldLine\":");
                match line.old_line {
                    Some(n) => out.push_str(&n.to_string()),
                    None => out.push_str("null"),
                }
                out.push_str(",\"newLine\":");
                match line.new_line {
                    Some(n) => out.push_str(&n.to_string()),
                    None => out.push_str("null"),
                }
                out.push_str(",\"text\":");
                write_escaped_str(&mut out, &line.text);
                out.push('}');
            }
            out.push_str("]}");
        }
        out.push_str("]}");
    }
    out.push(']');
    out
}
