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

pub fn serve_pair_with_hook<F>(body: Vec<u8>, hook: F) -> (String, String)
where
    F: FnOnce() + Send + 'static,
{
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind paired mock server");
    let address = listener.local_addr().expect("paired server address");
    thread::spawn(move || {
        let mut streams = Vec::new();
        for _ in 0..2 {
            let (mut stream, _) = listener.accept().expect("accept paired request");
            let mut request = [0; 2048];
            let _ = stream.read(&mut request);
            streams.push(stream);
        }
        hook();
        let headers = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        for stream in &mut streams {
            let _ = stream.write_all(headers.as_bytes());
            let _ = stream.write_all(&body);
        }
    });
    (
        format!("http://{address}/first"),
        format!("http://{address}/second"),
    )
}
