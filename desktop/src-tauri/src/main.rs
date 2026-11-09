use omp_desktop::commands;
use omp_desktop::http::HttpClient;
use omp_desktop::server::{ServerConfig, ServerManager};
use std::sync::{Arc, Mutex};
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .manage(HttpClient::new())
        .setup(|app| {
            app.manage(Arc::new(Mutex::new(ServerManager::new(
                ServerConfig::from_environment()?,
            ))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::health,
            commands::target_platform,
            commands::server_start,
            commands::server_stop,
            commands::server_status,
            commands::server_update,
            commands::native_http,
            commands::native_http_clear_cookies
        ])
        .run(tauri::generate_context!())
        .expect("error while running OMP desktop");
}
