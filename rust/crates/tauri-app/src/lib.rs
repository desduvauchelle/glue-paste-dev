mod state;
mod commands;
mod event_callbacks;

use state::AppState;
use tauri::Manager;

pub fn run() {
    let app_state = AppState::new().expect("failed to initialize app state");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(app_state)
        .setup(|app| {
            let handle = app.handle().clone();
            app.state::<AppState>().app_handle.set(handle).ok();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // boards
            commands::boards::boards_list,
            commands::boards::boards_get,
            commands::boards::boards_create,
            commands::boards::boards_update,
            commands::boards::boards_delete,
            // cards
            commands::cards::cards_list_for_board,
            commands::cards::cards_get_with_tags,
            commands::cards::cards_create,
            commands::cards::cards_update,
            commands::cards::cards_move,
            commands::cards::cards_delete,
            // comments
            commands::comments::comments_list_for_card,
            commands::comments::comments_create,
            commands::comments::comments_clear,
            // executions
            commands::executions::executions_list_for_card,
            commands::executions::executions_get,
            // commits
            commands::commits::commits_list_for_card,
            // criteria
            commands::criteria::criteria_list_for_card,
            commands::criteria::criteria_add,
            commands::criteria::criteria_update,
            commands::criteria::criteria_remove,
            commands::criteria::criteria_reorder,
            // config
            commands::config::config_get_global,
            commands::config::config_get_for_board,
            commands::config::config_update_global,
            commands::config::config_update_for_board,
            // queue
            commands::queue::queue_start,
            commands::queue::queue_stop,
            commands::queue::queue_pause,
            commands::queue::queue_resume,
            commands::queue::queue_get_state,
            commands::queue::card_execute_single,
            commands::queue::card_stop,
            // tags
            commands::tags::tags_defaults,
            commands::tags::tags_for_board,
            // stats
            commands::stats::stats_board_counts,
            commands::stats::stats_done_per_day,
            commands::stats::stats_done_per_day_by_board,
            // system
            commands::system::system_open_folder,
            // auth
            commands::auth::auth_store_token,
            // caffeinate
            commands::caffeinate::caffeinate_status,
            commands::caffeinate::caffeinate_start,
            commands::caffeinate::caffeinate_stop,
            // files
            commands::files::files_browse,
            commands::files::files_tree,
            commands::files::attachments_list,
            commands::files::attachments_delete_file,
            commands::files::attachments_cleanup,
            // chat
            commands::chat::chat_start,
            commands::chat::chat_stop,
            // ai
            commands::ai::ai_generate_title,
            // update
            commands::update::update_check,
            // terminal
            commands::terminal::terminal_open,
            commands::terminal::terminal_close,
            commands::terminal::terminal_status,
            commands::terminal::terminal_input,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_interrupt,
            commands::terminal::terminal_kill_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
