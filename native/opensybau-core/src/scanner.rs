use std::fs;
use std::path::Path;

use crate::json::write_escaped_str;
use crate::vault::is_ignored_dir;

pub fn safe_for_remote_context(rel_path: &str) -> bool {
    let norm = rel_path.replace('\\', "/");
    if norm.is_empty()
        || norm.contains('\0')
        || norm.contains('\r')
        || norm.contains('\n')
    {
        return false;
    }

    let lower = norm.to_ascii_lowercase();
    for seg in lower.split('/') {
        if matches!(
            seg,
            ".git"
                | ".runtime"
                | ".ssh"
                | ".aws"
                | "node_modules"
                | "dist"
                | "build"
                | "release"
                | "out"
                | "target"
                | "coverage"
                | ".next"
                | ".venv"
                | "venv"
                | ".cache"
                | ".turbo"
        ) {
            return false;
        }
        if seg == ".env"
            || seg.starts_with(".env.")
            || seg == ".npmrc"
            || seg == ".netrc"
            || seg == ".pypirc"
            || seg == ".git-credentials"
            || seg == "id_rsa"
            || seg == "id_ed25519"
            || seg.contains("secret")
            || seg.contains("credential")
            || seg.contains("token")
            || seg.contains("private_key")
            || seg.contains("private-key")
            || seg.contains("private.key")
            || seg.contains("privatekey")
        {
            return false;
        }
    }

    for ext in [".pem", ".p12", ".pfx", ".key", ".sqlite", ".db"] {
        if lower.ends_with(ext) {
            return false;
        }
    }
    true
}

pub fn scan_workspace_files(root_path: &str, max_files: usize) -> Result<Vec<String>, String> {
    let root = fs::canonicalize(root_path).map_err(|e| e.to_string())?;
    let mut paths = Vec::with_capacity(max_files.min(512));
    walk_dir(&root, "", 0, max_files, &mut paths);
    Ok(paths)
}

fn walk_dir(
    dir: &Path,
    rel_dir: &str,
    depth: usize,
    max_files: usize,
    out: &mut Vec<String>,
) {
    if depth > 9 || out.len() >= max_files {
        return;
    }
    let read_dir = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };
    let mut entries: Vec<_> = read_dir.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        if out.len() >= max_files {
            break;
        }
        let ft = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if ft.is_symlink() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == "." || name == ".." {
            continue;
        }
        let rel_path = if rel_dir.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", rel_dir, name)
        };
        if !safe_for_remote_context(&rel_path) {
            continue;
        }
        if ft.is_dir() {
            if !is_ignored_dir(&name) {
                walk_dir(&entry.path(), &rel_path, depth + 1, max_files, out);
            }
        } else if ft.is_file() {
            out.push(rel_path);
        }
    }
}

pub fn serialize_scanned_files_json(files: &[String]) -> String {
    let mut out = String::with_capacity(files.len() * 48 + 32);
    out.push_str("{\"files\":[");
    for (i, f) in files.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        write_escaped_str(&mut out, f);
    }
    out.push_str("]}");
    out
}
