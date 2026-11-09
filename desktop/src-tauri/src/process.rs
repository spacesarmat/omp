use std::io;
use std::path::Path;
use std::process::{Child, Command, Stdio};

pub fn command(program: &Path) -> Command {
    let mut command = Command::new(program);
    command.stdout(Stdio::null()).stderr(Stdio::null());
    command
}

pub fn stop(child: &mut Child) -> io::Result<()> {
    if child.try_wait()?.is_none() {
        child.kill()?;
    }
    child.wait()?;
    Ok(())
}
