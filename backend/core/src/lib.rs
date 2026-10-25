pub mod api;
mod core;
pub mod diff;
pub mod diffcache;
pub mod error;
pub mod events;
pub mod filediff;
pub mod footprint;
pub mod gitops;
pub mod history;
pub mod images;
pub mod merge;
pub mod merge3;
pub mod platform;
pub mod repo;
pub mod settings;
pub mod shellenv;
pub mod status;
pub mod store;
pub mod terminal;
#[cfg(feature = "testutil")]
pub mod testutil;
pub mod update;
pub mod watcher;

pub use crate::core::Core;
