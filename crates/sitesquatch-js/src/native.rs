//! Native functions behind the `fs` and `Buffer` shims in `node.js`.
//!
//! Relative paths resolve against the project root (what `process.cwd()`
//! returns), not the directory `ssqch` was started from. Errors use Node's
//! message format (`ENOENT: no such file or directory, open 'x'`) so the
//! JavaScript side can set `err.code`.

use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use rquickjs::{Array, Ctx, Exception, Function, Object, Result, TypedArray, Value};

pub(crate) fn install<'js>(ctx: &Ctx<'js>, root: &Path) -> Result<()> {
    let native = Object::new(ctx.clone())?;
    let at = |root: &Path, p: &str| -> PathBuf { root.join(p) };

    let r = root.to_path_buf();
    native.set(
        "readFile",
        Function::new(ctx.clone(), move |ctx: Ctx<'js>, path: String, encoding: String| -> Result<Value<'js>> {
            let bytes = std::fs::read(at(&r, &path)).map_err(|e| throw(&ctx, e, "open", &path))?;
            if encoding.is_empty() {
                Ok(TypedArray::<u8>::new(ctx, bytes)?.into_value())
            } else {
                let text = decode(&bytes, &encoding).map_err(|m| Exception::throw_type(&ctx, &m))?;
                Ok(rquickjs::String::from_str(ctx, &text)?.into_value())
            }
        })?,
    )?;

    let r = root.to_path_buf();
    native.set(
        "writeFile",
        Function::new(ctx.clone(), move |ctx: Ctx<'js>, path: String, data: Value<'js>, encoding: String, append: bool| -> Result<()> {
            let bytes = bytes_of(&ctx, &data, &encoding)?;
            let target = at(&r, &path);
            let result = if append {
                use std::io::Write;
                std::fs::OpenOptions::new().create(true).append(true).open(&target).and_then(|mut f| f.write_all(&bytes))
            } else {
                std::fs::write(&target, bytes)
            };
            result.map_err(|e| throw(&ctx, e, "open", &path))
        })?,
    )?;

    let r = root.to_path_buf();
    native.set("exists", Function::new(ctx.clone(), move |path: String| at(&r, &path).exists())?)?;

    let r = root.to_path_buf();
    native.set(
        "stat",
        Function::new(ctx.clone(), move |ctx: Ctx<'js>, path: String, follow: bool| -> Result<Object<'js>> {
            let target = at(&r, &path);
            let meta = if follow { std::fs::metadata(&target) } else { std::fs::symlink_metadata(&target) };
            let meta = meta.map_err(|e| throw(&ctx, e, if follow { "stat" } else { "lstat" }, &path))?;
            let ms = |t: std::io::Result<SystemTime>| t.ok().and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok()).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0);
            let stats = Object::new(ctx)?;
            stats.set("file", meta.is_file())?;
            stats.set("dir", meta.is_dir())?;
            stats.set("symlink", meta.file_type().is_symlink())?;
            stats.set("size", meta.len() as f64)?;
            stats.set("mtimeMs", ms(meta.modified()))?;
            stats.set("atimeMs", ms(meta.accessed()))?;
            stats.set("ctimeMs", ms(meta.modified()))?;
            stats.set("birthtimeMs", ms(meta.created()))?;
            #[cfg(unix)]
            stats.set("mode", std::os::unix::fs::PermissionsExt::mode(&meta.permissions()) as f64)?;
            Ok(stats)
        })?,
    )?;

    let r = root.to_path_buf();
    native.set(
        "readdir",
        Function::new(ctx.clone(), move |ctx: Ctx<'js>, path: String| -> Result<Array<'js>> {
            let mut entries: Vec<_> = std::fs::read_dir(at(&r, &path)).map_err(|e| throw(&ctx, e, "scandir", &path))?.filter_map(|e| e.ok()).collect();
            entries.sort_by_key(|e| e.file_name());
            let out = Array::new(ctx.clone())?;
            for (i, entry) in entries.iter().enumerate() {
                let kind = entry.file_type().ok();
                let item = Object::new(ctx.clone())?;
                item.set("name", entry.file_name().to_string_lossy().into_owned())?;
                item.set("file", kind.is_some_and(|k| k.is_file()))?;
                item.set("dir", kind.is_some_and(|k| k.is_dir()))?;
                item.set("symlink", kind.is_some_and(|k| k.is_symlink()))?;
                out.set(i, item)?;
            }
            Ok(out)
        })?,
    )?;

    let r = root.to_path_buf();
    native.set(
        "mkdir",
        Function::new(ctx.clone(), move |ctx: Ctx<'js>, path: String, recursive: bool| -> Result<()> {
            let target = at(&r, &path);
            let result = if recursive { std::fs::create_dir_all(&target) } else { std::fs::create_dir(&target) };
            result.map_err(|e| throw(&ctx, e, "mkdir", &path))
        })?,
    )?;

    let r = root.to_path_buf();
    native.set(
        "rm",
        Function::new(ctx.clone(), move |ctx: Ctx<'js>, path: String, recursive: bool, force: bool| -> Result<()> {
            let target = at(&r, &path);
            let result = match std::fs::symlink_metadata(&target) {
                Ok(m) if m.is_dir() && recursive => std::fs::remove_dir_all(&target),
                // Node's own check, with its own error code.
                Ok(m) if m.is_dir() => {
                    return Err(Exception::throw_message(&ctx, &format!("ERR_FS_EISDIR: Path is a directory: rm returned EISDIR (is a directory) {}", path)));
                }
                Ok(_) => std::fs::remove_file(&target),
                Err(e) => Err(e),
            };
            match result {
                Err(e) if force && e.kind() == ErrorKind::NotFound => Ok(()),
                other => other.map_err(|e| throw(&ctx, e, "rm", &path)),
            }
        })?,
    )?;

    let r = root.to_path_buf();
    native.set(
        "unlink",
        Function::new(ctx.clone(), move |ctx: Ctx<'js>, path: String| -> Result<()> {
            std::fs::remove_file(at(&r, &path)).map_err(|e| throw(&ctx, e, "unlink", &path))
        })?,
    )?;

    let r = root.to_path_buf();
    native.set(
        "rename",
        Function::new(ctx.clone(), move |ctx: Ctx<'js>, from: String, to: String| -> Result<()> {
            std::fs::rename(at(&r, &from), at(&r, &to)).map_err(|e| throw(&ctx, e, "rename", &from))
        })?,
    )?;

    let r = root.to_path_buf();
    native.set(
        "copyFile",
        Function::new(ctx.clone(), move |ctx: Ctx<'js>, from: String, to: String| -> Result<()> {
            std::fs::copy(at(&r, &from), at(&r, &to)).map(|_| ()).map_err(|e| throw(&ctx, e, "copyfile", &from))
        })?,
    )?;

    let r = root.to_path_buf();
    native.set(
        "realpath",
        Function::new(ctx.clone(), move |ctx: Ctx<'js>, path: String| -> Result<String> {
            dunce::canonicalize(at(&r, &path)).map(|p| p.to_string_lossy().into_owned()).map_err(|e| throw(&ctx, e, "realpath", &path))
        })?,
    )?;

    native.set(
        "encode",
        Function::new(ctx.clone(), |ctx: Ctx<'js>, text: String, encoding: String| -> Result<TypedArray<'js, u8>> {
            let bytes = encode(&text, &encoding).map_err(|m| Exception::throw_type(&ctx, &m))?;
            TypedArray::new(ctx, bytes)
        })?,
    )?;
    native.set(
        "decode",
        Function::new(ctx.clone(), |ctx: Ctx<'js>, bytes: TypedArray<'js, u8>, encoding: String| -> Result<String> {
            decode(&copy_bytes(&bytes), &encoding).map_err(|m| Exception::throw_type(&ctx, &m))
        })?,
    )?;

    native.set(
        "hash",
        Function::new(ctx.clone(), |ctx: Ctx<'js>, algorithm: String, data: TypedArray<'js, u8>| -> Result<TypedArray<'js, u8>> {
            let bytes = copy_bytes(&data);
            let digest = hash(&algorithm, &bytes).ok_or_else(|| Exception::throw_type(&ctx, &format!("Digest method not supported: {}", algorithm)))?;
            TypedArray::new(ctx, digest)
        })?,
    )?;

    // Timers wait for real: a site's code may be pacing requests.
    native.set("sleep", Function::new(ctx.clone(), |ms: f64| {
        if ms > 0.0 {
            std::thread::sleep(std::time::Duration::from_secs_f64(ms.min(3_600_000.0) / 1000.0));
        }
    })?)?;

    // `URL`: parsing and setters follow the WHATWG URL standard (the `url`
    // crate's `quirks`). Both return the parts, which `URL` in node.js keeps.
    native.set(
        "urlParse",
        Function::new(ctx.clone(), |ctx: Ctx<'js>, input: String, base: rquickjs::prelude::Opt<String>| -> Result<Object<'js>> {
            let parsed = match base.0 {
                Some(base) => url::Url::parse(&base).and_then(|b| b.join(&input)),
                None => url::Url::parse(&input),
            };
            let parsed = parsed.map_err(|_| Exception::throw_type(&ctx, &format!("Invalid URL: {}", input)))?;
            url_parts(ctx, &parsed)
        })?,
    )?;
    native.set(
        "urlSet",
        Function::new(ctx.clone(), |ctx: Ctx<'js>, href: String, part: String, value: String| -> Result<Object<'js>> {
            use url::quirks;
            let mut u = url::Url::parse(&href).map_err(|_| Exception::throw_type(&ctx, &format!("Invalid URL: {}", href)))?;
            let ok = match part.as_str() {
                "href" => quirks::set_href(&mut u, &value).is_ok(),
                "protocol" => quirks::set_protocol(&mut u, &value).is_ok(),
                "username" => quirks::set_username(&mut u, &value).is_ok(),
                "password" => quirks::set_password(&mut u, &value).is_ok(),
                "host" => quirks::set_host(&mut u, &value).is_ok(),
                "hostname" => quirks::set_hostname(&mut u, &value).is_ok(),
                "port" => quirks::set_port(&mut u, &value).is_ok(),
                "pathname" => {
                    quirks::set_pathname(&mut u, &value);
                    true
                }
                "search" => {
                    quirks::set_search(&mut u, &value);
                    true
                }
                "hash" => {
                    quirks::set_hash(&mut u, &value);
                    true
                }
                _ => false,
            };
            if !ok && part == "href" {
                return Err(Exception::throw_type(&ctx, &format!("Invalid URL: {}", value)));
            }
            url_parts(ctx, &u)
        })?,
    )?;

    crate::fetch::install(ctx, &native, root)?;

    native.set("arch", match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        "x86" => "ia32",
        other => other,
    })?;

    ctx.globals().set("__ssqch_native", native)
}

fn url_parts<'js>(ctx: Ctx<'js>, u: &url::Url) -> Result<Object<'js>> {
    use url::quirks;
    let parts = Object::new(ctx)?;
    parts.set("href", quirks::href(u))?;
    parts.set("origin", quirks::origin(u))?;
    parts.set("protocol", quirks::protocol(u))?;
    parts.set("username", quirks::username(u))?;
    parts.set("password", quirks::password(u))?;
    parts.set("host", quirks::host(u))?;
    parts.set("hostname", quirks::hostname(u))?;
    parts.set("port", quirks::port(u))?;
    parts.set("pathname", quirks::pathname(u))?;
    parts.set("search", quirks::search(u))?;
    parts.set("hash", quirks::hash(u))?;
    Ok(parts)
}

/// `crypto.createHash()`'s digests (the list is in node.js).
fn hash(algorithm: &str, bytes: &[u8]) -> Option<Vec<u8>> {
    use sha2::Digest;
    Some(match algorithm.to_ascii_lowercase().as_str() {
        "md5" => md5::Md5::digest(bytes).to_vec(),
        "sha1" => sha1::Sha1::digest(bytes).to_vec(),
        "sha256" => sha2::Sha256::digest(bytes).to_vec(),
        "sha384" => sha2::Sha384::digest(bytes).to_vec(),
        "sha512" => sha2::Sha512::digest(bytes).to_vec(),
        _ => return None,
    })
}

fn bytes_of<'js>(ctx: &Ctx<'js>, data: &Value<'js>, encoding: &str) -> Result<Vec<u8>> {
    if let Some(s) = data.as_string() {
        return encode(&s.to_string()?, encoding).map_err(|m| Exception::throw_type(ctx, &m));
    }
    match TypedArray::<u8>::from_value(data.clone()) {
        Ok(arr) => Ok(copy_bytes(&arr)),
        Err(_) => Err(Exception::throw_type(ctx, "data must be a string, Buffer or Uint8Array")),
    }
}

/// Copy a typed array's bytes (its view, not the whole backing buffer).
pub(crate) fn copy_bytes(arr: &TypedArray<'_, u8>) -> Vec<u8> {
    // SAFETY: the slice is copied before any JavaScript can run.
    unsafe { arr.as_bytes() }.map(<[u8]>::to_vec).unwrap_or_default()
}

/// Throw an `Error` with Node's message format for an I/O failure.
fn throw(ctx: &Ctx<'_>, e: std::io::Error, syscall: &str, path: &str) -> rquickjs::Error {
    let (code, text) = match e.kind() {
        // EPERM and EACCES share an ErrorKind; Node names them apart.
        _ if e.raw_os_error() == Some(1) => ("EPERM", "operation not permitted"),
        ErrorKind::NotFound => ("ENOENT", "no such file or directory"),
        ErrorKind::PermissionDenied => ("EACCES", "permission denied"),
        ErrorKind::AlreadyExists => ("EEXIST", "file already exists"),
        ErrorKind::NotADirectory => ("ENOTDIR", "not a directory"),
        ErrorKind::IsADirectory => ("EISDIR", "illegal operation on a directory"),
        ErrorKind::DirectoryNotEmpty => ("ENOTEMPTY", "directory not empty"),
        _ => ("EIO", "i/o error"),
    };
    let detail = if code == "EIO" { format!("{} ({})", text, e) } else { text.to_string() };
    Exception::throw_message(ctx, &format!("{}: {}, {} '{}'", code, detail, syscall, path))
}

fn normalize_encoding(encoding: &str) -> String {
    encoding.to_ascii_lowercase().replace('-', "")
}

pub(crate) fn decode(bytes: &[u8], encoding: &str) -> std::result::Result<String, String> {
    Ok(match normalize_encoding(encoding).as_str() {
        "utf8" | "" => String::from_utf8_lossy(bytes).into_owned(),
        "latin1" | "binary" => bytes.iter().map(|&b| b as char).collect(),
        "ascii" => bytes.iter().map(|&b| (b & 0x7f) as char).collect(),
        "hex" => bytes.iter().map(|b| format!("{:02x}", b)).collect(),
        "base64" => base64_encode(bytes, B64, true),
        "base64url" => base64_encode(bytes, B64URL, false),
        other => return Err(format!("unknown encoding: {}", other)),
    })
}

pub(crate) fn encode(text: &str, encoding: &str) -> std::result::Result<Vec<u8>, String> {
    Ok(match normalize_encoding(encoding).as_str() {
        "utf8" | "" => text.as_bytes().to_vec(),
        "latin1" | "binary" | "ascii" => text.chars().map(|c| c as u32 as u8).collect(),
        "hex" => {
            let digits: Vec<u8> = text.bytes().take_while(|b| b.is_ascii_hexdigit()).collect();
            digits.as_chunks::<2>().0.iter().map(|p| u8::from_str_radix(std::str::from_utf8(p).unwrap_or("00"), 16).unwrap_or(0)).collect()
        }
        "base64" | "base64url" => base64_decode(text),
        other => return Err(format!("unknown encoding: {}", other)),
    })
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64URL: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

fn base64_encode(bytes: &[u8], alphabet: &[u8; 64], pad: bool) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (chunk[0] as u32) << 16 | (*chunk.get(1).unwrap_or(&0) as u32) << 8 | *chunk.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(alphabet[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else if pad {
                out.push('=');
            }
        }
    }
    out
}

/// Accepts both alphabets, with or without padding, skipping anything else
/// (like Node).
fn base64_decode(text: &str) -> Vec<u8> {
    let value = |c: u8| -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            _ => return None,
        } as u32)
    };
    let digits: Vec<u32> = text.bytes().take_while(|&c| c != b'=').filter_map(value).collect();
    let mut out = Vec::with_capacity(digits.len() * 3 / 4);
    for chunk in digits.chunks(4) {
        let n = chunk.iter().enumerate().fold(0u32, |n, (i, d)| n | d << (18 - 6 * i));
        for i in 0..chunk.len().saturating_sub(1) {
            out.push((n >> (16 - 8 * i)) as u8);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodings_round_trip() {
        for sample in ["", "f", "fo", "foo", "foob", "fooba", "foobar", "Sasquatch 🦶"] {
            let bytes = sample.as_bytes();
            for enc in ["utf8", "hex", "base64", "base64url", "latin1"] {
                let text = decode(bytes, enc).unwrap();
                if enc == "latin1" && !sample.is_ascii() {
                    continue;
                }
                assert_eq!(encode(&text, enc).unwrap(), bytes, "{} via {}", sample, enc);
            }
        }
        assert_eq!(decode(b"foobar", "base64").unwrap(), "Zm9vYmFy");
        assert_eq!(decode(b"fo", "base64").unwrap(), "Zm8=");
        assert_eq!(decode(b"fo", "base64url").unwrap(), "Zm8");
        assert_eq!(decode(&[0xfb, 0xff], "base64url").unwrap(), "-_8");
    }
}
