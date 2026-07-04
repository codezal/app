// OS-native secret storage — macOS Keychain + Windows Credential Manager.
//
// Provider API keys and OAuth tokens used to live in plaintext inside
// settings.json. They now live in the OS keychain, encrypted at rest by the
// platform and isolated from the rest of the settings blob.
//
// The commands here are deliberately generic (service + account → value). The
// frontend (src/lib/providers/secret-store.ts) layers the key schema and a
// small index on top, storing one entry per provider so we never bump into the
// Windows Credential Manager per-blob size limit (~2.5 KB) by concatenating
// every token into a single record.
use keyring::Entry;

// Map a keyring error to a stable string the frontend can log. NoEntry is not
// surfaced here — callers that care (get) translate it to `None` first.
fn err(e: keyring::Error) -> String {
    format!("keychain error: {e}")
}

// Read a secret. Returns None when the entry does not exist (a normal state,
// e.g. a provider that was never connected) rather than an error.
#[tauri::command]
pub fn secret_get(service: String, account: String) -> Result<Option<String>, String> {
    let entry = Entry::new(&service, &account).map_err(err)?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(err(e)),
    }
}

// Create or overwrite a secret. set_password upserts, so no existence check.
#[tauri::command]
pub fn secret_set(service: String, account: String, value: String) -> Result<(), String> {
    let entry = Entry::new(&service, &account).map_err(err)?;
    entry.set_password(&value).map_err(err)
}

// Delete a secret. A missing entry is treated as success — delete is
// idempotent, so disconnecting a provider twice is not an error.
#[tauri::command]
pub fn secret_delete(service: String, account: String) -> Result<(), String> {
    let entry = Entry::new(&service, &account).map_err(err)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(err(e)),
    }
}
