use simple_logger::SimpleLogger;

pub fn init_logger() {
  // might be called multiple times, but it's ok
  _ = SimpleLogger::new()
    .with_level(log::LevelFilter::Info)
    .init();
}
