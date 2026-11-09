// Start as a graphical application on Windows in every build profile.
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    m8_lib::run()
}
