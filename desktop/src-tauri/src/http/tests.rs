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
