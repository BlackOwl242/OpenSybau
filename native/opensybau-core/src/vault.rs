use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::json::write_escaped_str;

const IGNORED_DIRS: &[&str] = &[
    ".git",
    ".obsidian",
    ".trash",
    "node_modules",
    ".runtime",
    "dist",
    "build",
    "release",
    "out",
    "target",
    "coverage",
    ".next",
    "vendor",
    "__pycache__",
    ".venv",
    "venv",
    ".cache",
    ".turbo",
    ".parcel-cache",
    ".gradle",
];

#[derive(Debug, Clone)]
struct NoteFileEntry {
    abs: PathBuf,
    path: String,
    name: String,
    size: u64,
    modified_ms: u128,
}

#[derive(Debug, Clone)]
pub struct VaultNode {
    pub id: String,
    pub path: String,
    pub name: String,
    pub stem: String,
    pub title: String,
    pub folder: String,
    pub size: u64,
    pub modified_at: String,
    pub tags: Vec<String>,
    pub excerpt: String,
    pub degree: u32,
    pub links: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct VaultEdge {
    pub source: String,
    pub target: String,
    pub kind: &'static str,
    pub label: String,
}

pub fn is_ignored_dir(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    IGNORED_DIRS.iter().any(|&d| d == lower)
}

fn is_markdown_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".md") || lower.ends_with(".mdx") || lower.ends_with(".markdown")
}

fn strip_markdown_ext(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".markdown") {
        name[..name.len() - 9].to_string()
    } else if lower.ends_with(".mdx") {
        name[..name.len() - 4].to_string()
    } else if lower.ends_with(".md") {
        name[..name.len() - 3].to_string()
    } else {
        name.to_string()
    }
}

fn format_iso8601_millis(ms: u128) -> String {
    // Convert epoch milliseconds to ISO-8601 UTC string (YYYY-MM-DDTHH:MM:SS.sssZ)
    let total_secs = (ms / 1000) as i64;
    let millis = (ms % 1000) as u32;
    let days = total_secs.div_euclid(86_400);
    let secs_of_day = total_secs.rem_euclid(86_400) as u32;
    let hour = secs_of_day / 3600;
    let minute = (secs_of_day % 3600) / 60;
    let second = secs_of_day % 60;

    // Civil date from days since 1970-01-01 (Howard Hinnant algorithm)
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year, m, d, hour, minute, second, millis
    )
}

fn walk_vault_notes(root: &Path, dir: &Path, out: &mut Vec<NoteFileEntry>) {
    if out.len() >= 400 {
        return;
    }
    let read_dir = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };
    let mut entries: Vec<_> = read_dir.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        if out.len() >= 400 {
            break;
        }
        let ft = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if ft.is_symlink() {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().into_owned();
        let abs = entry.path();
        if ft.is_dir() {
            if is_ignored_dir(&file_name) {
                continue;
            }
            walk_vault_notes(root, &abs, out);
        } else if ft.is_file() && is_markdown_file(&file_name) {
            if let Ok(meta) = fs::metadata(&abs) {
                let size = meta.len();
                if size <= 512_000 {
                    let rel = abs
                        .strip_prefix(root)
                        .unwrap_or(&abs)
                        .to_string_lossy()
                        .replace('\\', "/");
                    let modified_ms = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_millis())
                        .unwrap_or_else(|| {
                            SystemTime::now()
                                .duration_since(UNIX_EPOCH)
                                .map(|d| d.as_millis())
                                .unwrap_or(0)
                        });
                    out.push(NoteFileEntry {
                        abs,
                        path: rel,
                        name: file_name,
                        size,
                        modified_ms,
                    });
                }
            }
        }
    }
}

fn strip_fenced_code_blocks(content: &str) -> String {
    let mut out = String::with_capacity(content.len());
    let mut rest = content;
    while let Some(start) = rest.find("```") {
        out.push_str(&rest[..start]);
        let after_open = &rest[start + 3..];
        if let Some(end) = after_open.find("```") {
            rest = &after_open[end + 3..];
        } else {
            return out;
        }
    }
    out.push_str(rest);
    out
}

fn extract_wiki_links(content: &str, links: &mut BTreeSet<String>) {
    let mut rest = content;
    while let Some(open) = rest.find("[[") {
        let after = &rest[open + 2..];
        if let Some(close) = after.find("]]") {
            let inner = &after[..close];
            if !inner.contains('\n') && !inner.contains('\r') {
                let target_raw = inner
                    .split(|c| c == '|' || c == '#')
                    .next()
                    .unwrap_or("")
                    .trim()
                    .replace('\\', "/");
                if !target_raw.is_empty() {
                    links.insert(target_raw);
                }
            }
            rest = &after[close + 2..];
        } else {
            break;
        }
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (
                (bytes[i + 1] as char).to_digit(16),
                (bytes[i + 2] as char).to_digit(16),
            ) {
                out.push(((h << 4) | l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn extract_markdown_links(content: &str, links: &mut BTreeSet<String>) {
    let mut rest = content;
    while let Some(mid) = rest.find("](") {
        let before = &rest[..mid];
        let after = &rest[mid + 2..];
        if before.rfind('[').is_some() {
            if let Some(close_paren) = after.find(')') {
                let target_full = after[..close_paren].trim();
                let lower = target_full.to_ascii_lowercase();
                if !lower.starts_with("http://")
                    && !lower.starts_with("https://")
                    && !lower.starts_with("obsidian://")
                    && !lower.starts_with("mailto:")
                    && !lower.starts_with('#')
                    && !target_full.contains(char::is_whitespace)
                {
                    let base = target_full
                        .split(|c| c == '#' || c == '?')
                        .next()
                        .unwrap_or("")
                        .trim();
                    let decoded = percent_decode(base).replace('\\', "/");
                    let clean = decoded.strip_prefix("./").unwrap_or(&decoded).trim();
                    if !clean.is_empty() {
                        links.insert(clean.to_string());
                    }
                }
                rest = &after[close_paren + 1..];
                continue;
            }
        }
        rest = after;
    }
}

fn is_tag_char(ch: char) -> bool {
    ch.is_alphanumeric() || ch == '_' || ch == '-' || ch == '/'
}

fn extract_hashtags(stripped: &str, tags: &mut BTreeSet<String>) {
    let chars: Vec<char> = stripped.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '#' {
            let prev_ok = i == 0 || chars[i - 1].is_whitespace();
            if prev_ok {
                let start = i + 1;
                let mut end = start;
                while end < chars.len() && is_tag_char(chars[end]) {
                    end += 1;
                }
                let len = end - start;
                if (2..=40).contains(&len) {
                    let tag: String = chars[start..end].iter().collect();
                    tags.insert(tag.to_lowercase());
                }
                i = end;
                continue;
            }
        }
        i += 1;
    }
}

fn extract_frontmatter_tags_and_strip(content: &str, tags: &mut BTreeSet<String>) -> usize {
    // Check if content starts with `---\n` or `---\r\n`
    let after_open = if let Some(s) = content.strip_prefix("---\r\n") {
        s
    } else if let Some(s) = content.strip_prefix("---\n") {
        s
    } else {
        return 0;
    };
    if let Some(close_idx) = after_open.find("\n---") {
        let fm_body = &after_open[..close_idx];
        for line in fm_body.lines() {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("tags:") {
                let rest = rest.trim();
                if let Some(open_b) = rest.find('[') {
                    if let Some(close_b) = rest[open_b + 1..].find(']') {
                        let inner = &rest[open_b + 1..open_b + 1 + close_b];
                        for part in inner.split(',') {
                            let t = part
                                .trim()
                                .trim_matches(|c| c == '\'' || c == '"')
                                .to_lowercase();
                            if !t.is_empty() {
                                tags.insert(t);
                            }
                        }
                    }
                }
            }
        }
        let header_len = content.len() - after_open.len();
        let mut end_pos = header_len + close_idx + 4; // "\n---"
        while end_pos < content.len() {
            let b = content.as_bytes()[end_pos];
            if b == b'\r' || b == b'\n' {
                end_pos += 1;
            } else {
                break;
            }
        }
        return end_pos;
    }
    0
}

fn parse_single_note(entry: &NoteFileEntry) -> VaultNode {
    let content = fs::read_to_string(&entry.abs).unwrap_or_default();
    let stem = strip_markdown_ext(&entry.name);
    let folder = match entry.path.rfind('/') {
        Some(idx) => entry.path[..idx].to_string(),
        None => String::new(),
    };

    let mut title = stem.clone();
    for line in content.lines() {
        if let Some(rest) = line.strip_prefix("# ") {
            let t = rest.trim();
            if !t.is_empty() {
                title = t.to_string();
                break;
            }
        }
    }

    let mut links = BTreeSet::new();
    extract_wiki_links(&content, &mut links);
    extract_markdown_links(&content, &mut links);

    let stripped = strip_fenced_code_blocks(&content);
    let mut tags = BTreeSet::new();
    extract_hashtags(&stripped, &mut tags);
    let fm_end = extract_frontmatter_tags_and_strip(&stripped, &mut tags);

    let body_without_fm = if fm_end <= stripped.len() {
        &stripped[fm_end..]
    } else {
        stripped.as_str()
    };

    let mut cleaned_lines = Vec::new();
    for line in body_without_fm.lines() {
        let cleaned = line
            .trim_start_matches(|c: char| {
                c == '#' || c == '>' || c == '*' || c == '-' || c.is_ascii_digit() || c == '.'
            })
            .trim();
        if !cleaned.is_empty() {
            cleaned_lines.push(cleaned);
        }
    }
    let joined = cleaned_lines.join("\n");
    let excerpt: String = joined.chars().take(180).collect();

    VaultNode {
        id: entry.path.clone(),
        path: entry.path.clone(),
        name: entry.name.clone(),
        stem,
        title,
        folder,
        size: entry.size,
        modified_at: format_iso8601_millis(entry.modified_ms),
        tags: tags.into_iter().collect(),
        excerpt,
        degree: 0,
        links: links.into_iter().collect(),
    }
}

pub fn build_vault_knowledge_graph(root_path: &str) -> Result<(Vec<VaultNode>, Vec<VaultEdge>), String> {
    let root = fs::canonicalize(root_path).map_err(|e| e.to_string())?;
    let mut note_files = Vec::new();
    walk_vault_notes(&root, &root, &mut note_files);

    if note_files.is_empty() {
        return Ok((Vec::new(), Vec::new()));
    }

    // Parallel file parsing across CPU cores using std::thread::scope
    let num_threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(1, 8);
    let chunk_size = note_files.len().div_ceil(num_threads).max(1);

    let mut nodes: Vec<VaultNode> = Vec::with_capacity(note_files.len());
    std::thread::scope(|s| {
        let mut handles = Vec::new();
        for chunk in note_files.chunks(chunk_size) {
            handles.push(s.spawn(move || {
                chunk.iter().map(parse_single_note).collect::<Vec<_>>()
            }));
        }
        for h in handles {
            if let Ok(mut part) = h.join() {
                nodes.append(&mut part);
            }
        }
    });

    let mut by_path: HashMap<String, usize> = HashMap::with_capacity(nodes.len() * 2);
    let mut by_stem: HashMap<String, usize> = HashMap::with_capacity(nodes.len());
    let mut tag_map: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut folder_map: BTreeMap<String, Vec<String>> = BTreeMap::new();

    for (idx, node) in nodes.iter().enumerate() {
        by_path.insert(node.path.to_lowercase(), idx);
        by_path.insert(strip_markdown_ext(&node.path).to_lowercase(), idx);
        let stem_lower = node.stem.to_lowercase();
        by_stem.entry(stem_lower).or_insert(idx);

        for tag in &node.tags {
            tag_map.entry(tag.clone()).or_default().push(node.id.clone());
        }
        folder_map
            .entry(node.folder.clone())
            .or_default()
            .push(node.id.clone());
    }

    let mut edges: Vec<VaultEdge> = Vec::new();
    let mut edge_keys: HashSet<String> = HashSet::new();

    let mut add_edge = |source: &str, target: &str, kind: &'static str, label: String| {
        if source.is_empty() || target.is_empty() || source == target {
            return;
        }
        let (a, b) = if source < target {
            (source, target)
        } else {
            (target, source)
        };
        let key = format!("{}::{}", a, b);
        if edge_keys.insert(key) {
            edges.push(VaultEdge {
                source: source.to_string(),
                target: target.to_string(),
                kind,
                label,
            });
        }
    };

    for node in &nodes {
        for raw in &node.links {
            let raw_lower = raw.to_lowercase();
            let key = strip_markdown_ext(&raw_lower);
            let stem_key = key.rsplit('/').next().unwrap_or(&key);
            let target_idx = by_path
                .get(&raw_lower)
                .or_else(|| by_path.get(&key))
                .or_else(|| by_stem.get(stem_key))
                .copied();
            if let Some(t_idx) = target_idx {
                let target_id = &nodes[t_idx].id;
                add_edge(&node.id, target_id, "link", "[[link]]".to_string());
            }
        }
    }

    for (tag, ids) in &tag_map {
        if ids.len() < 2 || ids.len() > 25 {
            continue;
        }
        for i in 0..ids.len() {
            for j in (i + 1)..ids.len() {
                add_edge(&ids[i], &ids[j], "tag", format!("#{}", tag));
            }
        }
    }

    for (folder, ids) in &folder_map {
        if ids.len() < 2 || ids.len() > 18 {
            continue;
        }
        let label = if folder.is_empty() {
            "root".to_string()
        } else {
            folder.clone()
        };
        for i in 0..(ids.len() - 1) {
            add_edge(&ids[i], &ids[i + 1], "folder", label.clone());
        }
    }

    let mut degree_map: HashMap<String, u32> = HashMap::with_capacity(nodes.len());
    for edge in &edges {
        let weight = if edge.kind == "link" { 2 } else { 1 };
        *degree_map.entry(edge.source.clone()).or_insert(0) += weight;
        *degree_map.entry(edge.target.clone()).or_insert(0) += weight;
    }
    for node in &mut nodes {
        node.degree = degree_map.get(&node.id).copied().unwrap_or(0);
    }

    Ok((nodes, edges))
}

pub fn serialize_vault_graph_json(nodes: &[VaultNode], edges: &[VaultEdge]) -> String {
    let mut out = String::with_capacity(nodes.len() * 320 + edges.len() * 96 + 32);
    out.push_str("{\"nodes\":[");
    for (i, n) in nodes.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str("{\"id\":");
        write_escaped_str(&mut out, &n.id);
        out.push_str(",\"path\":");
        write_escaped_str(&mut out, &n.path);
        out.push_str(",\"name\":");
        write_escaped_str(&mut out, &n.name);
        out.push_str(",\"stem\":");
        write_escaped_str(&mut out, &n.stem);
        out.push_str(",\"title\":");
        write_escaped_str(&mut out, &n.title);
        out.push_str(",\"folder\":");
        write_escaped_str(&mut out, &n.folder);
        out.push_str(&format!(",\"size\":{},\"modifiedAt\":", n.size));
        write_escaped_str(&mut out, &n.modified_at);
        out.push_str(",\"tags\":[");
        for (ti, tag) in n.tags.iter().enumerate() {
            if ti > 0 {
                out.push(',');
            }
            write_escaped_str(&mut out, tag);
        }
        out.push_str("],\"excerpt\":");
        write_escaped_str(&mut out, &n.excerpt);
        out.push_str(&format!(",\"degree\":{}}}", n.degree));
    }
    out.push_str("],\"edges\":[");
    for (i, e) in edges.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str("{\"source\":");
        write_escaped_str(&mut out, &e.source);
        out.push_str(",\"target\":");
        write_escaped_str(&mut out, &e.target);
        out.push_str(",\"kind\":");
        write_escaped_str(&mut out, e.kind);
        out.push_str(",\"label\":");
        write_escaped_str(&mut out, &e.label);
        out.push('}');
    }
    out.push_str("]}");
    out
}
