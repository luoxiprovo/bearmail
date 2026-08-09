/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

use common::{network::dns::records::build_setup_dns_records, psl};
use jmap::registry::mapping::bootstrap::apply_bootstrap;
use registry::schema::{
    enums::PasswordHashAlgorithm,
    structs::{
        Bootstrap, CertificateManagement, DataStore, DnsServerBootstrap, FoundationDbStore,
        RocksDbStore, Tracer, TracerLog,
    },
};
use std::{
    env,
    ffi::OsString,
    io::{self, BufRead, Write},
    net::{IpAddr, Ipv4Addr, Ipv6Addr},
    path::PathBuf,
};
use store::RegistryStore;
use utils::{DomainPart, is_valid_domain};

const SETUP_HELP: &str = r#"Usage: stalwart --config <PATH> --setup

Run the interactive initial setup without starting network services.

Setup environment variables:
  STALWART_SETUP_DATA_PATH  Data directory for the bundled RocksDB store
  STALWART_SETUP_LOG_PATH   Directory for Stalwart log files
  STALWART_SETUP_STORE      rocksdb (default) or foundationdb
"#;

#[derive(Debug, PartialEq, Eq)]
struct SetupOptions {
    config_path: PathBuf,
    show_help: bool,
}

#[derive(Debug)]
struct SetupAnswers {
    server_hostname: String,
    default_domain: String,
    ipv4: Option<Ipv4Addr>,
    ipv6: Option<Ipv6Addr>,
    request_tls_certificate: bool,
    generate_dkim_keys: bool,
    foundationdb_cluster_file: Option<String>,
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
    let store_kind = env::var("STALWART_SETUP_STORE")
        .unwrap_or_else(|_| "rocksdb".to_string())
        .to_ascii_lowercase();
    if store_kind != "rocksdb" && store_kind != "foundationdb" {
        return Err(format!(
            "Invalid STALWART_SETUP_STORE value '{store_kind}'; expected rocksdb or foundationdb"
        ));
    }

    let mut stdin = io::stdin().lock();
    let mut stdout = io::stdout().lock();
    writeln!(stdout, "Stalwart command-line setup")
        .and_then(|_| writeln!(stdout, "==========================="))
        .map_err(io_error)?;
    writeln!(
        stdout,
        "This wizard initializes Stalwart and prints DNS records for you to add manually.\n"
    )
    .map_err(io_error)?;
    let answers = prompt_for_answers(
        &mut stdin,
        &mut stdout,
        &default_hostname,
        &default_domain,
        store_kind == "foundationdb",
    )?;
    drop(stdin);
    drop(stdout);

    let data_path = normalized_directory(
        env::var("STALWART_SETUP_DATA_PATH").unwrap_or_else(|_| default_data_path().to_string()),
    );
    let log_path = normalized_directory(
        env::var("STALWART_SETUP_LOG_PATH").unwrap_or_else(|_| "/var/log/stalwart/".to_string()),
    );
    let data_store = if store_kind == "foundationdb" {
        DataStore::FoundationDb(FoundationDbStore {
            cluster_file: answers.foundationdb_cluster_file.clone(),
            ..Default::default()
        })
    } else {
        DataStore::RocksDb(RocksDbStore {
            path: data_path,
            ..Default::default()
        })
    };
    let bootstrap = Bootstrap {
        server_hostname: answers.server_hostname.clone(),
        default_domain: answers.default_domain.clone(),
        request_tls_certificate: answers.request_tls_certificate,
        generate_dkim_keys: answers.generate_dkim_keys,
        data_store,
        tracer: Tracer::Log(TracerLog {
            path: log_path,
            prefix: "stalwart".to_string(),
            ansi: true,
            enable: true,
            ..Default::default()
        }),
        dns_server: DnsServerBootstrap::Manual,
        ..Default::default()
    };

    let result = apply_bootstrap(
        &bootstrap_registry,
        bootstrap,
        PasswordHashAlgorithm::Argon2id,
        true,
    )
    .await
    .map_err(|err| format!("Bootstrap failed: {err:?}"))?;
    let tls_configured = matches!(
        &result.domain.certificate_management,
        CertificateManagement::Automatic(_)
    );
    let zone = build_setup_dns_records(
        &answers.server_hostname,
        &answers.default_domain,
        &result.dkim_signatures,
        tls_configured,
    )
    .await
    .map_err(|err| format!("Failed to generate DNS records: {err}"))?;

    print_setup_result(
        &answers,
        result.username.as_deref(),
        result.secret.as_deref(),
        &zone,
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
    foundationdb: bool,
) -> Result<SetupAnswers, String> {
    let server_hostname = prompt_domain(input, output, "Server hostname", Some(default_hostname))?;
    let default_domain = prompt_domain(input, output, "Primary mail domain", Some(default_domain))?;
    let ipv4 = prompt_ip::<R, W, Ipv4Addr>(input, output, "Public IPv4 address", "optional")?;
    let ipv6 = prompt_ip::<R, W, Ipv6Addr>(input, output, "Public IPv6 address", "optional")?;
    let request_tls_certificate = prompt_yes_no(
        input,
        output,
        "Request a TLS certificate from Let's Encrypt",
        true,
    )?;
    let generate_dkim_keys = prompt_yes_no(input, output, "Generate DKIM signing keys now", true)?;
    let foundationdb_cluster_file = if foundationdb {
        let value = prompt_text(
            input,
            output,
            "FoundationDB cluster file",
            Some(""),
            Some("system default"),
        )?;
        (!value.is_empty()).then_some(value)
    } else {
        None
    };

    writeln!(output, "\nSetup summary:").map_err(io_error)?;
    writeln!(output, "  Hostname: {server_hostname}").map_err(io_error)?;
    writeln!(output, "  Mail domain: {default_domain}").map_err(io_error)?;
    writeln!(
        output,
        "  DNS management: manual (this wizard will not modify DNS)"
    )
    .map_err(io_error)?;
    if !prompt_yes_no(input, output, "Apply this configuration", false)? {
        return Err("Setup cancelled; no configuration was written".to_string());
    }

    Ok(SetupAnswers {
        server_hostname,
        default_domain,
        ipv4,
        ipv6,
        request_tls_certificate,
        generate_dkim_keys,
        foundationdb_cluster_file,
    })
}

fn prompt_domain<R: BufRead, W: Write>(
    input: &mut R,
    output: &mut W,
    label: &str,
    default: Option<&str>,
) -> Result<String, String> {
    loop {
        let value = prompt_text(input, output, label, default, None)?;
        let normalized = value
            .trim()
            .to_lowercase()
            .to_ascii_domain()
            .map(|value| value.into_owned())
            .unwrap_or_default();
        if is_valid_domain(&normalized) {
            return Ok(normalized);
        }
        writeln!(output, "  Enter a valid fully-qualified domain name.").map_err(io_error)?;
    }
}

fn prompt_ip<R, W, T>(
    input: &mut R,
    output: &mut W,
    label: &str,
    hint: &str,
) -> Result<Option<T>, String>
where
    R: BufRead,
    W: Write,
    T: std::str::FromStr,
{
    loop {
        let value = prompt_text(input, output, label, Some(""), Some(hint))?;
        if value.is_empty() {
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

fn prompt_yes_no<R: BufRead, W: Write>(
    input: &mut R,
    output: &mut W,
    label: &str,
    default: bool,
) -> Result<bool, String> {
    loop {
        write!(
            output,
            "{label} [{}]: ",
            if default { "Y/n" } else { "y/N" }
        )
        .and_then(|_| output.flush())
        .map_err(io_error)?;
        let value = read_line(input)?;
        match value.trim().to_ascii_lowercase().as_str() {
            "" => return Ok(default),
            "y" | "yes" => return Ok(true),
            "n" | "no" => return Ok(false),
            _ => writeln!(output, "  Answer yes or no.").map_err(io_error)?,
        }
    }
}

fn prompt_text<R: BufRead, W: Write>(
    input: &mut R,
    output: &mut W,
    label: &str,
    default: Option<&str>,
    display_default: Option<&str>,
) -> Result<String, String> {
    loop {
        let shown_default = display_default.or(default).unwrap_or_default();
        if shown_default.is_empty() {
            write!(output, "{label}: ").map_err(io_error)?;
        } else {
            write!(output, "{label} [{shown_default}]: ").map_err(io_error)?;
        }
        output.flush().map_err(io_error)?;
        let value = read_line(input)?.trim().to_string();
        if !value.is_empty() {
            return Ok(value);
        }
        if let Some(default) = default {
            return Ok(default.to_string());
        }
        writeln!(output, "  A value is required.").map_err(io_error)?;
    }
}

fn read_line<R: BufRead>(input: &mut R) -> Result<String, String> {
    let mut value = String::new();
    match input.read_line(&mut value) {
        Ok(0) => Err("Setup input ended before the wizard completed".to_string()),
        Ok(_) => Ok(value),
        Err(err) => Err(format!("Failed to read setup input: {err}")),
    }
}

fn print_setup_result(
    answers: &SetupAnswers,
    username: Option<&str>,
    secret: Option<&str>,
    zone: &str,
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
    if answers.request_tls_certificate && !tls_configured {
        writeln!(
            output,
            "\nWarning: the TLS certificate account could not be created during setup."
        )?;
        writeln!(
            output,
            "Configure certificate management after startup before enabling public TLS."
        )?;
    }
    writeln!(output, "\nDNS records to add manually")?;
    writeln!(output, "---------------------------")?;
    writeln!(output, "; Replace every placeholder before publishing.")?;
    writeln!(
        output,
        "{}. IN A {}",
        answers.server_hostname,
        answers
            .ipv4
            .map(|ip| ip.to_string())
            .unwrap_or_else(|| "<YOUR_PUBLIC_IPV4>".to_string())
    )?;
    writeln!(
        output,
        "{}. IN AAAA {}",
        answers.server_hostname,
        answers
            .ipv6
            .map(|ip| ip.to_string())
            .unwrap_or_else(|| "<YOUR_PUBLIC_IPV6_OPTIONAL>".to_string())
    )?;
    if let Some(ip) = answers.ipv4.map(IpAddr::V4) {
        writeln!(
            output,
            "; PTR: ask your IP provider to point {ip} to {}.",
            answers.server_hostname
        )?;
    } else {
        writeln!(
            output,
            "; PTR: point your public IPv4 address to {} through your IP provider.",
            answers.server_hostname
        )?;
    }
    if let Some(ip) = answers.ipv6.map(IpAddr::V6) {
        writeln!(
            output,
            "; PTR: ask your IP provider to point {ip} to {}.",
            answers.server_hostname
        )?;
    }
    writeln!(output, "\n{zone}")?;
    writeln!(
        output,
        "All DNS changes are manual. Stalwart did not contact or modify your DNS provider."
    )?;
    writeln!(
        output,
        "════════════════════════════════════════════════════════════"
    )?;
    Ok(())
}

fn normalized_directory(mut path: String) -> String {
    if !path.ends_with(std::path::MAIN_SEPARATOR) {
        path.push(std::path::MAIN_SEPARATOR);
    }
    path
}

const fn default_data_path() -> &'static str {
    if cfg!(target_os = "freebsd") {
        "/var/db/stalwart/"
    } else {
        "/var/lib/stalwart/"
    }
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
    fn ip_prompts_reject_wrong_families_and_accept_empty() {
        let mut input = Cursor::new(b"2001:db8::1\n192.0.2.1\n".as_slice());
        let mut output = Vec::new();
        let value =
            prompt_ip::<_, _, Ipv4Addr>(&mut input, &mut output, "IPv4", "optional").unwrap();
        assert_eq!(value, Some(Ipv4Addr::new(192, 0, 2, 1)));
        assert!(String::from_utf8(output).unwrap().contains("valid address"));

        let mut input = Cursor::new(b"\n".as_slice());
        let mut output = Vec::new();
        assert_eq!(
            prompt_ip::<_, _, Ipv6Addr>(&mut input, &mut output, "IPv6", "optional").unwrap(),
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
    async fn manual_dns_zone_contains_core_mail_records() {
        let zone = build_setup_dns_records("mail.example.test", "example.test", &[], false)
            .await
            .unwrap();
        assert!(zone.contains("MX"));
        assert!(zone.contains("v=spf1 mx -all"));
        assert!(zone.contains("_dmarc.example.test."));
        assert!(zone.contains("ua-auto-config.example.test."));
        assert!(zone.contains("v=UAAC1; a=sha256; d="));
        assert!(!zone.to_ascii_lowercase().contains("cloudflare"));
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
