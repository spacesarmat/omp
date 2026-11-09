use omp_desktop::commands;
use omp_desktop::server::{ServerConfig, ServerManager};
use std::sync::Mutex;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(Mutex::new(ServerManager::new(
                ServerConfig::from_environment()?,
            )));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::health,
            commands::target_platform,
            commands::server_start,
            commands::server_stop,
            commands::server_status,
            commands::server_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running OMP desktop");
}
