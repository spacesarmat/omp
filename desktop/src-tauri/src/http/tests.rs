use super::{HttpClient, NativeHttpRequest};
use crate::http_test;
use std::collections::HashMap;

#[test]
fn native_http_returns_status_and_body() {
    let server = http_test::serve(b"hello".to_vec());
    let client = HttpClient::new();

    let response = client
        .request(NativeHttpRequest {
            url: server.url().to_string(),
            ..Default::default()
        })
        .expect("HTTP response");

    assert_eq!(response.status, 200);
    assert_eq!(response.text, "hello");
    assert_eq!(response.url, server.url());
}

#[test]
fn native_http_decodes_windows_1251() {
    let server = http_test::serve(vec![0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
    let client = HttpClient::new();

    let response = client
        .request(NativeHttpRequest {
            url: server.url().to_string(),
            response_charset: Some("windows-1251".to_string()),
            ..Default::default()
        })
        .expect("encoded response");

    assert_eq!(response.text, "Привет");
}

#[test]
fn native_http_posts_form_data() {
    let (server, captured) = http_test::serve_capture(b"form ok".to_vec());
    let client = HttpClient::new();

    let response = client
        .request(NativeHttpRequest {
            url: server.url().to_string(),
            method: "POST".to_string(),
            form: Some(HashMap::from([(
                "q".to_string(),
                "hello world".to_string(),
            )])),
            ..Default::default()
        })
        .expect("form response");

    assert_eq!(response.status, 200);
    let captured =
        String::from_utf8_lossy(&captured.lock().expect("captured request").clone()).into_owned();
    assert!(captured.contains("q=hello+world"), "{captured}");
}

#[test]
fn native_http_error_does_not_include_url_or_headers() {
    let client = HttpClient::new();

    let error = client
        .request(NativeHttpRequest {
            url: "file://secret-token".to_string(),
            headers: Some(HashMap::from([(
                "Authorization".to_string(),
                "Basic secret-value".to_string(),
            )])),
            ..Default::default()
        })
        .expect_err("invalid scheme must fail");

    assert!(!error.contains("secret-token"), "{error}");
    assert!(!error.contains("secret-value"), "{error}");
}

#[test]
fn native_http_preserves_iso_8859_1_bytes() {
    let server = http_test::serve(vec![0x00, 0x80, 0xff]);
    let client = HttpClient::new();

    let response = client
        .request(NativeHttpRequest {
            url: server.url().to_string(),
            response_charset: Some("iso-8859-1".to_string()),
            ..Default::default()
        })
        .expect("binary response");

    let codes = response.text.chars().map(|c| c as u32).collect::<Vec<_>>();
    assert_eq!(codes, vec![0, 128, 255]);
}

#[test]
fn clear_cookies_only_clears_the_requested_site() {
    let client = HttpClient::new();
    let first = client.agent_for("https://first.test").expect("first agent");
    let second = client
        .agent_for("https://second.test")
        .expect("second agent");
    let first_uri: ureq::http::Uri = "https://first.test".parse().expect("first URI");
    let second_uri: ureq::http::Uri = "https://second.test".parse().expect("second URI");
    first
        .cookie_jar_lock()
        .insert(
            ureq::Cookie::parse("first=1; Path=/", &first_uri).expect("first cookie"),
            &first_uri,
        )
        .expect("store first cookie");
    second
        .cookie_jar_lock()
        .insert(
            ureq::Cookie::parse("second=1; Path=/", &second_uri).expect("second cookie"),
            &second_uri,
        )
        .expect("store second cookie");

    client
        .clear_cookies("https://first.test")
        .expect("clear first site");

    assert_eq!(first.cookie_jar_lock().iter().count(), 0);
    assert_eq!(second.cookie_jar_lock().iter().count(), 1);
}

#[test]
fn native_http_returns_binary_response_as_base64() {
    let server = http_test::serve(vec![0x00, 0x80, 0xff]);
    let client = HttpClient::new();

    let response = client
        .request(NativeHttpRequest {
            url: server.url().to_string(),
            response_charset: Some("iso-8859-1".to_string()),
            ..Default::default()
        })
        .expect("binary response");

    assert_eq!(response.base64, "AID/");
}

#[test]
fn native_http_posts_base64_body_with_content_type() {
    let (server, captured) = http_test::serve_capture(b"upload ok".to_vec());
    let client = HttpClient::new();

    let response = client
        .request(NativeHttpRequest {
            url: server.url().to_string(),
            method: "POST".to_string(),
            body_base64: Some("AID/".to_string()),
            content_type: Some("application/x-bittorrent".to_string()),
            ..Default::default()
        })
        .expect("upload response");

    assert_eq!(response.status, 200);
    let captured = captured.lock().expect("captured request").clone();
    let text = String::from_utf8_lossy(&captured);
    assert!(text.contains("application/x-bittorrent"), "{text}");
    assert!(captured
        .windows(3)
        .any(|window| window == [0x00, 0x80, 0xff]));
}
