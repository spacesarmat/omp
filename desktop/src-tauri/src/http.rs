use base64::{engine::general_purpose::STANDARD, Engine as _};
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
    pub content_type: Option<String>,
    #[serde(default)]
    pub body_base64: Option<String>,
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
            content_type: None,
            body_base64: None,
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
    pub base64: String,
}

#[derive(Clone)]
pub struct HttpClient {
    agents: std::sync::Arc<std::sync::Mutex<HashMap<String, Agent>>>,
}

impl HttpClient {
    pub fn new() -> Self {
        Self {
            agents: Default::default(),
        }
    }

    fn agent_for(&self, url: &str) -> Result<Agent, String> {
        let host = url::Url::parse(url)
            .map_err(|_| "Invalid HTTP URL".to_string())?
            .host_str()
            .ok_or_else(|| "HTTP URL must have a host".to_string())?
            .to_ascii_lowercase();
        let mut agents = self
            .agents
            .lock()
            .map_err(|_| "HTTP client state is unavailable".to_string())?;
        if let Some(agent) = agents.get(&host) {
            return Ok(agent.clone());
        }
        let agent =
            Agent::new_with_config(Agent::config_builder().http_status_as_error(false).build());
        agents.insert(host, agent.clone());
        Ok(agent)
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
        let agent = self.agent_for(&request.url)?;
        let mut response = match request.method.as_str() {
            "GET" => prepare(agent.get(&request.url), headers, has_user_agent, timeout).call(),
            "POST" => {
                let builder = prepare(agent.post(&request.url), headers, has_user_agent, timeout);
                let builder = match request.content_type {
                    Some(content_type) => builder.header("Content-Type", content_type),
                    None => builder,
                };
                if let Some(form) = request.form {
                    let body = encode_form(&form, request.form_charset.as_deref());
                    builder
                        .header("Content-Type", "application/x-www-form-urlencoded")
                        .send(body.as_bytes())
                } else if let Some(body_base64) = request.body_base64 {
                    let body = STANDARD
                        .decode(body_base64)
                        .map_err(|_| "Invalid base64 request body".to_string())?;
                    builder.send(body)
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
        let base64 = STANDARD.encode(&bytes);
        let text = if charset.is_some_and(|name| name.eq_ignore_ascii_case("iso-8859-1")) {
            bytes.iter().map(|byte| char::from(*byte)).collect()
        } else {
            encoding.decode(&bytes).0.into_owned()
        };
        Ok(HttpResponse {
            status,
            url,
            text,
            base64,
        })
    }

    pub fn clear_cookies(&self, url: &str) -> Result<(), String> {
        let host = url::Url::parse(url)
            .map_err(|_| "Invalid HTTP URL".to_string())?
            .host_str()
            .ok_or_else(|| "HTTP URL must have a host".to_string())?
            .to_ascii_lowercase();
        let agents = self
            .agents
            .lock()
            .map_err(|_| "HTTP client state is unavailable".to_string())?;
        if let Some(agent) = agents.get(&host) {
            agent.cookie_jar_lock().clear();
        }
        Ok(())
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
