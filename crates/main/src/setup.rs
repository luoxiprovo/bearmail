/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

use common::{
    network::dns::records::{SETUP_DNS_TTL, SetupDnsRecord, build_setup_dns_table_records},
    psl,
};
use jmap::registry::mapping::bootstrap::apply_bootstrap;
use registry::schema::{
    enums::PasswordHashAlgorithm,
    prelude::ObjectImpl,
    structs::{Bootstrap, CertificateManagement},
};
use serde_json::Value;
use std::{
    env,
    ffi::OsString,
    io::{self, BufRead, Write},
    net::{Ipv4Addr, Ipv6Addr},
    path::PathBuf,
};
use store::RegistryStore;

#[cfg(test)]
use registry::schema::structs::{DataStore, DnsServerBootstrap, RocksDbStore, Tracer, TracerLog};

mod wizard;

use wizard::{WebSetupWizard, prompt_yes_no, read_line};

const SETUP_HELP: &str = r#"Usage: stalwart --config <PATH> --setup

Run the interactive initial setup without starting network services.

Quick setup asks only for the server hostname and mail domain. Advanced setup
exposes the same bootstrap fields and nested choices as the WebUI.

Installer-provided defaults:
  STALWART_SETUP_DATA_PATH  Initial path shown for a local data store
  STALWART_SETUP_LOG_PATH   Initial path shown for file logging
  STALWART_SETUP_PUBLIC_IPV4  Detected public IPv4 address
  STALWART_SETUP_PUBLIC_IPV6  Detected public IPv6 address
"#;

#[derive(Debug, PartialEq, Eq)]
struct SetupOptions {
    config_path: PathBuf,
    show_help: bool,
}

#[derive(Debug)]
struct SetupAnswers {
    bootstrap: Bootstrap,
    ipv4: Option<Ipv4Addr>,
    ipv6: Option<Ipv6Addr>,
}

pub fn is_requested() -> bool {
    env::args_os().skip(1).any(|arg| arg == "--setup")
}

pub async fn run() -> Result<(), String> {
    let options = parse_args(env::args_os())?;
    if options.show_help {
        print!("{SETUP_HELP}");
        return Ok(());
    }
    if options.config_path.exists() {
        return Err(format!(
            "Refusing to overwrite the existing configuration at {}",
            options.config_path.display()
        ));
    }
    if let Some(parent) = options.config_path.parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent).map_err(|err| {
            format!(
                "Failed to create the configuration directory {}: {err}",
                parent.display()
            )
        })?;
    }

    let bootstrap_registry = RegistryStore::init_for_setup(options.config_path.clone())
        .await
        .map_err(|err| format!("Failed to initialize setup: {err}"))?;
    let default_hostname = bootstrap_registry.local_hostname().to_string();
    let default_domain = psl::domain_str(&default_hostname)
        .unwrap_or("example.org")
        .to_string();

    let mut stdin = io::stdin().lock();
    let mut stdout = io::stdout().lock();
    writeln!(stdout, "Stalwart command-line setup")
        .and_then(|_| writeln!(stdout, "==========================="))
        .map_err(io_error)?;
    writeln!(
        stdout,
        concat!(
            "This wizard initializes Stalwart without starting network services.\n",
            "Every bootstrap choice available in the WebUI is available here.\n"
        )
    )
    .map_err(io_error)?;
    let answers = prompt_for_answers(&mut stdin, &mut stdout, &default_hostname, &default_domain)?;
    drop(stdin);
    drop(stdout);

    let server_hostname = answers.bootstrap.server_hostname.clone();
    let default_domain = answers.bootstrap.default_domain.clone();
    let request_tls_certificate = answers.bootstrap.request_tls_certificate;
    let dns_mode = object_variant(&answers.bootstrap.dns_server);
    let ipv4 = answers.ipv4;
    let ipv6 = answers.ipv6;

    let result = apply_bootstrap(
        &bootstrap_registry,
        answers.bootstrap,
        PasswordHashAlgorithm::Argon2id,
        true,
    )
    .await
    .map_err(|err| format!("Bootstrap failed: {err:?}"))?;
    let tls_configured = matches!(
        &result.domain.certificate_management,
        CertificateManagement::Automatic(_)
    );
    let dns_records = build_setup_dns_table_records(
        &server_hostname,
        &default_domain,
        &result.dkim_signatures,
        tls_configured,
    )
    .await
    .map_err(|err| format!("Failed to generate DNS records: {err}"))?;

    print_setup_result(
        ipv4,
        ipv6,
        &server_hostname,
        request_tls_certificate,
        &dns_mode,
        result.username.as_deref(),
        result.secret.as_deref(),
        &dns_records,
        tls_configured,
    )
    .map_err(io_error)
}

fn parse_args<I>(args: I) -> Result<SetupOptions, String>
where
    I: IntoIterator<Item = OsString>,
{
    parse_args_with_config(args, env::var_os("CONFIG_PATH").map(PathBuf::from))
}

fn parse_args_with_config<I>(
    args: I,
    mut config_path: Option<PathBuf>,
) -> Result<SetupOptions, String>
where
    I: IntoIterator<Item = OsString>,
{
    let mut show_help = false;
    let mut setup = false;
    let mut args = args.into_iter().skip(1);
    while let Some(arg) = args.next() {
        let arg = arg.to_string_lossy();
        match arg.as_ref() {
            "--setup" => setup = true,
            "--help" | "-h" => show_help = true,
            "--config" | "-c" => {
                let value = args
                    .next()
                    .ok_or_else(|| "Missing value for --config".to_string())?;
                config_path = Some(PathBuf::from(value));
            }
            value if value.starts_with("--config=") => {
                config_path = Some(PathBuf::from(&value["--config=".len()..]));
            }
            value if value.starts_with("-c=") => {
                config_path = Some(PathBuf::from(&value["-c=".len()..]));
            }
            value => return Err(format!("Unrecognized setup argument '{value}'")),
        }
    }
    if !setup && !show_help {
        return Err("Missing --setup argument".to_string());
    }
    if show_help {
        return Ok(SetupOptions {
            config_path: config_path.unwrap_or_default(),
            show_help: true,
        });
    }
    let config_path = config_path
        .filter(|path| !path.as_os_str().is_empty())
        .ok_or_else(|| "Missing --config argument for setup".to_string())?;
    Ok(SetupOptions {
        config_path,
        show_help: false,
    })
}

fn prompt_for_answers<R: BufRead, W: Write>(
    input: &mut R,
    output: &mut W,
    default_hostname: &str,
    default_domain: &str,
) -> Result<SetupAnswers, String> {
    let mut defaults = Bootstrap {
        server_hostname: default_hostname.to_string(),
        default_domain: default_domain.to_string(),
        ..Default::default()
    };
    if let Ok(path) = env::var("STALWART_SETUP_DATA_PATH")
        && let registry::schema::structs::DataStore::RocksDb(store) = &mut defaults.data_store
    {
        store.path = normalized_directory(path);
    }
    if let Ok(path) = env::var("STALWART_SETUP_LOG_PATH")
        && let registry::schema::structs::Tracer::Log(tracer) = &mut defaults.tracer
    {
        tracer.path = normalized_directory(path);
    }

    let mut current = serde_json::to_value(defaults)
        .map_err(|err| format!("Failed to prepare setup defaults: {err}"))?;
    let quick_setup = prompt_setup_mode(input, output)?;
    let mut ipv4 = env::var("STALWART_SETUP_PUBLIC_IPV4")
        .ok()
        .and_then(|value| value.trim().parse().ok());
    let mut ipv6 = env::var("STALWART_SETUP_PUBLIC_IPV6")
        .ok()
        .and_then(|value| value.trim().parse().ok());

    loop {
        current = {
            let mut wizard = WebSetupWizard::new(input, output)?;
            if quick_setup {
                wizard.configure_bootstrap_identity(current)?
            } else {
                wizard.configure_object("x:Bootstrap", current)?
            }
        };

        if !quick_setup {
            writeln!(output, "\n  Public address records").map_err(io_error)?;
            writeln!(
                output,
                "    Detected addresses are used only for the final A/AAAA/PTR checklist."
            )
            .map_err(io_error)?;
            ipv4 = prompt_ip(input, output, "Public IPv4 address", ipv4)?;
            ipv6 = prompt_ip(input, output, "Public IPv6 address", ipv6)?;
        }

        let bootstrap: Bootstrap = match serde_json::from_value(current.clone()) {
            Ok(bootstrap) => bootstrap,
            Err(err) => {
                writeln!(
                    output,
                    "\nThe selected values could not be converted to a bootstrap configuration: {err}"
                )
                .map_err(io_error)?;
                writeln!(output, "Please review the questionnaire again.").map_err(io_error)?;
                continue;
            }
        };
        let mut validation_errors = Vec::new();
        if !bootstrap.validate(&mut validation_errors) {
            writeln!(output, "\nThe configuration has validation errors:").map_err(io_error)?;
            for error in validation_errors {
                writeln!(output, "  - {error:?}").map_err(io_error)?;
            }
            writeln!(output, "Please review the questionnaire again.").map_err(io_error)?;
            continue;
        }

        print_summary(output, &bootstrap, ipv4, ipv6)?;
        if prompt_yes_no(input, output, "Apply this configuration", quick_setup)? {
            return Ok(SetupAnswers {
                bootstrap,
                ipv4,
                ipv6,
            });
        }
        if !prompt_yes_no(input, output, "Edit the answers", true)? {
            return Err("Setup cancelled; no configuration was written".to_string());
        }
        current = serde_json::to_value(bootstrap)
            .map_err(|err| format!("Failed to retain setup answers: {err}"))?;
    }
}

fn prompt_setup_mode<R: BufRead, W: Write>(input: &mut R, output: &mut W) -> Result<bool, String> {
    loop {
        writeln!(output, "Setup mode:").map_err(io_error)?;
        writeln!(
            output,
            "  1) Quick setup - ask for hostname and mail domain; keep all other defaults (default)"
        )
        .map_err(io_error)?;
        writeln!(
            output,
            "  2) Advanced setup - review every WebUI bootstrap option"
        )
        .map_err(io_error)?;
        write!(output, "Select Setup mode [1]: ")
            .and_then(|_| output.flush())
            .map_err(io_error)?;
        match read_line(input)?.trim() {
            "" | "1" => return Ok(true),
            "2" => return Ok(false),
            _ => writeln!(output, "  Choose 1 or 2.").map_err(io_error)?,
        }
    }
}

fn prompt_ip<R, W, T>(
    input: &mut R,
    output: &mut W,
    label: &str,
    current: Option<T>,
) -> Result<Option<T>, String>
where
    R: BufRead,
    W: Write,
    T: std::str::FromStr + std::fmt::Display + Copy,
{
    loop {
        match current {
            Some(value) => write!(output, "{label} [{value}]: "),
            None => write!(output, "{label} [optional]: "),
        }
        .and_then(|_| output.flush())
        .map_err(io_error)?;
        let value = read_line(input)?.trim().to_string();
        if value.is_empty() {
            return Ok(current);
        }
        if value == "-" {
            return Ok(None);
        }
        match value.parse::<T>() {
            Ok(value) => return Ok(Some(value)),
            Err(_) => {
                writeln!(output, "  Enter a valid address or leave it blank.").map_err(io_error)?
            }
        }
    }
}

fn print_summary<W: Write>(
    output: &mut W,
    bootstrap: &Bootstrap,
    ipv4: Option<Ipv4Addr>,
    ipv6: Option<Ipv6Addr>,
) -> Result<(), String> {
    writeln!(output, "\nSetup summary:").map_err(io_error)?;
    writeln!(output, "  Hostname: {}", bootstrap.server_hostname).map_err(io_error)?;
    writeln!(output, "  Mail domain: {}", bootstrap.default_domain).map_err(io_error)?;
    writeln!(
        output,
        "  Main data store: {}",
        object_variant(&bootstrap.data_store)
    )
    .map_err(io_error)?;
    writeln!(
        output,
        "  Blob store: {}",
        object_variant(&bootstrap.blob_store)
    )
    .map_err(io_error)?;
    writeln!(
        output,
        "  Search store: {}",
        object_variant(&bootstrap.search_store)
    )
    .map_err(io_error)?;
    writeln!(
        output,
        "  In-memory store: {}",
        object_variant(&bootstrap.in_memory_store)
    )
    .map_err(io_error)?;
    writeln!(
        output,
        "  Directory: {}",
        object_variant(&bootstrap.directory)
    )
    .map_err(io_error)?;
    writeln!(output, "  Logging: {}", object_variant(&bootstrap.tracer)).map_err(io_error)?;
    writeln!(
        output,
        "  DNS management: {}",
        object_variant(&bootstrap.dns_server)
    )
    .map_err(io_error)?;
    writeln!(
        output,
        "  Automatic TLS: {}",
        yes_no(bootstrap.request_tls_certificate)
    )
    .map_err(io_error)?;
    writeln!(
        output,
        "  Generate DKIM keys: {}",
        yes_no(bootstrap.generate_dkim_keys)
    )
    .map_err(io_error)?;
    writeln!(
        output,
        "  Public IPv4: {}",
        ipv4.map(|value| value.to_string())
            .unwrap_or_else(|| "not set".to_string())
    )
    .map_err(io_error)?;
    writeln!(
        output,
        "  Public IPv6: {}",
        ipv6.map(|value| value.to_string())
            .unwrap_or_else(|| "not set".to_string())
    )
    .map_err(io_error)
}

fn object_variant<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| {
            value
                .get("@type")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| "Unknown".to_string())
}

const fn yes_no(value: bool) -> &'static str {
    if value { "yes" } else { "no" }
}

fn print_setup_result(
    ipv4: Option<Ipv4Addr>,
    ipv6: Option<Ipv6Addr>,
    server_hostname: &str,
    request_tls_certificate: bool,
    dns_mode: &str,
    username: Option<&str>,
    secret: Option<&str>,
    dns_records: &[SetupDnsRecord],
    tls_configured: bool,
) -> io::Result<()> {
    let mut output = io::stdout().lock();
    writeln!(
        output,
        "\n════════════════════════════════════════════════════════════"
    )?;
    writeln!(output, "Stalwart setup is complete")?;
    if let (Some(username), Some(secret)) = (username, secret) {
        writeln!(output, "\nPermanent administrator credential (shown once):")?;
        writeln!(output, "  username: {username}")?;
        writeln!(output, "  password: {secret}")?;
    }
    if request_tls_certificate && !tls_configured {
        writeln!(
            output,
            "\nWarning: the TLS certificate account could not be created during setup."
        )?;
        writeln!(
            output,
            "Configure certificate management after startup before enabling public TLS."
        )?;
    }
    if matches!(dns_mode, "Manual" | "Deprecated1") {
        writeln!(output, "\nDNS records to add manually")?;
        writeln!(output, "---------------------------")?;
    } else {
        writeln!(output, "\nDNS records and expected managed zone")?;
        writeln!(output, "-------------------------------------")?;
    }

    let mut records = Vec::with_capacity(dns_records.len() + 4);
    records.push(SetupDnsRecord {
        record_type: "A".to_string(),
        host: server_hostname.trim_end_matches('.').to_string(),
        answer: ipv4
            .map(|ip| ip.to_string())
            .unwrap_or_else(|| "<PUBLIC_IPV4_NOT_DETECTED>".to_string()),
        ttl: SETUP_DNS_TTL,
        priority: None,
    });
    if let Some(ip) = ipv6 {
        records.push(SetupDnsRecord {
            record_type: "AAAA".to_string(),
            host: server_hostname.trim_end_matches('.').to_string(),
            answer: ip.to_string(),
            ttl: SETUP_DNS_TTL,
            priority: None,
        });
    }
    if let Some(ip) = ipv4 {
        records.push(SetupDnsRecord {
            record_type: "PTR".to_string(),
            host: ipv4_reverse_name(ip),
            answer: server_hostname.trim_end_matches('.').to_string(),
            ttl: SETUP_DNS_TTL,
            priority: None,
        });
    }
    if let Some(ip) = ipv6 {
        records.push(SetupDnsRecord {
            record_type: "PTR".to_string(),
            host: ipv6_reverse_name(ip),
            answer: server_hostname.trim_end_matches('.').to_string(),
            ttl: SETUP_DNS_TTL,
            priority: None,
        });
    }
    records.extend_from_slice(dns_records);
    print_dns_table(&mut output, &records)?;

    writeln!(
        output,
        "\nTTL values are seconds. PRIO is used by MX and SRV records."
    )?;
    writeln!(
        output,
        "Wrapped HOST or ANSWER lines continue the cell above; concatenate them without spaces."
    )?;
    if ipv4.is_none() {
        writeln!(
            output,
            "Warning: public IPv4 detection failed. Replace <PUBLIC_IPV4_NOT_DETECTED> before publishing."
        )?;
    }
    if ipv4.is_some() || ipv6.is_some() {
        writeln!(
            output,
            "PTR records must be configured by the provider that owns each public IP address."
        )?;
    }
    if matches!(dns_mode, "Manual" | "Deprecated1") {
        writeln!(
            output,
            "DNS management is manual. Stalwart did not contact or modify your DNS provider."
        )?;
    } else {
        writeln!(
            output,
            "Automatic DNS management is configured through {dns_mode}; verify its first update after startup."
        )?;
    }
    writeln!(
        output,
        "════════════════════════════════════════════════════════════"
    )?;
    Ok(())
}

fn print_dns_table<W: Write>(output: &mut W, records: &[SetupDnsRecord]) -> io::Result<()> {
    let type_width = records
        .iter()
        .map(|record| record.record_type.chars().count())
        .max()
        .unwrap_or(4)
        .max("TYPE".len());
    let host_width = records
        .iter()
        .map(|record| record.host.chars().count())
        .max()
        .unwrap_or(4)
        .max("HOST".len())
        .min(38);
    let answer_width = records
        .iter()
        .map(|record| record.answer.chars().count())
        .max()
        .unwrap_or(6)
        .max("ANSWER".len())
        .min(56);
    let ttl_width = records
        .iter()
        .map(|record| record.ttl.to_string().len())
        .max()
        .unwrap_or(3)
        .max("TTL".len());
    let priority_width = records
        .iter()
        .filter_map(|record| record.priority)
        .map(|priority| priority.to_string().len())
        .max()
        .unwrap_or(1)
        .max("PRIO".len());

    writeln!(
        output,
        "{:<type_width$} | {:<host_width$} | {:<answer_width$} | {:>ttl_width$} | {:>priority_width$}",
        "TYPE", "HOST", "ANSWER", "TTL", "PRIO"
    )?;
    writeln!(
        output,
        "{}-+-{}-+-{}-+-{}-+-{}",
        "-".repeat(type_width),
        "-".repeat(host_width),
        "-".repeat(answer_width),
        "-".repeat(ttl_width),
        "-".repeat(priority_width)
    )?;

    for record in records {
        let hosts = wrap_cell(&record.host, host_width);
        let answers = wrap_cell(&record.answer, answer_width);
        let line_count = hosts.len().max(answers.len());
        for index in 0..line_count {
            let record_type = if index == 0 {
                record.record_type.as_str()
            } else {
                ""
            };
            let host = hosts.get(index).map(String::as_str).unwrap_or("");
            let answer = answers.get(index).map(String::as_str).unwrap_or("");
            let ttl = if index == 0 {
                record.ttl.to_string()
            } else {
                String::new()
            };
            let priority = if index == 0 {
                record
                    .priority
                    .map(|priority| priority.to_string())
                    .unwrap_or_else(|| "-".to_string())
            } else {
                String::new()
            };
            writeln!(
                output,
                "{record_type:<type_width$} | {host:<host_width$} | {answer:<answer_width$} | {ttl:>ttl_width$} | {priority:>priority_width$}"
            )?;
        }
    }
    Ok(())
}

fn wrap_cell(value: &str, width: usize) -> Vec<String> {
    let chars = value.chars().collect::<Vec<_>>();
    if chars.is_empty() {
        return vec![String::new()];
    }
    chars
        .chunks(width.max(1))
        .map(|chunk| chunk.iter().collect())
        .collect()
}

fn ipv4_reverse_name(ip: Ipv4Addr) -> String {
    let octets = ip.octets();
    format!(
        "{}.{}.{}.{}.in-addr.arpa",
        octets[3], octets[2], octets[1], octets[0]
    )
}

fn ipv6_reverse_name(ip: Ipv6Addr) -> String {
    let mut name = String::with_capacity(72);
    for byte in ip.octets().iter().rev() {
        name.push(char::from_digit((byte & 0x0f) as u32, 16).unwrap());
        name.push('.');
        name.push(char::from_digit((byte >> 4) as u32, 16).unwrap());
        name.push('.');
    }
    name.push_str("ip6.arpa");
    name
}

fn normalized_directory(mut path: String) -> String {
    if !path.ends_with(std::path::MAIN_SEPARATOR) {
        path.push(std::path::MAIN_SEPARATOR);
    }
    path
}

fn io_error(error: io::Error) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use registry::schema::prelude::ObjectType;
    use std::io::Cursor;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn parses_setup_arguments() {
        let options = parse_args_with_config(
            [
                OsString::from("stalwart"),
                OsString::from("--config=/tmp/config.json"),
                OsString::from("--setup"),
            ],
            None,
        )
        .unwrap();
        assert_eq!(
            options,
            SetupOptions {
                config_path: PathBuf::from("/tmp/config.json"),
                show_help: false,
            }
        );
    }

    #[test]
    fn setup_requires_a_config_path() {
        let error = parse_args_with_config(
            [OsString::from("stalwart"), OsString::from("--setup")],
            None,
        )
        .unwrap_err();
        assert!(error.contains("Missing --config"));
    }

    #[test]
    fn setup_rejects_answers_as_arguments() {
        let error = parse_args_with_config(
            [
                OsString::from("stalwart"),
                OsString::from("--setup"),
                OsString::from("--config=/tmp/config.json"),
                OsString::from("--hostname=mail.example.test"),
            ],
            None,
        )
        .unwrap_err();
        assert!(error.contains("Unrecognized setup argument"));
    }

    #[test]
    fn yes_no_accepts_defaults_and_case_insensitive_answers() {
        for (input, default, expected) in [
            ("\n", true, true),
            ("\n", false, false),
            ("YES\n", false, true),
            ("n\n", true, false),
        ] {
            let mut input = Cursor::new(input.as_bytes());
            let mut output = Vec::new();
            assert_eq!(
                prompt_yes_no(&mut input, &mut output, "Continue", default).unwrap(),
                expected
            );
        }
    }

    #[test]
    fn setup_mode_defaults_to_quick_and_allows_advanced() {
        for (input, expected) in [("\n", true), ("1\n", true), ("2\n", false)] {
            let mut input = Cursor::new(input.as_bytes());
            let mut output = Vec::new();
            assert_eq!(
                prompt_setup_mode(&mut input, &mut output).unwrap(),
                expected
            );
        }
    }

    #[test]
    fn ip_prompts_reject_wrong_families_and_accept_empty() {
        let mut input = Cursor::new(b"2001:db8::1\n192.0.2.1\n".as_slice());
        let mut output = Vec::new();
        let value = prompt_ip::<_, _, Ipv4Addr>(&mut input, &mut output, "IPv4", None).unwrap();
        assert_eq!(value, Some(Ipv4Addr::new(192, 0, 2, 1)));
        assert!(String::from_utf8(output).unwrap().contains("valid address"));

        let mut input = Cursor::new(b"\n".as_slice());
        let mut output = Vec::new();
        assert_eq!(
            prompt_ip::<_, _, Ipv6Addr>(&mut input, &mut output, "IPv6", None).unwrap(),
            None
        );
    }

    #[test]
    fn eof_is_an_error() {
        let mut input = Cursor::new(Vec::<u8>::new());
        let mut output = Vec::new();
        assert!(prompt_yes_no(&mut input, &mut output, "Continue", true).is_err());
    }

    #[test]
    fn directories_gain_a_trailing_separator() {
        assert_eq!(
            normalized_directory("/tmp/stalwart".to_string()),
            format!("/tmp/stalwart{}", std::path::MAIN_SEPARATOR)
        );
        assert_eq!(
            normalized_directory(format!("/tmp/stalwart{}", std::path::MAIN_SEPARATOR)),
            format!("/tmp/stalwart{}", std::path::MAIN_SEPARATOR)
        );
    }

    #[tokio::test]
    async fn manual_dns_rows_contain_core_mail_records() {
        let records =
            build_setup_dns_table_records("mail.example.test", "example.test", &[], false)
                .await
                .unwrap();
        assert!(records.iter().any(|record| {
            record.record_type == "MX"
                && record.host == "example.test"
                && record.answer == "mail.example.test"
                && record.priority == Some(10)
        }));
        assert!(
            records
                .iter()
                .any(|record| record.answer == "v=spf1 mx -all")
        );
        assert!(
            records
                .iter()
                .any(|record| record.host == "_dmarc.example.test")
        );
        assert!(records.iter().any(|record| {
            record.host == "_ua-auto-config.example.test"
                && record.answer.starts_with("v=UAAC1; a=sha256; d=")
        }));
        assert!(records.iter().all(|record| record.ttl == SETUP_DNS_TTL));
        assert!(records.iter().all(|record| {
            !record.host.to_ascii_lowercase().contains("cloudflare")
                && !record.answer.to_ascii_lowercase().contains("cloudflare")
        }));
    }

    #[test]
    fn dns_table_has_aligned_requested_columns_and_wraps_long_answers() {
        let records = vec![SetupDnsRecord {
            record_type: "TXT".to_string(),
            host: "selector._domainkey.example.test".to_string(),
            answer: "x".repeat(100),
            ttl: 3600,
            priority: None,
        }];
        let mut output = Vec::new();
        print_dns_table(&mut output, &records).unwrap();
        let output = String::from_utf8(output).unwrap();
        let lines = output.lines().collect::<Vec<_>>();

        assert!(lines[0].contains("TYPE"));
        assert!(lines[0].contains("HOST"));
        assert!(lines[0].contains("ANSWER"));
        assert!(lines[0].contains("TTL"));
        assert!(lines[0].contains("PRIO"));
        assert!(lines.len() > 3, "long TXT answer was not wrapped");
        let separators = lines[0]
            .match_indices('|')
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        for line in lines.iter().skip(2) {
            assert_eq!(
                line.match_indices('|')
                    .map(|(index, _)| index)
                    .collect::<Vec<_>>(),
                separators
            );
        }
    }

    #[test]
    fn reverse_dns_names_are_correct() {
        assert_eq!(
            ipv4_reverse_name("192.0.2.4".parse().unwrap()),
            "4.2.0.192.in-addr.arpa"
        );
        assert_eq!(
            ipv6_reverse_name("2001:db8::1".parse().unwrap()),
            "1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa"
        );
    }

    #[tokio::test]
    async fn rebootstrap_with_another_config_does_not_mutate_the_store() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "stalwart-cli-rebootstrap-{}-{unique}",
            std::process::id()
        ));
        let first_config = root.join("first/config.json");
        let second_config = root.join("second/config.json");
        std::fs::create_dir_all(first_config.parent().unwrap()).unwrap();
        std::fs::create_dir_all(second_config.parent().unwrap()).unwrap();
        let data_path = normalized_directory(root.join("data").to_string_lossy().into_owned());
        let bootstrap = Bootstrap {
            server_hostname: "mail.rebootstrap.test".to_string(),
            default_domain: "rebootstrap.test".to_string(),
            request_tls_certificate: false,
            generate_dkim_keys: false,
            data_store: DataStore::RocksDb(RocksDbStore {
                path: data_path,
                ..Default::default()
            }),
            tracer: Tracer::Log(TracerLog {
                path: normalized_directory(root.join("logs").to_string_lossy().into_owned()),
                ..Default::default()
            }),
            dns_server: DnsServerBootstrap::Manual,
            ..Default::default()
        };

        let first_local = RegistryStore::init_for_setup(first_config.clone())
            .await
            .unwrap();
        let first_result = apply_bootstrap(
            &first_local,
            bootstrap.clone(),
            PasswordHashAlgorithm::Argon2id,
            true,
        )
        .await
        .unwrap();
        let object_types = [
            ObjectType::Account,
            ObjectType::Domain,
            ObjectType::SystemSettings,
            ObjectType::Tracer,
        ];
        let mut counts_before = Vec::new();
        for object_type in object_types {
            counts_before.push(
                first_result
                    .registry
                    .count_object(object_type)
                    .await
                    .unwrap(),
            );
        }
        drop(first_result);
        drop(first_local);

        let second_local = RegistryStore::init_for_setup(second_config.clone())
            .await
            .unwrap();
        let error = match apply_bootstrap(
            &second_local,
            bootstrap,
            PasswordHashAlgorithm::Argon2id,
            true,
        )
        .await
        {
            Err(error) => error,
            Ok(_) => panic!("rebootstrap unexpectedly succeeded"),
        };
        assert!(format!("{error:?}").contains("selected data store has already been initialized"));
        assert!(!second_config.exists());
        drop(second_local);

        let reopened = RegistryStore::init(first_config).await.unwrap();
        let mut counts_after = Vec::new();
        for object_type in object_types {
            counts_after.push(reopened.count_object(object_type).await.unwrap());
        }
        assert_eq!(counts_before, counts_after);
        drop(reopened);
        let _ = std::fs::remove_dir_all(root);
    }
}
