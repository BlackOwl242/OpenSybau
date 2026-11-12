mod bm25;
mod diff;
mod json;
mod scanner;
mod vault;

use std::env;
use std::io::{self, BufRead, Read, Write};

use bm25::{rank_bm25_from_json, serialize_bm25_hits_json};
use diff::{parse_unified_diff_files, serialize_diff_files_json};
use json::{parse_json, write_escaped_str};
use scanner::{scan_workspace_files, serialize_scanned_files_json};
use vault::{build_vault_knowledge_graph, serialize_vault_graph_json};

fn health_json() -> String {
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);
    format!(
        "{{\"ok\":true,\"engine\":\"opensybau-core\",\"lang\":\"rust\",\"version\":\"0.1.0\",\"threads\":{}}}",
        threads
    )
}

fn handle_worker_request(line: &str) -> String {
    let req = match parse_json(line) {
        Ok(v) => v,
        Err(e) => {
            let mut out = String::from("{\"id\":0,\"ok\":false,\"error\":");
            write_escaped_str(&mut out, &e);
            out.push('}');
            return out;
        }
    };

    let id = req.get("id").and_then(|v| v.as_usize()).unwrap_or(0);
    let op = req.get_str("op").unwrap_or("");

    match op {
        "health" => format!("{{\"id\":{},\"ok\":true,\"result\":{}}}", id, health_json()),
        "parse-diff" => {
            let diff_text = req.get_str("diffText").unwrap_or("");
            let files = parse_unified_diff_files(diff_text);
            let res_json = serialize_diff_files_json(&files);
            format!("{{\"id\":{},\"ok\":true,\"result\":{}}}", id, res_json)
        }
        "vault-graph" => {
            let root_path = req.get_str("rootPath").unwrap_or("");
            match build_vault_knowledge_graph(root_path) {
                Ok((nodes, edges)) => {
                    let res_json = serialize_vault_graph_json(&nodes, &edges);
                    format!("{{\"id\":{},\"ok\":true,\"result\":{}}}", id, res_json)
                }
                Err(err) => {
                    let mut out = format!("{{\"id\":{},\"ok\":false,\"error\":", id);
                    write_escaped_str(&mut out, &err);
                    out.push('}');
                    out
                }
            }
        }
        "rank-bm25" => {
            let hits = rank_bm25_from_json(&req);
            let res_json = serialize_bm25_hits_json(&hits);
            format!("{{\"id\":{},\"ok\":true,\"result\":{}}}", id, res_json)
        }
        "scan-files" => {
            let root_path = req.get_str("rootPath").unwrap_or("");
            let max_files = req.get("maxFiles").and_then(|v| v.as_usize()).unwrap_or(180);
            match scan_workspace_files(root_path, max_files) {
                Ok(files) => {
                    let res_json = serialize_scanned_files_json(&files);
                    format!("{{\"id\":{},\"ok\":true,\"result\":{}}}", id, res_json)
                }
                Err(err) => {
                    let mut out = format!("{{\"id\":{},\"ok\":false,\"error\":", id);
                    write_escaped_str(&mut out, &err);
                    out.push('}');
                    out
                }
            }
        }
        other => {
            let mut out = format!("{{\"id\":{},\"ok\":false,\"error\":", id);
            write_escaped_str(&mut out, &format!("Unknown operation: {}", other));
            out.push('}');
            out
        }
    }
}

fn run_worker_loop() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = stdin.lock();
    let mut writer = io::BufWriter::new(stdout.lock());
    let mut line = String::new();

    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break, // EOF
            Ok(_) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let response = handle_worker_request(trimmed);
                if writeln!(writer, "{}", response).is_err() {
                    break;
                }
                if writer.flush().is_err() {
                    break;
                }
            }
            Err(_) => break,
        }
    }
}

fn read_all_stdin() -> String {
    let mut buf = String::new();
    let _ = io::stdin().read_to_string(&mut buf);
    buf
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let cmd = args.get(1).map(|s| s.as_str()).unwrap_or("health");

    match cmd {
        "--worker" | "worker" | "serve" => {
            run_worker_loop();
        }
        "health" | "--version" | "-v" => {
            println!("{}", health_json());
        }
        "parse-diff" => {
            let input = read_all_stdin();
            let files = parse_unified_diff_files(&input);
            println!("{}", serialize_diff_files_json(&files));
        }
        "vault-graph" => {
            let root_path = args.get(2).map(|s| s.as_str()).unwrap_or(".");
            match build_vault_knowledge_graph(root_path) {
                Ok((nodes, edges)) => {
                    println!("{}", serialize_vault_graph_json(&nodes, &edges));
                }
                Err(e) => {
                    eprintln!("{}", e);
                    std::process::exit(1);
                }
            }
        }
        "rank-bm25" => {
            let input = read_all_stdin();
            match parse_json(&input) {
                Ok(payload) => {
                    let hits = rank_bm25_from_json(&payload);
                    println!("{}", serialize_bm25_hits_json(&hits));
                }
                Err(e) => {
                    eprintln!("{}", e);
                    std::process::exit(1);
                }
            }
        }
        "scan-files" => {
            let root_path = args.get(2).map(|s| s.as_str()).unwrap_or(".");
            let max_files = args
                .get(3)
                .and_then(|s| s.parse::<usize>().ok())
                .unwrap_or(180);
            match scan_workspace_files(root_path, max_files) {
                Ok(files) => {
                    println!("{}", serialize_scanned_files_json(&files));
                }
                Err(e) => {
                    eprintln!("{}", e);
                    std::process::exit(1);
                }
            }
        }
        _ => {
            eprintln!("Usage: opensybau-core [--worker | health | parse-diff | vault-graph <dir> | rank-bm25 | scan-files <dir> [max]]");
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_diff_parser_and_octal_unquote() {
        let sample = "diff --git \"a/src/\\303\\241pp.js\" \"b/src/\\303\\241pp.js\"\n--- \"a/src/\\303\\241pp.js\"\n+++ \"b/src/\\303\\241pp.js\"\n@@ -1,2 +1,3 @@\n const x = 1;\n-const y = 2;\n+const y = 3;\n+const z = 4;\n";
        let files = parse_unified_diff_files(sample);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "src/ápp.js");
        assert_eq!(files[0].additions, 2);
        assert_eq!(files[0].deletions, 1);
        assert_eq!(files[0].hunks.len(), 1);
        assert_eq!(files[0].hunks[0].lines.len(), 4);
    }

    #[test]
    fn test_bm25_ranking() {
        let req_str = r#"{
            "query": "fix worktree git lock",
            "workspaceId": "ws-1",
            "memories": [
                {"id": "m1", "workspaceId": "ws-1", "kind": "pitfall", "title": "Git worktree lock error", "content": "[BLOCKING] Always serialize shared checkout git worktree tasks"},
                {"id": "m2", "workspaceId": "ws-1", "kind": "lesson", "title": "CSS button padding", "content": "Use 8px spacing on toolbar buttons"}
            ]
        }"#;
        let payload = parse_json(req_str).unwrap();
        let hits = rank_bm25_from_json(&payload);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, "m1");
        assert!(hits[0].score > 2.0);
    }

    #[test]
    fn test_scanner_filter() {
        assert!(scanner::safe_for_remote_context("src/server/diff-parser.mjs"));
        assert!(!scanner::safe_for_remote_context(".env.local"));
        assert!(!scanner::safe_for_remote_context("config/id_rsa"));
        assert!(!scanner::safe_for_remote_context(".runtime/search.sqlite"));
    }
}
