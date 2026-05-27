mod state;
mod commands;

use state::AppState;

pub fn run() {
    let app_state = AppState::new().expect("failed to initialize app state");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::boards::boards_list,
            commands::boards::boards_get,
            commands::boards::boards_create,
            commands::boards::boards_update,
            commands::boards::boards_delete,
            commands::cards::cards_list_for_board,
            commands::cards::cards_get_with_tags,
            commands::cards::cards_create,
            commands::cards::cards_update,
            commands::cards::cards_move,
            commands::cards::cards_delete,
            commands::comments::comments_list_for_card,
            commands::comments::comments_create,
            commands::comments::comments_clear,
            commands::executions::executions_list_for_card,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
