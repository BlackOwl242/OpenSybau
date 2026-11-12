use std::collections::{HashMap, HashSet};

use crate::json::{JsonValue, write_escaped_str};

const STOP_WORDS: &[&str] = &[
    "the", "and", "for", "with", "this", "that", "cua", "codex", "task", "hãy", "của", "với",
    "cho", "một", "các", "trong", "được", "thực", "hiện", "và", "là", "có", "để", "từ", "ra",
    "về", "do", "bị", "sẽ", "đã", "vì", "nó", "ta", "ấy", "đó",
];

fn is_stop_word(word: &str) -> bool {
    STOP_WORDS.contains(&word)
}

fn is_token_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '-'
}

pub fn tokenize_terms(text: &str) -> Vec<String> {
    let lower = text.to_lowercase();
    let mut terms = Vec::new();
    let mut current = String::new();
    let mut char_count = 0usize;

    for ch in lower.chars() {
        if is_token_char(ch) {
            current.push(ch);
            char_count += 1;
        } else {
            if char_count >= 2 && !is_stop_word(&current) {
                terms.push(std::mem::take(&mut current));
            } else {
                current.clear();
            }
            char_count = 0;
        }
    }
    if char_count >= 2 && !is_stop_word(&current) {
        terms.push(current);
    }
    terms
}

pub fn tokenize_unique(text: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for term in tokenize_terms(text) {
        if seen.insert(term.clone()) {
            out.push(term);
        }
    }
    out
}

fn has_pitfall_marker(content: &str) -> bool {
    let lower = content.to_ascii_lowercase();
    lower.contains("[blocking]") || lower.contains("pitfall") || lower.contains("qa")
}

pub struct RankedHit {
    pub index: usize,
    pub id: String,
    pub score: f64,
}

pub fn rank_bm25_from_json(payload: &JsonValue) -> Vec<RankedHit> {
    let query_text = payload.get_str("query").unwrap_or("");
    let workspace_id = payload.get_str("workspaceId").unwrap_or("");
    let limit = payload.get("limit").and_then(|v| v.as_usize()).unwrap_or(4);
    let memories = match payload.get("memories").and_then(|v| v.as_array()) {
        Some(arr) => arr,
        None => return Vec::new(),
    };

    let query_terms = tokenize_unique(query_text);
    if query_terms.is_empty() || memories.is_empty() {
        return Vec::new();
    }

    struct ScopedDoc {
        orig_index: usize,
        id: String,
        workspace_id: String,
        kind: String,
        content: String,
        tf: HashMap<String, u32>,
        len: usize,
    }

    let mut scoped_docs = Vec::new();
    for (idx, item) in memories.iter().enumerate() {
        let ws = item.get_str("workspaceId").unwrap_or("");
        if ws != "all" && (workspace_id.is_empty() || ws != workspace_id) {
            continue;
        }
        let id = item.get_str("id").unwrap_or("").to_string();
        let title = item.get_str("title").unwrap_or("");
        let content = item.get_str("content").unwrap_or("");
        let kind = item.get_str("kind").unwrap_or("").to_string();
        let mut tags_joined = String::new();
        if let Some(tags) = item.get("tags").and_then(|v| v.as_array()) {
            for (ti, t) in tags.iter().enumerate() {
                if let Some(s) = t.as_str() {
                    if ti > 0 {
                        tags_joined.push(' ');
                    }
                    tags_joined.push_str(s);
                }
            }
        }
        let combined = format!("{} {} {} {}", title, title, content, tags_joined);
        let terms = tokenize_terms(&combined);
        let len = terms.len().max(1);
        let mut tf: HashMap<String, u32> = HashMap::with_capacity(terms.len());
        for t in terms {
            *tf.entry(t).or_insert(0) += 1;
        }
        scoped_docs.push(ScopedDoc {
            orig_index: idx,
            id,
            workspace_id: ws.to_string(),
            kind,
            content: content.to_string(),
            tf,
            len,
        });
    }

    if scoped_docs.is_empty() {
        return Vec::new();
    }

    let n = scoped_docs.len() as f64;
    let total_len: usize = scoped_docs.iter().map(|d| d.len).sum();
    let avg_dl = (total_len as f64) / n;
    let k1 = 1.5_f64;
    let b = 0.75_f64;

    let mut df: HashMap<&str, f64> = HashMap::with_capacity(query_terms.len());
    for term in &query_terms {
        let count = scoped_docs
            .iter()
            .filter(|doc| doc.tf.contains_key(term.as_str()))
            .count() as f64;
        df.insert(term.as_str(), count);
    }

    let mut hits: Vec<RankedHit> = scoped_docs
        .into_iter()
        .filter_map(|doc| {
            let mut bm25 = 0.0_f64;
            for term in &query_terms {
                let f = *doc.tf.get(term.as_str()).unwrap_or(&0) as f64;
                if f <= 0.0 {
                    continue;
                }
                let doc_freq = *df.get(term.as_str()).unwrap_or(&0.0);
                let idf = (1.0 + (n - doc_freq + 0.5) / (doc_freq + 0.5)).ln();
                let norm = f + k1 * (1.0 - b + b * ((doc.len as f64) / avg_dl));
                bm25 += idf * ((f * (k1 + 1.0)) / norm);
            }
            if bm25 <= 0.0 {
                return None;
            }
            let workspace_boost =
                if !workspace_id.is_empty() && doc.workspace_id == workspace_id {
                    1.25
                } else {
                    0.0
                };
            let pitfall_boost = if doc.kind == "pitfall" || has_pitfall_marker(&doc.content) {
                0.65
            } else {
                0.0
            };
            Some(RankedHit {
                index: doc.orig_index,
                id: doc.id,
                score: bm25 + workspace_boost + pitfall_boost,
            })
        })
        .collect();

    hits.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.index.cmp(&b.index))
    });
    hits.truncate(limit);
    hits
}

pub fn serialize_bm25_hits_json(hits: &[RankedHit]) -> String {
    let mut out = String::with_capacity(hits.len() * 64 + 32);
    out.push_str("{\"indices\":[");
    for (i, h) in hits.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&h.index.to_string());
    }
    out.push_str("],\"hits\":[");
    for (i, h) in hits.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&format!("{{\"index\":{},\"id\":", h.index));
        write_escaped_str(&mut out, &h.id);
        out.push_str(&format!(",\"score\":{:.6}}}", h.score));
    }
    out.push_str("]}");
    out
}
