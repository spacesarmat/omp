use omp_desktop::commands;
use omp_desktop::http::HttpClient;
use omp_desktop::player::{PlayerConfig, PlayerManager};
use omp_desktop::server::{ServerConfig, ServerManager};
use omp_desktop::update::UpdateManager;
use std::sync::{Arc, Mutex};
use tauri::Manager;

fn main() {
    omp_desktop::commands::install_native_crash_hook();
    let app = tauri::Builder::default()
        .manage(HttpClient::new())
        .setup(|app| {
            let server = ServerManager::new(ServerConfig::from_environment()?);
            app.manage(server.cancellation());
            app.manage(Arc::new(Mutex::new(server)));
            let player = PlayerManager::new(PlayerConfig::from_environment()?);
            app.manage(player.cancellation());
            app.manage(Arc::new(Mutex::new(player)));
            app.manage(Arc::new(Mutex::new(UpdateManager::from_environment())));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::health,
            commands::target_platform,
            commands::server_start,
            commands::server_stop,
            commands::server_status,
            commands::server_update,
            commands::server_binary_installed,
            commands::native_http,
            commands::native_http_clear_cookies,
            commands::player_open,
            commands::player_pause,
            commands::player_stop,
            commands::player_status,
            commands::update_check,
            commands::update_download,
            commands::update_apply,
            commands::update_pending_result,
            commands::take_native_crashes
        ])
        .build(tauri::generate_context!())
        .expect("error while building OMP desktop");
    app.run(omp_desktop::lifecycle::on_run_event);
}
