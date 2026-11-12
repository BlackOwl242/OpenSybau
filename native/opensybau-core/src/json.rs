use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq)]
pub enum JsonValue {
    Null,
    Bool(bool),
    Number(f64),
    Str(String),
    Array(Vec<JsonValue>),
    Object(BTreeMap<String, JsonValue>),
}

impl JsonValue {
    pub fn as_str(&self) -> Option<&str> {
        match self {
            JsonValue::Str(s) => Some(s.as_str()),
            _ => None,
        }
    }

    pub fn as_f64(&self) -> Option<f64> {
        match self {
            JsonValue::Number(n) => Some(*n),
            _ => None,
        }
    }

    pub fn as_usize(&self) -> Option<usize> {
        self.as_f64().map(|n| n.max(0.0) as usize)
    }

    pub fn as_array(&self) -> Option<&Vec<JsonValue>> {
        match self {
            JsonValue::Array(arr) => Some(arr),
            _ => None,
        }
    }

    pub fn get(&self, key: &str) -> Option<&JsonValue> {
        match self {
            JsonValue::Object(map) => map.get(key),
            _ => None,
        }
    }

    pub fn get_str(&self, key: &str) -> Option<&str> {
        self.get(key).and_then(|v| v.as_str())
    }
}

pub fn write_escaped_str(out: &mut String, s: &str) {
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0C}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

pub fn parse_json(input: &str) -> Result<JsonValue, String> {
    let bytes = input.as_bytes();
    let mut pos = 0;
    skip_ws(bytes, &mut pos);
    let val = parse_value(bytes, &mut pos)?;
    skip_ws(bytes, &mut pos);
    Ok(val)
}

fn skip_ws(bytes: &[u8], pos: &mut usize) {
    while *pos < bytes.len() {
        match bytes[*pos] {
            b' ' | b'\t' | b'\r' | b'\n' => *pos += 1,
            _ => break,
        }
    }
}

fn parse_value(bytes: &[u8], pos: &mut usize) -> Result<JsonValue, String> {
    skip_ws(bytes, pos);
    if *pos >= bytes.len() {
        return Err("Unexpected EOF".to_string());
    }
    match bytes[*pos] {
        b'"' => parse_string(bytes, pos).map(JsonValue::Str),
        b'{' => parse_object(bytes, pos),
        b'[' => parse_array(bytes, pos),
        b't' => {
            if bytes.get(*pos..*pos + 4) == Some(b"true") {
                *pos += 4;
                Ok(JsonValue::Bool(true))
            } else {
                Err("Invalid token 't'".to_string())
            }
        }
        b'f' => {
            if bytes.get(*pos..*pos + 5) == Some(b"false") {
                *pos += 5;
                Ok(JsonValue::Bool(false))
            } else {
                Err("Invalid token 'f'".to_string())
            }
        }
        b'n' => {
            if bytes.get(*pos..*pos + 4) == Some(b"null") {
                *pos += 4;
                Ok(JsonValue::Null)
            } else {
                Err("Invalid token 'n'".to_string())
            }
        }
        b'-' | b'0'..=b'9' => parse_number(bytes, pos),
        other => Err(format!("Unexpected byte '{}'", other as char)),
    }
}

fn parse_string(bytes: &[u8], pos: &mut usize) -> Result<String, String> {
    if bytes.get(*pos) != Some(&b'"') {
        return Err("Expected '\"'".to_string());
    }
    *pos += 1;
    let mut out = String::new();
    while *pos < bytes.len() {
        let b = bytes[*pos];
        if b == b'"' {
            *pos += 1;
            return Ok(out);
        }
        if b == b'\\' {
            *pos += 1;
            if *pos >= bytes.len() {
                return Err("Unexpected EOF in escape".to_string());
            }
            match bytes[*pos] {
                b'"' => {
                    out.push('"');
                    *pos += 1;
                }
                b'\\' => {
                    out.push('\\');
                    *pos += 1;
                }
                b'/' => {
                    out.push('/');
                    *pos += 1;
                }
                b'b' => {
                    out.push('\u{08}');
                    *pos += 1;
                }
                b'f' => {
                    out.push('\u{0C}');
                    *pos += 1;
                }
                b'n' => {
                    out.push('\n');
                    *pos += 1;
                }
                b'r' => {
                    out.push('\r');
                    *pos += 1;
                }
                b't' => {
                    out.push('\t');
                    *pos += 1;
                }
                b'u' => {
                    *pos += 1;
                    let code = parse_hex4(bytes, pos)?;
                    if (0xD800..=0xDBFF).contains(&code) {
                        if bytes.get(*pos..*pos + 2) == Some(b"\\u") {
                            *pos += 2;
                            let low = parse_hex4(bytes, pos)?;
                            if (0xDC00..=0xDFFF).contains(&low) {
                                let combined = 0x10000 + (((code - 0xD800) as u32) << 10) + ((low - 0xDC00) as u32);
                                if let Some(ch) = char::from_u32(combined) {
                                    out.push(ch);
                                    continue;
                                }
                            }
                        }
                        out.push('\u{FFFD}');
                    } else if let Some(ch) = char::from_u32(code as u32) {
                        out.push(ch);
                    } else {
                        out.push('\u{FFFD}');
                    }
                }
                other => {
                    out.push(other as char);
                    *pos += 1;
                }
            }
        } else {
            let start = *pos;
            while *pos < bytes.len() && bytes[*pos] != b'"' && bytes[*pos] != b'\\' {
                *pos += 1;
            }
            let slice = std::str::from_utf8(&bytes[start..*pos]).map_err(|e| e.to_string())?;
            out.push_str(slice);
        }
    }
    Err("Unterminated string".to_string())
}

fn parse_hex4(bytes: &[u8], pos: &mut usize) -> Result<u16, String> {
    if *pos + 4 > bytes.len() {
        return Err("Unexpected EOF in unicode escape".to_string());
    }
    let hex_str = std::str::from_utf8(&bytes[*pos..*pos + 4]).map_err(|e| e.to_string())?;
    *pos += 4;
    u16::from_str_radix(hex_str, 16).map_err(|e| e.to_string())
}

fn parse_number(bytes: &[u8], pos: &mut usize) -> Result<JsonValue, String> {
    let start = *pos;
    if bytes.get(*pos) == Some(&b'-') {
        *pos += 1;
    }
    while *pos < bytes.len() && bytes[*pos].is_ascii_digit() {
        *pos += 1;
    }
    if bytes.get(*pos) == Some(&b'.') {
        *pos += 1;
        while *pos < bytes.len() && bytes[*pos].is_ascii_digit() {
            *pos += 1;
        }
    }
    if matches!(bytes.get(*pos), Some(b'e' | b'E')) {
        *pos += 1;
        if matches!(bytes.get(*pos), Some(b'+' | b'-')) {
            *pos += 1;
        }
        while *pos < bytes.len() && bytes[*pos].is_ascii_digit() {
            *pos += 1;
        }
    }
    let s = std::str::from_utf8(&bytes[start..*pos]).map_err(|e| e.to_string())?;
    let num: f64 = s.parse().map_err(|e: std::num::ParseFloatError| e.to_string())?;
    Ok(JsonValue::Number(num))
}

fn parse_array(bytes: &[u8], pos: &mut usize) -> Result<JsonValue, String> {
    *pos += 1; // skip '['
    let mut items = Vec::new();
    skip_ws(bytes, pos);
    if bytes.get(*pos) == Some(&b']') {
        *pos += 1;
        return Ok(JsonValue::Array(items));
    }
    loop {
        let val = parse_value(bytes, pos)?;
        items.push(val);
        skip_ws(bytes, pos);
        match bytes.get(*pos) {
            Some(b',') => {
                *pos += 1;
            }
            Some(b']') => {
                *pos += 1;
                return Ok(JsonValue::Array(items));
            }
            _ => return Err("Expected ',' or ']' in array".to_string()),
        }
    }
}

fn parse_object(bytes: &[u8], pos: &mut usize) -> Result<JsonValue, String> {
    *pos += 1; // skip '{'
    let mut map = BTreeMap::new();
    skip_ws(bytes, pos);
    if bytes.get(*pos) == Some(&b'}') {
        *pos += 1;
        return Ok(JsonValue::Object(map));
    }
    loop {
        skip_ws(bytes, pos);
        let key = parse_string(bytes, pos)?;
        skip_ws(bytes, pos);
        if bytes.get(*pos) != Some(&b':') {
            return Err("Expected ':' after object key".to_string());
        }
        *pos += 1;
        let val = parse_value(bytes, pos)?;
        map.insert(key, val);
        skip_ws(bytes, pos);
        match bytes.get(*pos) {
            Some(b',') => {
                *pos += 1;
            }
            Some(b'}') => {
                *pos += 1;
                return Ok(JsonValue::Object(map));
            }
            _ => return Err("Expected ',' or '}' in object".to_string()),
        }
    }
}
