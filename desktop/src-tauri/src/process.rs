use std::io::{self, Read, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};

pub trait IpcStream: Read + Write + Send {}
impl<T: Read + Write + Send> IpcStream for T {}

pub fn command(program: &Path) -> Command {
    let mut command = Command::new(program);
    command.stdout(Stdio::null()).stderr(Stdio::null());
    command
}

#[cfg(windows)]
pub fn stop(child: &mut Child) -> io::Result<()> {
    if child.try_wait()?.is_some() {
        child.wait()?;
        return Ok(());
    }
    let status = Command::new("taskkill")
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()?;
    if !status.success() && child.try_wait()?.is_none() {
        return Err(io::Error::other("taskkill failed"));
    }
    child.wait()?;
    Ok(())
}

#[cfg(not(windows))]
pub fn stop(child: &mut Child) -> io::Result<()> {
    if child.try_wait()?.is_none() {
        child.kill()?;
    }
    child.wait()?;
    Ok(())
}

#[cfg(windows)]
pub fn connect_ipc(path: &str) -> io::Result<Box<dyn IpcStream>> {
    use std::fs::OpenOptions;
    let path = if path.starts_with(r"\\.\pipe\") {
        path.to_string()
    } else {
        format!(r"\\.\pipe\{path}")
    };
    let stream = OpenOptions::new().read(true).write(true).open(path)?;
    Ok(Box::new(stream))
}

#[cfg(not(windows))]
pub fn connect_ipc(path: &str) -> io::Result<Box<dyn IpcStream>> {
    use std::os::unix::net::UnixStream;
    let stream = UnixStream::connect(path)?;
    Ok(Box::new(stream))
}
