use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

pub struct MockServer {
    url: String,
}

impl MockServer {
    pub fn url(&self) -> &str {
        &self.url
    }
}

pub fn serve(body: Vec<u8>) -> MockServer {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
    let address = listener.local_addr().expect("mock server address");
    thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept mock request");
        let mut request = [0; 2048];
        let _ = stream.read(&mut request);
        let headers = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        let _ = stream.write_all(headers.as_bytes());
        let _ = stream.write_all(&body);
    });
    MockServer {
        url: format!("http://{address}/payload"),
    }
}
