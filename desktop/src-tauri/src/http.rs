use encoding_rs::{Encoding, UTF_8};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::time::Duration;
use ureq::Agent;

const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeHttpRequest {
    pub url: String,
    #[serde(default = "default_method")]
    pub method: String,
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
    #[serde(default)]
    pub form: Option<HashMap<String, String>>,
    #[serde(default)]
    pub form_charset: Option<String>,
    #[serde(default)]
    pub response_charset: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

impl Default for NativeHttpRequest {
    fn default() -> Self {
        Self {
            url: String::new(),
            method: default_method(),
            headers: None,
            form: None,
            form_charset: None,
            response_charset: None,
            body: None,
            timeout_ms: None,
        }
    }
}

fn default_method() -> String {
    "GET".to_string()
}

#[derive(Debug, Serialize)]
pub struct HttpResponse {
    pub status: u16,
    pub url: String,
    pub text: String,
}

#[derive(Clone)]
pub struct HttpClient {
    agent: Agent,
}

impl HttpClient {
    pub fn new() -> Self {
        let agent =
            Agent::new_with_config(Agent::config_builder().http_status_as_error(false).build());
        Self { agent }
    }

    pub fn request(&self, request: NativeHttpRequest) -> Result<HttpResponse, String> {
        if !has_http_scheme(&request.url) {
            return Err("HTTP or HTTPS URL is required".to_string());
        }
        if !matches!(request.method.as_str(), "GET" | "POST") {
            return Err("Only GET and POST are supported".to_string());
        }
        let has_user_agent = request.headers.as_ref().is_some_and(|headers| {
            headers
                .keys()
                .any(|name| name.eq_ignore_ascii_case("user-agent"))
        });
        let headers = request.headers.unwrap_or_default();
        let timeout = Duration::from_millis(request.timeout_ms.unwrap_or(30_000).clamp(1, 120_000));
        let mut response = match request.method.as_str() {
            "GET" => prepare(
                self.agent.get(&request.url),
                headers,
                has_user_agent,
                timeout,
            )
            .call(),
            "POST" => {
                let builder = prepare(
                    self.agent.post(&request.url),
                    headers,
                    has_user_agent,
                    timeout,
                );
                if let Some(form) = request.form {
                    let body = encode_form(&form, request.form_charset.as_deref());
                    builder
                        .header("Content-Type", "application/x-www-form-urlencoded")
                        .send(body.as_bytes())
                } else if let Some(body) = request.body {
                    builder.send(body.as_bytes())
                } else {
                    builder.send_empty()
                }
            }
            _ => unreachable!(),
        }
        .map_err(|_| "HTTP request failed".to_string())?;

        let status = response.status().as_u16();
        let url = ureq::ResponseExt::get_uri(&response).to_string();
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_string();
        let charset = request
            .response_charset
            .as_deref()
            .or_else(|| charset_from_content_type(&content_type));
        let encoding = charset
            .and_then(|name| Encoding::for_label(name.trim().as_bytes()))
            .unwrap_or(UTF_8);
        let mut reader = response.body_mut().as_reader();
        let mut bytes = Vec::new();
        let mut buffer = [0_u8; 16 * 1024];
        loop {
            let count = reader
                .read(&mut buffer)
                .map_err(|_| "HTTP response read failed".to_string())?;
            if count == 0 {
                break;
            }
            if bytes.len() + count > MAX_RESPONSE_BYTES {
                return Err("HTTP response is too large".to_string());
            }
            bytes.extend_from_slice(&buffer[..count]);
        }
        let text = encoding.decode(&bytes).0.into_owned();
        Ok(HttpResponse { status, url, text })
    }

    pub fn clear_cookies(&self) {
        self.agent.cookie_jar_lock().clear();
    }
}

fn prepare<T>(
    mut builder: ureq::RequestBuilder<T>,
    headers: HashMap<String, String>,
    has_user_agent: bool,
    timeout: Duration,
) -> ureq::RequestBuilder<T> {
    for (name, value) in headers {
        builder = builder.header(name, value);
    }
    if !has_user_agent {
        builder = builder.header("User-Agent", "OMP Desktop/0.1");
    }
    builder.config().timeout_global(Some(timeout)).build()
}

fn has_http_scheme(url: &str) -> bool {
    ["http://", "https://"].iter().any(|scheme| {
        url.get(..scheme.len())
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case(scheme))
    })
}

fn charset_from_content_type(content_type: &str) -> Option<&str> {
    content_type.split(';').find_map(|part| {
        let part = part.trim();
        part.strip_prefix("charset=")
            .map(|charset| charset.trim_matches(|c| c == '"' || c == '\''))
    })
}

fn encode_form(form: &HashMap<String, String>, charset: Option<&str>) -> String {
    let encoding = charset
        .and_then(|name| Encoding::for_label(name.as_bytes()))
        .unwrap_or(UTF_8);
    form.iter()
        .map(|(key, value)| {
            let key = encode_component(encoding, key);
            let value = encode_component(encoding, value);
            format!("{key}={value}")
        })
        .collect::<Vec<_>>()
        .join("&")
}

fn encode_component(encoding: &'static Encoding, value: &str) -> String {
    let (bytes, _, _) = encoding.encode(value);
    url::form_urlencoded::byte_serialize(&bytes)
        .collect::<String>()
        .replace("%20", "+")
}

#[cfg(test)]
mod tests;
