/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

use crate::registry::{
    mapping::{RegistryGetResponse, RegistrySetResponse, map_bootstrap_error},
    set::map_write_error,
};
use common::{
    DATABASE_SCHEMA_VERSION, Server,
    config::storage::Storage,
    network::{
        acme::account::acme_create_account,
        dkim::{generate_dkim_private_key, generate_dkim_selector},
    },
    psl,
};
use directory::core::secret::hash_secret;
use jmap_proto::{
    error::set::{SetError, SetErrorType},
    request::MaybeInvalid,
};
use jmap_tools::{JsonPointer, JsonPointerItem, Key};
use rand::{RngExt, distr::Alphanumeric, rng};
use registry::{
    jmap::{IntoValue, JmapValue, JsonPointerPatch, RegistryJsonPatch},
    schema::{
        enums::{
            AcmeChallengeType, DkimRotationStage, DkimSignatureType, DnsRecordType,
            PasswordHashAlgorithm,
        },
        prelude::{Object, Property},
        structs::{
            Account, AcmeProvider, BlobStore, Bootstrap, CertificateManagement,
            CertificateManagementProperties, Credential, DataStore, Directory, DirectoryBootstrap,
            Dkim1Signature, Dkim2Signature, DkimManagement, DkimManagementProperties,
            DkimSignature, DnsManagement, DnsManagementProperties, DnsServer, DnsServerBootstrap,
            Domain, InMemoryStore, PasswordCredential, RocksDbStore, SearchStore, SecretText,
            SecretTextValue, SystemSettings, Task, TaskDnsManagement, TaskDomainManagement,
            TaskStatus, Tracer, TracerLog, UserAccount, UserRoles,
        },
    },
    types::{ObjectImpl, datetime::UTCDateTime, list::List, map::Map},
};
use std::time::Duration;
use store::{
    IterateParams, RegistryStore, SUBSPACE_PROPERTY, SUBSPACE_REGISTRY, Store, U16_LEN, U64_LEN,
    ValueKey,
    registry::write::{RegistryWrite, RegistryWriteResult},
    write::{AnyClass, AnyKey, BatchBuilder, ValueClass},
};
use types::id::Id;
use utils::{DomainPart, is_valid_domain};

pub(crate) async fn bootstrap_get(
    mut get: RegistryGetResponse<'_>,
) -> trc::Result<RegistryGetResponse<'_>> {
    if !get.server.registry().is_bootstrap_mode() {
        get.not_found(Id::singleton());
        return Ok(get);
    }

    let mut ids = get
        .ids
        .take()
        .unwrap_or_else(|| vec![Id::singleton()])
        .into_iter();

    for id in ids.by_ref() {
        if id == Id::singleton() {
            get.insert(
                Id::singleton(),
                build_default_bootstrap(get.server).into_value(),
            );
            break;
        } else {
            get.not_found(id);
        }
    }

    get.response.not_found.extend(ids.map(MaybeInvalid::Value));
    Ok(get)
}

pub(crate) async fn bootstrap_set(
    mut set: RegistrySetResponse<'_>,
) -> trc::Result<RegistrySetResponse<'_>> {
    if !set.server.registry().is_bootstrap_mode() {
        set.fail_all_create("This operation is only allowed bootstrap mode");
        set.fail_all_update("This operation is only allowed bootstrap mode");
        set.fail_all_destroy("This operation is only allowed bootstrap mode");
        return Ok(set);
    }

    set.fail_all_create("Bootstrap objects can only be updated");
    set.fail_all_destroy("Bootstrap objects cannot be deleted");

    let mut bootstrap = build_default_bootstrap(set.server);

    'outer: for (id, value) in set.update.drain(..) {
        if id != Id::singleton() {
            set.response.not_updated.append(id, SetError::not_found());
            continue;
        }

        for (key, value) in value.into_expanded_object() {
            if let Key::Property(property) = key {
                let ptr = JsonPointer::new(vec![JsonPointerItem::Key(Key::Property(property))]);
                if let Err(err) =
                    bootstrap.patch(JsonPointerPatch::new(&ptr).with_create(false), value)
                {
                    set.response.not_updated.append(id, err.into());
                    break 'outer;
                }
            } else {
                set.response.not_updated.append(
                    id,
                    SetError::invalid_properties().with_property(key.into_owned()),
                );
                break 'outer;
            }
        }

        match apply_bootstrap(
            set.server.registry(),
            bootstrap,
            set.server.core.network.security.password_hash_algorithm,
            false,
        )
        .await
        {
            Ok(result) => {
                let response = result
                    .username
                    .zip(result.secret)
                    .map(|(username, secret)| {
                        JmapValue::Object(jmap_tools::Map::from_iter([
                            (
                                Key::Property(Property::Username),
                                JmapValue::Str(username.into()),
                            ),
                            (
                                Key::Property(Property::Secret),
                                JmapValue::Str(secret.into()),
                            ),
                        ]))
                    });
                set.response.updated.append(id, response);
            }
            Err(err) => set.response.not_updated.append(id, err),
        }
        break;
    }

    Ok(set)
}

/// Result of applying the one-time bootstrap configuration.
pub struct BootstrapResult {
    pub registry: RegistryStore,
    pub domain_id: Id,
    pub domain: Domain,
    pub username: Option<String>,
    pub secret: Option<String>,
    pub dkim_signatures: Vec<DkimSignature>,
}

/// Apply a validated bootstrap object without starting listeners. This is the
/// shared persistence path used by the interactive CLI setup.
pub async fn apply_bootstrap(
    bootstrap_registry: &RegistryStore,
    mut bootstrap: Bootstrap,
    password_hash_algorithm: PasswordHashAlgorithm,
    generate_dkim_now: bool,
) -> Result<BootstrapResult, SetError<Property>> {
    if !bootstrap_registry.is_bootstrap_mode() {
        return Err(SetError::new(SetErrorType::Forbidden)
            .with_description("This operation is only allowed in bootstrap mode"));
    }

    let mut validation_errors = Vec::new();
    if !bootstrap.validate(&mut validation_errors) {
        return Err(
            SetError::new(SetErrorType::ValidationFailed).with_validation_errors(validation_errors)
        );
    }

    let server_hostname = bootstrap
        .server_hostname
        .trim()
        .to_lowercase()
        .to_ascii_domain()
        .map(|hostname| hostname.into_owned())
        .unwrap_or_default();
    let domain_name = bootstrap
        .default_domain
        .trim()
        .to_lowercase()
        .to_ascii_domain()
        .map(|domain| domain.into_owned())
        .unwrap_or_default();
    if !is_valid_domain(&server_hostname) {
        return Err(SetError::invalid_properties()
            .with_property(Property::ServerHostname)
            .with_description("Invalid server hostname"));
    }
    if !is_valid_domain(&domain_name) {
        return Err(SetError::invalid_properties()
            .with_property(Property::DefaultDomain)
            .with_description("Invalid default domain"));
    }
    bootstrap.server_hostname = server_hostname.clone();
    bootstrap.default_domain = domain_name.clone();

    let store = Store::build(bootstrap.data_store.clone())
        .await
        .map_err(|err| {
            SetError::invalid_properties()
                .with_property(Property::DataStore)
                .with_description(err)
        })?;
    store.create_tables().await.map_err(|err| {
        SetError::invalid_properties()
            .with_property(Property::DataStore)
            .with_description(format!("Failed to initialize data store: {err}"))
    })?;

    let probe = store.get_value::<u32>(AnyKey {
        subspace: SUBSPACE_PROPERTY,
        key: vec![0u8],
    });
    match tokio::time::timeout(Duration::from_secs(30), probe).await {
        Ok(Ok(None)) => {}
        Ok(Ok(Some(DATABASE_SCHEMA_VERSION))) => {
            return Err(SetError::invalid_properties()
                .with_property(Property::DataStore)
                .with_description("The selected data store has already been initialized."));
        }
        Ok(Ok(Some(_))) => {
            return Err(SetError::invalid_properties()
                .with_property(Property::DataStore)
                .with_description(concat!(
                    "The selected data store contains information from an older version. ",
                    "Please follow the upgrade instructions at ",
                    "https://github.com/stalwartlabs/stalwart/blob/main/UPGRADING/v0_16.md"
                )));
        }
        Ok(Err(err)) => {
            trc::error!(err.caused_by(trc::location!()));
            return Err(SetError::invalid_properties()
                .with_property(Property::DataStore)
                .with_description("Failed to initialize data store, check logs for details."));
        }
        Err(_) => {
            return Err(SetError::invalid_properties()
                .with_property(Property::DataStore)
                .with_description(concat!(
                    "Timed out probing the data store after 30 seconds. ",
                    "Check that the backend is reachable."
                )));
        }
    }
    let mut has_registry_objects = false;
    store
        .iterate(
            IterateParams::new(
                ValueKey::from(ValueClass::Any(AnyClass {
                    subspace: SUBSPACE_REGISTRY,
                    key: Vec::new(),
                })),
                ValueKey::from(ValueClass::Any(AnyClass {
                    subspace: SUBSPACE_REGISTRY,
                    key: vec![u8::MAX; U16_LEN + U64_LEN],
                })),
            ),
            |_, _| {
                has_registry_objects = true;
                Ok(false)
            },
        )
        .await
        .map_err(|err| {
            trc::error!(err.caused_by(trc::location!()));
            SetError::invalid_properties()
                .with_property(Property::DataStore)
                .with_description("Failed to inspect the selected data store registry.")
        })?;
    if has_registry_objects {
        return Err(SetError::invalid_properties()
            .with_property(Property::DataStore)
            .with_description("The selected data store has already been initialized."));
    }

    for (property, object) in [
        (
            Property::BlobStore,
            Some(bootstrap.blob_store.clone().into()),
        ),
        (
            Property::SearchStore,
            Some(bootstrap.search_store.clone().into()),
        ),
        (
            Property::InMemoryStore,
            Some(bootstrap.in_memory_store.clone().into()),
        ),
        (
            Property::Directory,
            map_directory(&bootstrap.directory).map(Into::into),
        ),
        (
            Property::DnsServer,
            map_dns_server(&bootstrap.dns_server).map(Into::into),
        ),
        (Property::Tracer, Some(bootstrap.tracer.clone().into())),
    ] {
        if let Some(object) = object {
            write_object(bootstrap_registry, &object)
                .await
                .map_err(|err| err.with_property(property))?;
        }
    }
    let mut bp_check =
        store::registry::bootstrap::Bootstrap::new_uninitialized(bootstrap_registry.clone());
    let _ = Storage::parse(&mut bp_check).await;
    if !bp_check.errors.is_empty() {
        return Err(map_bootstrap_error(bp_check.errors));
    }

    let registry =
        RegistryStore::from_inner_bootstrapped(bootstrap_registry.initialize_inner(store));

    for (property, object) in [
        (Property::BlobStore, bootstrap.blob_store.into()),
        (Property::SearchStore, bootstrap.search_store.into()),
        (Property::InMemoryStore, bootstrap.in_memory_store.into()),
        (Property::Tracer, bootstrap.tracer.into()),
    ] {
        write_object(&registry, &object)
            .await
            .map_err(|err| err.with_property(property))?;
    }

    let directory_id = if let Some(directory) = map_directory(&bootstrap.directory) {
        Some(
            write_object(&registry, &directory.into())
                .await
                .map_err(|err| err.with_property(Property::Directory))?,
        )
    } else {
        None
    };
    let dns_server_id = if let Some(dns_server) = map_dns_server(&bootstrap.dns_server) {
        Some(
            write_object(&registry, &dns_server.into())
                .await
                .map_err(|err| err.with_property(Property::DnsServer))?,
        )
    } else {
        None
    };

    let mut acme_provider_id = None;
    if bootstrap.request_tls_certificate {
        let mut acme_provider = AcmeProvider {
            challenge_type: if dns_server_id.is_some() {
                AcmeChallengeType::Dns01
            } else {
                AcmeChallengeType::TlsAlpn01
            },
            contact: Map::new(vec![format!("postmaster@{domain_name}")]),
            #[cfg(not(feature = "dev_mode"))]
            directory: "https://acme-v02.api.letsencrypt.org/directory".to_string(),
            #[cfg(feature = "dev_mode")]
            directory: "https://localhost:14000/dir".to_string(),
            ..Default::default()
        };
        if let Err(err) = acme_create_account(&mut acme_provider, None).await {
            trc::error!(trc::ResourceEvent::Error.into_err().reason(err));
        } else {
            acme_provider_id = Some(
                write_object(&registry, &acme_provider.into())
                    .await
                    .map_err(|err| err.with_property(Property::DataStore))?,
            );
        }
    }

    let publish_records = Map::new(vec![
        DnsRecordType::Dkim,
        DnsRecordType::Spf,
        DnsRecordType::Dmarc,
        DnsRecordType::Srv,
        DnsRecordType::MtaSts,
        DnsRecordType::TlsRpt,
        DnsRecordType::AutoConfig,
        DnsRecordType::AutoConfigLegacy,
        DnsRecordType::AutoDiscover,
    ]);
    let domain = Domain {
        name: domain_name.clone(),
        is_enabled: true,
        certificate_management: if let Some(acme_provider_id) = acme_provider_id {
            CertificateManagement::Automatic(CertificateManagementProperties {
                acme_provider_id,
                subject_alternative_names: Default::default(),
            })
        } else {
            CertificateManagement::Manual
        },
        dkim_management: if bootstrap.generate_dkim_keys {
            DkimManagement::Automatic(DkimManagementProperties::default())
        } else {
            DkimManagement::Manual
        },
        dns_management: if let Some(dns_server_id) = dns_server_id {
            DnsManagement::Automatic(DnsManagementProperties {
                dns_server_id,
                origin: None,
                publish_records: publish_records.clone(),
            })
        } else {
            DnsManagement::Manual
        },
        directory_id,
        ..Default::default()
    };
    let domain_id = write_object(&registry, &domain.clone().into())
        .await
        .map_err(|err| err.with_property(Property::DefaultDomain))?;

    write_object(
        &registry,
        &SystemSettings {
            default_hostname: server_hostname.clone(),
            default_domain_id: domain_id,
            ..Default::default()
        }
        .into(),
    )
    .await
    .map_err(|err| err.with_property(Property::DefaultDomain))?;

    let mut dkim_signatures = Vec::new();
    let mut batch = BatchBuilder::new();
    if dns_server_id.is_some() {
        batch.schedule_task(Task::DnsManagement(TaskDnsManagement {
            domain_id,
            update_records: publish_records,
            on_success_renew_certificate: acme_provider_id.is_some(),
            status: TaskStatus::now(),
        }));
    } else if acme_provider_id.is_some() {
        batch.schedule_task(Task::AcmeRenewal(TaskDomainManagement {
            domain_id,
            status: TaskStatus::now(),
        }));
    }
    if bootstrap.generate_dkim_keys {
        if generate_dkim_now {
            let DkimManagement::Automatic(dkim) = &domain.dkim_management else {
                unreachable!();
            };
            // Manual DNS cannot safely rotate keys without the operator
            // publishing the replacement record first. Automatic DNS setups
            // retain the normal rotation schedule.
            let next_transition = dns_server_id.map(|_| {
                UTCDateTime::from_timestamp(
                    UTCDateTime::now().timestamp() + dkim.rotate_after.as_secs() as i64,
                )
            });
            for &algorithm in dkim.algorithms.iter() {
                let secret = generate_dkim_private_key(algorithm)
                    .await
                    .map_err(|err| {
                        SetError::invalid_properties()
                            .with_property(Property::GenerateDkimKeys)
                            .with_description(err.to_string())
                    })?
                    .map_err(|err| {
                        SetError::invalid_properties()
                            .with_property(Property::GenerateDkimKeys)
                            .with_description(err)
                    })?;
                let selector =
                    generate_dkim_selector(&dkim.selector_template, algorithm).map_err(|err| {
                        SetError::invalid_properties()
                            .with_property(Property::GenerateDkimKeys)
                            .with_description(err)
                    })?;
                let private_key = SecretText::Text(SecretTextValue { secret });
                let signature = match algorithm {
                    DkimSignatureType::Dkim1Ed25519Sha256 | DkimSignatureType::Dkim1RsaSha256 => {
                        let signature = Dkim1Signature {
                            stage: DkimRotationStage::Active,
                            domain_id,
                            selector,
                            private_key,
                            next_transition_at: next_transition,
                            ..Default::default()
                        };
                        if algorithm == DkimSignatureType::Dkim1Ed25519Sha256 {
                            DkimSignature::Dkim1Ed25519Sha256(signature)
                        } else {
                            DkimSignature::Dkim1RsaSha256(signature)
                        }
                    }
                    DkimSignatureType::Dkim2Ed25519Sha256 | DkimSignatureType::Dkim2RsaSha256 => {
                        let signature = Dkim2Signature {
                            stage: DkimRotationStage::Active,
                            domain_id,
                            selector,
                            private_key,
                            next_transition_at: next_transition,
                            ..Default::default()
                        };
                        if algorithm == DkimSignatureType::Dkim2Ed25519Sha256 {
                            DkimSignature::Dkim2Ed25519Sha256(signature)
                        } else {
                            DkimSignature::Dkim2RsaSha256(signature)
                        }
                    }
                };
                write_object(&registry, &signature.clone().into())
                    .await
                    .map_err(|err| err.with_property(Property::GenerateDkimKeys))?;
                dkim_signatures.push(signature);
            }
            if let Some(next_transition) = next_transition {
                batch.schedule_task(Task::DkimManagement(TaskDomainManagement {
                    domain_id,
                    status: TaskStatus::at(next_transition.timestamp()),
                }));
            }
        } else {
            batch.schedule_task(Task::DkimManagement(TaskDomainManagement {
                domain_id,
                status: TaskStatus::now(),
            }));
        }
    }
    if !batch.is_empty()
        && let Err(err) = registry.store().write(batch.build_all()).await
    {
        trc::error!(err.caused_by(trc::location!()));
    }

    let (username, secret) = if directory_id.is_none() {
        let secret = rng()
            .sample_iter(Alphanumeric)
            .take(16)
            .map(char::from)
            .collect::<String>();
        write_object(
            &registry,
            &Account::User(UserAccount {
                name: "admin".to_string(),
                domain_id,
                credentials: List::from_iter([Credential::Password(PasswordCredential {
                    credential_id: Id::new(0),
                    secret: hash_secret(password_hash_algorithm, secret.clone().into_bytes())
                        .await
                        .unwrap_or_default(),
                    ..Default::default()
                })]),
                roles: UserRoles::Admin,
                description: "System administrator".to_string().into(),
                ..Default::default()
            })
            .into(),
        )
        .await
        .map_err(|err| err.with_property(Property::DefaultDomain))?;
        (Some(format!("admin@{domain_name}")), Some(secret))
    } else {
        (None, None)
    };

    registry
        .write_data_store(&bootstrap.data_store)
        .await
        .map_err(|err| {
            let details = format!("Failed to save data store settings: {err}");
            trc::error!(err.caused_by(trc::location!()));
            SetError::invalid_properties()
                .with_property(Property::DataStore)
                .with_description(details)
        })?;

    Ok(BootstrapResult {
        registry,
        domain_id,
        domain,
        username,
        secret,
        dkim_signatures,
    })
}

async fn write_object(registry: &RegistryStore, object: &Object) -> Result<Id, SetError<Property>> {
    match registry.write(RegistryWrite::insert(object)).await {
        Ok(RegistryWriteResult::Success(id)) => Ok(id),
        Ok(err) => Err(map_write_error(err)),
        Err(err) => {
            let details = format!("Failed to save settings: {err}");
            trc::error!(err.caused_by(trc::location!()));
            Err(SetError::invalid_properties().with_description(details))
        }
    }
}

fn map_directory(directory: &DirectoryBootstrap) -> Option<Directory> {
    match directory {
        DirectoryBootstrap::Internal => None,
        DirectoryBootstrap::Ldap(ldap_directory) => Directory::Ldap(ldap_directory.clone()).into(),
        DirectoryBootstrap::Sql(sql_directory) => Directory::Sql(sql_directory.clone()).into(),
        DirectoryBootstrap::Oidc(oidc_directory) => Directory::Oidc(oidc_directory.clone()).into(),
    }
}

fn map_dns_server(dns_server: &DnsServerBootstrap) -> Option<registry::schema::structs::DnsServer> {
    match dns_server {
        DnsServerBootstrap::Manual | DnsServerBootstrap::Deprecated1 => None,
        DnsServerBootstrap::Tsig(dns_server_tsig) => {
            DnsServer::Tsig(dns_server_tsig.clone()).into()
        }
        DnsServerBootstrap::Cloudflare(dns_server_cloudflare) => {
            DnsServer::Cloudflare(dns_server_cloudflare.clone()).into()
        }
        DnsServerBootstrap::DigitalOcean(dns_server_cloud) => {
            DnsServer::DigitalOcean(dns_server_cloud.clone()).into()
        }
        DnsServerBootstrap::DeSEC(dns_server_cloud) => {
            DnsServer::DeSEC(dns_server_cloud.clone()).into()
        }
        DnsServerBootstrap::Ovh(dns_server_ovh) => DnsServer::Ovh(dns_server_ovh.clone()).into(),
        DnsServerBootstrap::Bunny(dns_server_cloud) => {
            DnsServer::Bunny(dns_server_cloud.clone()).into()
        }
        DnsServerBootstrap::Porkbun(dns_server_porkbun) => {
            DnsServer::Porkbun(dns_server_porkbun.clone()).into()
        }
        DnsServerBootstrap::Dnsimple(dns_server_dnsimple) => {
            DnsServer::Dnsimple(dns_server_dnsimple.clone()).into()
        }
        DnsServerBootstrap::Spaceship(dns_server_spaceship) => {
            DnsServer::Spaceship(dns_server_spaceship.clone()).into()
        }
        DnsServerBootstrap::Route53(dns_server_route53) => {
            DnsServer::Route53(dns_server_route53.clone()).into()
        }
        DnsServerBootstrap::GoogleCloudDns(dns_server_google_cloud_dns) => {
            DnsServer::GoogleCloudDns(dns_server_google_cloud_dns.clone()).into()
        }
        DnsServerBootstrap::Alidns(inner) => DnsServer::Alidns(inner.clone()).into(),
        DnsServerBootstrap::ArvanCloud(inner) => DnsServer::ArvanCloud(inner.clone()).into(),
        DnsServerBootstrap::Autodns(inner) => DnsServer::Autodns(inner.clone()).into(),
        DnsServerBootstrap::AzureDns(inner) => DnsServer::AzureDns(inner.clone()).into(),
        DnsServerBootstrap::BaiduCloud(inner) => DnsServer::BaiduCloud(inner.clone()).into(),
        DnsServerBootstrap::BluecatV2(inner) => DnsServer::BluecatV2(inner.clone()).into(),
        DnsServerBootstrap::ClouDns(inner) => DnsServer::ClouDns(inner.clone()).into(),
        DnsServerBootstrap::Constellix(inner) => DnsServer::Constellix(inner.clone()).into(),
        DnsServerBootstrap::Cpanel(inner) => DnsServer::Cpanel(inner.clone()).into(),
        DnsServerBootstrap::Ddnss(inner) => DnsServer::Ddnss(inner.clone()).into(),
        DnsServerBootstrap::DnsMadeEasy(inner) => DnsServer::DnsMadeEasy(inner.clone()).into(),
        DnsServerBootstrap::Domeneshop(inner) => DnsServer::Domeneshop(inner.clone()).into(),
        DnsServerBootstrap::Dreamhost(inner) => DnsServer::Dreamhost(inner.clone()).into(),
        DnsServerBootstrap::DuckDns(inner) => DnsServer::DuckDns(inner.clone()).into(),
        DnsServerBootstrap::Dynu(inner) => DnsServer::Dynu(inner.clone()).into(),
        DnsServerBootstrap::EasyDns(inner) => DnsServer::EasyDns(inner.clone()).into(),
        DnsServerBootstrap::EdgeDns(inner) => DnsServer::EdgeDns(inner.clone()).into(),
        DnsServerBootstrap::Exoscale(inner) => DnsServer::Exoscale(inner.clone()).into(),
        DnsServerBootstrap::FreeMyIp(inner) => DnsServer::FreeMyIp(inner.clone()).into(),
        DnsServerBootstrap::GandiV5(inner) => DnsServer::GandiV5(inner.clone()).into(),
        DnsServerBootstrap::Gcore(inner) => DnsServer::Gcore(inner.clone()).into(),
        DnsServerBootstrap::Glesys(inner) => DnsServer::Glesys(inner.clone()).into(),
        DnsServerBootstrap::Godaddy(inner) => DnsServer::Godaddy(inner.clone()).into(),
        DnsServerBootstrap::Hetzner(inner) => DnsServer::Hetzner(inner.clone()).into(),
        DnsServerBootstrap::HostingDe(inner) => DnsServer::HostingDe(inner.clone()).into(),
        DnsServerBootstrap::Hostinger(inner) => DnsServer::Hostinger(inner.clone()).into(),
        DnsServerBootstrap::HuaweiCloud(inner) => DnsServer::HuaweiCloud(inner.clone()).into(),
        DnsServerBootstrap::Hurricane(inner) => DnsServer::Hurricane(inner.clone()).into(),
        DnsServerBootstrap::IbmCloud(inner) => DnsServer::IbmCloud(inner.clone()).into(),
        DnsServerBootstrap::Infoblox(inner) => DnsServer::Infoblox(inner.clone()).into(),
        DnsServerBootstrap::Infomaniak(inner) => DnsServer::Infomaniak(inner.clone()).into(),
        DnsServerBootstrap::Inwx(inner) => DnsServer::Inwx(inner.clone()).into(),
        DnsServerBootstrap::Ionos(inner) => DnsServer::Ionos(inner.clone()).into(),
        DnsServerBootstrap::Ipv64(inner) => DnsServer::Ipv64(inner.clone()).into(),
        DnsServerBootstrap::Joker(inner) => DnsServer::Joker(inner.clone()).into(),
        DnsServerBootstrap::Lightsail(inner) => DnsServer::Lightsail(inner.clone()).into(),
        DnsServerBootstrap::Linode(inner) => DnsServer::Linode(inner.clone()).into(),
        DnsServerBootstrap::LuaDns(inner) => DnsServer::LuaDns(inner.clone()).into(),
        DnsServerBootstrap::MythicBeasts(inner) => DnsServer::MythicBeasts(inner.clone()).into(),
        DnsServerBootstrap::Namecheap(inner) => DnsServer::Namecheap(inner.clone()).into(),
        DnsServerBootstrap::NameDotCom(inner) => DnsServer::NameDotCom(inner.clone()).into(),
        DnsServerBootstrap::NameSilo(inner) => DnsServer::NameSilo(inner.clone()).into(),
        DnsServerBootstrap::Netcup(inner) => DnsServer::Netcup(inner.clone()).into(),
        DnsServerBootstrap::Netlify(inner) => DnsServer::Netlify(inner.clone()).into(),
        DnsServerBootstrap::Nifcloud(inner) => DnsServer::Nifcloud(inner.clone()).into(),
        DnsServerBootstrap::Ns1(inner) => DnsServer::Ns1(inner.clone()).into(),
        DnsServerBootstrap::OracleCloud(inner) => DnsServer::OracleCloud(inner.clone()).into(),
        DnsServerBootstrap::Plesk(inner) => DnsServer::Plesk(inner.clone()).into(),
        DnsServerBootstrap::Safedns(inner) => DnsServer::Safedns(inner.clone()).into(),
        DnsServerBootstrap::Scaleway(inner) => DnsServer::Scaleway(inner.clone()).into(),
        DnsServerBootstrap::TencentCloud(inner) => DnsServer::TencentCloud(inner.clone()).into(),
        DnsServerBootstrap::Transip(inner) => DnsServer::Transip(inner.clone()).into(),
        DnsServerBootstrap::UltraDns(inner) => DnsServer::UltraDns(inner.clone()).into(),
        DnsServerBootstrap::Vercel(inner) => DnsServer::Vercel(inner.clone()).into(),
        DnsServerBootstrap::Volcengine(inner) => DnsServer::Volcengine(inner.clone()).into(),
        DnsServerBootstrap::Vultr(inner) => DnsServer::Vultr(inner.clone()).into(),
        DnsServerBootstrap::WebSupport(inner) => DnsServer::WebSupport(inner.clone()).into(),
        DnsServerBootstrap::YandexCloud(inner) => DnsServer::YandexCloud(inner.clone()).into(),
    }
}

// FreeBSD keeps variable application data under /var/db (hier(7))
// rather than FHS /var/lib.
const DEFAULT_DATA_PATH: &str = if cfg!(target_os = "freebsd") {
    "/var/db/stalwart/"
} else {
    "/var/lib/stalwart/"
};

fn build_default_bootstrap(server: &Server) -> Bootstrap {
    let server_hostname = server.registry().local_hostname().to_string();
    let default_domain = psl::domain_str(&server_hostname)
        .unwrap_or("example.org")
        .to_string();

    Bootstrap {
        data_store: DataStore::RocksDb(RocksDbStore {
            path: DEFAULT_DATA_PATH.to_string(),
            ..Default::default()
        }),
        blob_store: BlobStore::Default,
        search_store: SearchStore::Default,
        in_memory_store: InMemoryStore::Default,
        directory: DirectoryBootstrap::Internal,
        tracer: Tracer::Log(TracerLog {
            path: "/var/log/stalwart/".to_string(),
            prefix: "stalwart".to_string(),
            ansi: true,
            enable: true,
            ..Default::default()
        }),
        server_hostname,
        default_domain,
        request_tls_certificate: true,
        generate_dkim_keys: true,
        dns_server: DnsServerBootstrap::Manual,
    }
}
