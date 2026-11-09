mod commands;
mod platform;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![commands::health, commands::target_platform])
        .run(tauri::generate_context!())
        .expect("error while running OMP desktop");
}
