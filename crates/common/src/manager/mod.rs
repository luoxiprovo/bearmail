/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

use crate::USER_AGENT;
use hyper::HeaderMap;
use mail_auth::flate2;
use std::{
    io::{BufReader, Read},
    time::Duration,
};
use utils::HttpLimitResponse;

pub mod application;
pub mod backup;
pub mod boot;
pub mod console;
pub mod defaults;
pub mod restore;

pub const SPAM_TRAINER_KEY: &[u8] = "STALWART_SPAM_TRAIN_DATA.lz4".as_bytes();
pub const SPAM_CLASSIFIER_KEY: &[u8] = "STALWART_SPAM_CLASSIFIER_MODEL.lz4".as_bytes();

/// Community BearOS admin UI, stored in this repository. The server fetches
/// this zip instead of `github.com/stalwartlabs/webui`.
pub const BEAROS_WEBUI_URL: &str =
    "https://raw.githubusercontent.com/luoxiprovo/bearmail/main/bearos-webui/webui.zip";

/// Earlier standalone repository. A stored copy of this URL is fetched from
/// [`BEAROS_WEBUI_URL`] instead.
const RETIRED_BEAROS_WEBUI_PREFIX: &str = "luoxiprovo/bearos-webui";

/// The admin bundle published by Stalwart Labs. Any stored copy of this URL
/// is fetched from [`BEAROS_WEBUI_URL`] instead.
pub const STALWART_WEBUI_URL: &str =
    "https://github.com/stalwartlabs/webui/releases/latest/download/webui.zip";

pub fn download_url(url: &str) -> Result<&str, String> {
    if is_stalwartlabs_webui_url(url) || is_retired_bearos_webui_url(url) {
        return Ok(BEAROS_WEBUI_URL);
    }
    if is_stalwartlabs_github_url(url) {
        return Err(format!(
            "Refusing to download from a Stalwart Labs repository: {url}"
        ));
    }
    Ok(url)
}

pub fn is_retired_bearos_webui_url(url: &str) -> bool {
    url.trim()
        .trim_end_matches('/')
        .to_ascii_lowercase()
        .contains(RETIRED_BEAROS_WEBUI_PREFIX)
}

pub fn is_stalwartlabs_webui_url(url: &str) -> bool {
    let url = url.trim().trim_end_matches('/');
    url.eq_ignore_ascii_case(STALWART_WEBUI_URL)
        || url
            .to_ascii_lowercase()
            .contains("github.com/stalwartlabs/webui/")
}

pub fn is_stalwartlabs_github_url(url: &str) -> bool {
    let url = url.trim().to_ascii_lowercase();
    const HOSTS: [&str; 4] = [
        "://github.com/stalwartlabs/",
        "://raw.githubusercontent.com/stalwartlabs/",
        "://codeload.github.com/stalwartlabs/",
        "://api.github.com/repos/stalwartlabs/",
    ];
    HOSTS.iter().any(|host| url.contains(host))
}

pub async fn fetch_resource(
    url: &str,
    headers: Option<HeaderMap>,
    timeout: Duration,
    max_size: usize,
) -> Result<Vec<u8>, String> {
    let url = download_url(url)?;
    if let Some(path) = url.strip_prefix("file://") {
        tokio::fs::read(path)
            .await
            .map_err(|err| format!("Failed to read {path}: {err}"))
    } else {
        let response = reqwest::Client::builder()
            .timeout(timeout)
            .danger_accept_invalid_certs(is_localhost_url(url))
            .user_agent(USER_AGENT)
            .build()
            .unwrap_or_default()
            .get(url)
            .headers(headers.unwrap_or_default())
            .send()
            .await
            .map_err(|err| format!("Failed to fetch {url}: {err}"))?;

        if response.status().is_success() {
            response
                .bytes_with_limit(max_size)
                .await
                .map_err(|err| format!("Failed to fetch {url}: {err}"))
                .and_then(|bytes| bytes.ok_or_else(|| format!("Resource too large: {url}")))
        } else {
            let code = response.status().canonical_reason().unwrap_or_default();
            let reason = response.text().await.unwrap_or_default();

            Err(format!(
                "Failed to fetch {url}: Code: {code}, Details: {reason}",
            ))
        }
    }
    .and_then(|bytes| {
        if url.ends_with(".gz") || url.ends_with(".gzip") {
            BufReader::new(flate2::read::GzDecoder::new(&bytes[..]))
                .bytes()
                .collect::<Result<Vec<u8>, _>>()
                .map_err(|err| format!("Failed to decompress {url}: {err}"))
        } else {
            Ok(bytes)
        }
    })
}

#[cfg(test)]
mod download_url_tests {
    use super::{BEAROS_WEBUI_URL, STALWART_WEBUI_URL, download_url};

    #[test]
    fn webui_download_uses_bearos() {
        assert_eq!(download_url(STALWART_WEBUI_URL).unwrap(), BEAROS_WEBUI_URL);
        assert_eq!(
            download_url(
                "https://github.com/stalwartlabs/webui/releases/download/v2.0.2/webui.zip"
            )
            .unwrap(),
            BEAROS_WEBUI_URL
        );
        assert_eq!(
            download_url(
                "https://github.com/luoxiprovo/bearos-webui/releases/latest/download/webui.zip"
            )
            .unwrap(),
            BEAROS_WEBUI_URL
        );
    }

    #[test]
    fn other_stalwartlabs_github_downloads_are_refused() {
        let error = download_url(
            "https://github.com/stalwartlabs/spam-filter/archive/refs/heads/main.tar.gz",
        )
        .unwrap_err();
        assert!(error.contains("Refusing to download"));
    }

    #[test]
    fn local_and_other_urls_pass_through() {
        assert_eq!(
            download_url("file:///opt/bearmail/webui.zip").unwrap(),
            "file:///opt/bearmail/webui.zip"
        );
        assert_eq!(
            download_url("https://cdn.jsdelivr.net/npm/@ip-location-db/asn/asn-ipv4.csv").unwrap(),
            "https://cdn.jsdelivr.net/npm/@ip-location-db/asn/asn-ipv4.csv"
        );
    }
}

pub fn is_localhost_url(url: &str) -> bool {
    url.split_once("://")
        .map(|(_, url)| url.split_once('/').map_or(url, |(host, _)| host))
        .is_some_and(|host| {
            let host = host.rsplit_once(':').map_or(host, |(host, _)| host);
            host == "localhost" || host == "127.0.0.1" || host == "[::1]"
        })
}
