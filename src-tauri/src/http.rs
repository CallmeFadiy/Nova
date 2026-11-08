//! Shared HTTP client construction.
//!
//! reqwest's `rustls` feature uses `rustls-platform-verifier` on Android, which
//! panics unless the app initializes it with a JVM context. Nova does not ship
//! the required Kotlin verifier component, so Android clients use the bundled
//! Mozilla root store instead; desktop keeps reqwest's platform defaults.

pub(crate) fn client_builder() -> reqwest::ClientBuilder {
    #[cfg(target_os = "android")]
    {
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
        }
        let mut roots = rustls::RootCertStore::empty();
        roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let config = rustls::ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth();
        return reqwest::Client::builder().use_preconfigured_tls(config);
    }
    #[cfg(not(target_os = "android"))]
    reqwest::Client::builder()
}
