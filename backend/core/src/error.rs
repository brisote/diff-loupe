use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ErrorCode {
    NotARepository,
    BareRepository,
    NotFound,
    InvalidArgs,
    UnknownCommand,
    NoRepository,
    NotOpen,
    TargetNotFound,
    Cancelled,
    Git,
    GitRefused,
    Store,
    StoreVersion,
    Update,
    Io,
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{path} is not a git repository")]
    NotARepository { path: String },
    #[error("{path} is a bare repository; Diffloupe opens repositories that have a working folder")]
    BareRepository { path: String },
    #[error("{0} does not exist")]
    NotFound(String),
    #[error("invalid arguments: {0}")]
    InvalidArgs(String),
    #[error("unknown command: {0}")]
    UnknownCommand(String),
    #[error("no repository is open")]
    NoRepository,
    #[error("{0} is not the open repository")]
    NotOpen(String),
    #[error("The target branch {0} does not exist. Pick another target branch.")]
    TargetNotFound(String),
    #[error("The operation was cancelled.")]
    Cancelled,
    #[error("git failed: {0}")]
    Git(String),
    #[error("{0}")]
    GitRefused(String),
    #[error("storage failed: {0}")]
    Store(String),
    #[error("{0}")]
    NewerStore(String),
    #[error("{0}")]
    Upgrade(String),
    #[error("{0}")]
    Update(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

impl Error {
    pub fn code(&self) -> ErrorCode {
        match self {
            Error::NotARepository { .. } => ErrorCode::NotARepository,
            Error::BareRepository { .. } => ErrorCode::BareRepository,
            Error::NotFound(_) => ErrorCode::NotFound,
            Error::InvalidArgs(_) => ErrorCode::InvalidArgs,
            Error::UnknownCommand(_) => ErrorCode::UnknownCommand,
            Error::NoRepository => ErrorCode::NoRepository,
            Error::NotOpen(_) => ErrorCode::NotOpen,
            Error::TargetNotFound(_) => ErrorCode::TargetNotFound,
            Error::Cancelled => ErrorCode::Cancelled,
            Error::Git(_) => ErrorCode::Git,
            Error::GitRefused(_) => ErrorCode::GitRefused,
            Error::Store(_) => ErrorCode::Store,
            Error::NewerStore(_) | Error::Upgrade(_) => ErrorCode::StoreVersion,
            Error::Update(_) => ErrorCode::Update,
            Error::Io(_) => ErrorCode::Io,
        }
    }

    pub fn path(&self) -> Option<&str> {
        match self {
            Error::NotARepository { path }
            | Error::BareRepository { path }
            | Error::NotFound(path) => Some(path),
            _ => None,
        }
    }
}

impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Self {
        Error::Store(e.to_string())
    }
}

impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Error::InvalidArgs(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct ApiError {
    pub code: ErrorCode,
    pub message: String,
    pub path: Option<String>,
}

impl From<Error> for ApiError {
    fn from(e: Error) -> Self {
        ApiError {
            code: e.code(),
            message: e.to_string(),
            path: e.path().map(str::to_string),
        }
    }
}
