use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::path::Path;

use crate::json::{write_escaped_str, JsonValue};
use crate::scanner::scan_workspace_files;

#[derive(Debug, Clone)]
pub struct SymbolDef {
    pub name: String,
    pub signature: String,
    pub line: usize,
}

fn is_code_file(rel: &str) -> bool {
    let lower = rel.to_ascii_lowercase();
    [
        ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".rs", ".py", ".go", ".java", ".cs",
        ".c", ".cc", ".cpp", ".h", ".hpp",
    ]
    .iter()
    .any(|ext| lower.ends_with(ext))
}

fn is_ident_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

fn extract_ident_at(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut start = 0;
    while start < bytes.len() && bytes[start].is_ascii_whitespace() {
        start += 1;
    }
    let mut end = start;
    while end < bytes.len() && is_ident_char(bytes[end]) {
        end += 1;
    }
    if end > start && !(bytes[start].is_ascii_digit()) {
        let name = &s[start..end];
        if name.len() >= 2 {
            return Some(name.to_string());
        }
    }
    None
}

pub fn extract_symbols(rel_path: &str, content: &str) -> Vec<SymbolDef> {
    let mut defs = Vec::new();
    let lower = rel_path.to_ascii_lowercase();
    let is_py = lower.ends_with(".py");
    let is_rs = lower.ends_with(".rs");
    let is_go = lower.ends_with(".go");

    for (idx, raw_line) in content.lines().enumerate() {
        let line_no = idx + 1;
        let trimmed = raw_line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with("//")
            || trimmed.starts_with('#')
            || trimmed.starts_with("/*")
            || trimmed.starts_with('*')
        {
            continue;
        }

        let mut sym_name: Option<String> = None;
        if is_rs {
            let s = trimmed
                .strip_prefix("pub(crate) ")
                .or_else(|| trimmed.strip_prefix("pub(super) "))
                .or_else(|| trimmed.strip_prefix("pub "))
                .unwrap_or(trimmed);
            let s = s.strip_prefix("async ").unwrap_or(s);
            for kw in ["fn ", "struct ", "enum ", "trait ", "mod ", "type "] {
                if let Some(rest) = s.strip_prefix(kw) {
                    sym_name = extract_ident_at(rest);
                    break;
                }
            }
        } else if is_py {
            let s = trimmed.strip_prefix("async ").unwrap_or(trimmed);
            for kw in ["def ", "class "] {
                if let Some(rest) = s.strip_prefix(kw) {
                    sym_name = extract_ident_at(rest);
                    break;
                }
            }
        } else if is_go {
            if let Some(rest) = trimmed.strip_prefix("func ") {
                let after_recv = if rest.starts_with('(') {
                    rest.split_once(')').map(|(_, r)| r.trim_start()).unwrap_or(rest)
                } else {
                    rest
                };
                sym_name = extract_ident_at(after_recv);
            } else if let Some(rest) = trimmed.strip_prefix("type ") {
                sym_name = extract_ident_at(rest);
            }
        } else {
            let s = trimmed
                .strip_prefix("export default ")
                .or_else(|| trimmed.strip_prefix("export "))
                .unwrap_or(trimmed);
            let s = s.strip_prefix("async ").unwrap_or(s);
            for kw in ["function* ", "function ", "class ", "interface ", "type ", "enum "] {
                if let Some(rest) = s.strip_prefix(kw) {
                    sym_name = extract_ident_at(rest);
                    break;
                }
            }
            if sym_name.is_none() && (trimmed.starts_with("export const ") || trimmed.starts_with("export let ")) {
                if let Some(rest) = trimmed
                    .strip_prefix("export const ")
                    .or_else(|| trimmed.strip_prefix("export let "))
                {
                    if let Some(name) = extract_ident_at(rest) {
                        if trimmed.contains("=>") || trimmed.contains("= function") {
                            sym_name = Some(name);
                        }
                    }
                }
            }
        }

        if let Some(name) = sym_name {
            if !matches!(
                name.as_str(),
                "if" | "for" | "while" | "switch" | "catch" | "return" | "new" | "default"
            ) {
                let sig: String = trimmed.chars().take(92).collect();
                defs.push(SymbolDef {
                    name,
                    signature: sig,
                    line: line_no,
                });
            }
        }
    }
    defs
}

fn collect_tokens(content: &str) -> BTreeSet<String> {
    let mut set = BTreeSet::new();
    let bytes = content.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if is_ident_char(bytes[i]) && !bytes[i].is_ascii_digit() {
            let start = i;
            i += 1;
            while i < bytes.len() && is_ident_char(bytes[i]) {
                i += 1;
            }
            if i - start >= 3 && i - start <= 64 {
                if let Ok(tok) = std::str::from_utf8(&bytes[start..i]) {
                    set.insert(tok.to_string());
                }
            }
        } else {
            i += 1;
        }
    }
    set
}

pub fn build_repo_map(
    root_path: &str,
    focus_files: &[String],
    max_tokens: usize,
) -> Result<(String, usize, usize, bool), String> {
    let root = fs::canonicalize(root_path).map_err(|e| e.to_string())?;
    let all_files = scan_workspace_files(root_path, 450)?;
    let code_files: Vec<String> = all_files.into_iter().filter(|p| is_code_file(p)).collect();
    if code_files.is_empty() {
        return Ok((String::new(), 0, 0, false));
    }

    let n = code_files.len();
    let file_to_idx: HashMap<String, usize> = code_files
        .iter()
        .enumerate()
        .map(|(i, p)| (p.clone(), i))
        .collect();

    let mut file_defs: Vec<Vec<SymbolDef>> = vec![Vec::new(); n];
    let mut sym_owners: HashMap<String, Vec<usize>> = HashMap::new();
    let mut file_tokens: Vec<BTreeSet<String>> = vec![BTreeSet::new(); n];
    let mut total_symbols = 0usize;

    for (idx, rel) in code_files.iter().enumerate() {
        let full: std::path::PathBuf = Path::new(&root).join(rel);
        let meta = match fs::metadata(&full) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !meta.is_file() || meta.len() > 140_000 {
            continue;
        }
        let Ok(text) = fs::read_to_string(&full) else {
            continue;
        };
        let defs = extract_symbols(rel, &text);
        total_symbols += defs.len();
        for d in &defs {
            sym_owners.entry(d.name.clone()).or_default().push(idx);
        }
        file_defs[idx] = defs;
        file_tokens[idx] = collect_tokens(&text);
    }

    // Build weighted adjacency list source -> target
    let mut out_edges: Vec<BTreeMap<usize, f64>> = vec![BTreeMap::new(); n];
    for i in 0..n {
        if file_tokens[i].is_empty() {
            continue;
        }
        for tok in &file_tokens[i] {
            if let Some(owners) = sym_owners.get(tok) {
                if owners.len() > 8 {
                    continue; // ignore overly ubiquitous symbol names
                }
                let weight = 1.0 / (owners.len() as f64);
                for &target in owners {
                    if target != i {
                        *out_edges[i].entry(target).or_insert(0.0) += weight;
                    }
                }
            }
        }
    }

    // Personalized PageRank (20 iterations)
    let focus_lower: BTreeSet<String> = focus_files
        .iter()
        .map(|s| s.replace('\\', "/").to_ascii_lowercase())
        .collect();
    let mut personal = vec![1.0_f64; n];
    for (idx, rel) in code_files.iter().enumerate() {
        let low = rel.to_ascii_lowercase();
        if focus_lower.contains(&low)
            || focus_lower.iter().any(|f| !f.is_empty() && low.ends_with(f))
        {
            personal[idx] = 8.0;
        } else if low == "server.mjs"
            || low.ends_with("/main.rs")
            || low.ends_with("/index.js")
            || low.ends_with("/index.ts")
            || low.ends_with("/app.jsx")
            || low.ends_with("/shell.jsx")
        {
            personal[idx] = 2.5;
        }
        if !file_defs[idx].is_empty() {
            personal[idx] *= 1.25;
        }
    }
    let p_sum: f64 = personal.iter().sum::<f64>().max(1e-9);
    for v in &mut personal {
        *v /= p_sum;
    }

    let mut rank = personal.clone();
    let damping = 0.85_f64;
    for _ in 0..20 {
        let mut next: Vec<f64> = personal.iter().map(|p| (1.0 - damping) * p).collect();
        let mut dangling_mass = 0.0_f64;
        for i in 0..n {
            if out_edges[i].is_empty() {
                dangling_mass += rank[i];
                continue;
            }
            let total_w: f64 = out_edges[i].values().sum();
            if total_w <= 0.0 {
                dangling_mass += rank[i];
                continue;
            }
            let share = damping * rank[i] / total_w;
            for (&target, &w) in &out_edges[i] {
                next[target] += share * w;
            }
        }
        if dangling_mass > 0.0 {
            for j in 0..n {
                next[j] += damping * dangling_mass * personal[j];
            }
        }
        rank = next;
    }

    let mut order: Vec<usize> = (0..n).collect();
    order.sort_by(|&a, &b| {
        rank[b]
            .partial_cmp(&rank[a])
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| file_defs[b].len().cmp(&file_defs[a].len()))
            .then_with(|| code_files[a].cmp(&code_files[b]))
    });

    let char_budget = max_tokens.clamp(200, 6000) * 4;
    let mut out = String::new();
    let mut truncated = false;
    let mut rendered_files = 0usize;

    for idx in order {
        let rel = &code_files[idx];
        let defs = &file_defs[idx];
        let mut block = format!("{}\n", rel);
        if defs.is_empty() {
            if rendered_files > 18 {
                continue;
            }
        } else {
            for def in defs.iter().take(12) {
                block.push_str(&format!("  L{}: {}\n", def.line, def.signature));
            }
            if defs.len() > 12 {
                block.push_str(&format!("  ... ({} more symbols)\n", defs.len() - 12));
            }
        }
        if out.len() + block.len() > char_budget {
            truncated = true;
            if rendered_files > 0 {
                break;
            }
            out.push_str(&block.chars().take(char_budget).collect::<String>());
            break;
        }
        out.push_str(&block);
        rendered_files += 1;
    }

    let _ = file_to_idx;
    Ok((out, code_files.len(), total_symbols, truncated))
}

pub fn serialize_repo_map_json(
    repo_map: &str,
    file_count: usize,
    symbol_count: usize,
    truncated: bool,
) -> String {
    let mut out = String::with_capacity(repo_map.len() + 128);
    out.push_str("{\"repoMap\":");
    write_escaped_str(&mut out, repo_map);
    out.push_str(&format!(
        ",\"fileCount\":{},\"symbolCount\":{},\"truncated\":{}}}",
        file_count,
        symbol_count,
        if truncated { "true" } else { "false" }
    ));
    out
}

pub fn repo_map_from_json(req: &JsonValue) -> Result<String, String> {
    let root_path = req.get_str("rootPath").unwrap_or("");
    let max_tokens = req.get("maxTokens").and_then(|v| v.as_usize()).unwrap_or(1000);
    let focus_files: Vec<String> = req
        .get("focusFiles")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    let (map, files, syms, truncated) = build_repo_map(root_path, &focus_files, max_tokens)?;
    Ok(serialize_repo_map_json(&map, files, syms, truncated))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_js_and_rust_symbols() {
        let js = "export async function runStage(task) {}\nclass Runner {}\n";
        let syms = extract_symbols("src/runner.mjs", js);
        let names: Vec<_> = syms.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["runStage", "Runner"]);

        let rs = "pub fn compute_map(n: usize) {}\npub(crate) struct Node {}\n";
        let rsyms = extract_symbols("src/map.rs", rs);
        let rnames: Vec<_> = rsyms.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(rnames, vec!["compute_map", "Node"]);
    }
}
