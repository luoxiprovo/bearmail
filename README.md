<p align="center">
    <a href="https://stalw.art">
    <img src="./img/logo-red.svg" height="150">
    </a>
</p>

<h3 align="center">
  Secure, scalable mail & collaboration server with comprehensive protocol support 🛡️ <br/>(IMAP, JMAP, SMTP, CalDAV, CardDAV, WebDAV)
</h3>

<br>

<p align="center">
  <a href="https://github.com/stalwartlabs/stalwart/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/stalwartlabs/stalwart/ci.yml?style=flat-square" alt="continuous integration"></a>
  &nbsp;
  <a href="https://www.gnu.org/licenses/agpl-3.0"><img src="https://img.shields.io/badge/License-AGPL_v3-blue.svg?label=license&style=flat-square" alt="License: AGPL v3"></a>
  &nbsp;
  <a href="https://stalw.art/docs/install/get-started"><img src="https://img.shields.io/badge/read_the-docs-red?style=flat-square" alt="Documentation"></a>
</p>
<p align="center">
  <a href="https://mastodon.social/@stalwartlabs"><img src="https://img.shields.io/mastodon/follow/109929667531941122?style=flat-square&logo=mastodon&color=%236364ff&label=Follow%20on%20Mastodon" alt="Mastodon"></a>
  &nbsp;
  <a href="https://twitter.com/stalwartlabs"><img src="https://img.shields.io/twitter/follow/stalwartlabs?style=flat-square&logo=x&label=Follow%20on%20Twitter" alt="Twitter"></a>
</p>
<p align="center">
  <a href="https://discord.com/servers/stalwart-923615863037390889"><img src="https://img.shields.io/discord/923615863037390889?label=Join%20Discord&logo=discord&style=flat-square" alt="Discord"></a>
  &nbsp;
  <a href="https://www.reddit.com/r/stalwartlabs/"><img src="https://img.shields.io/reddit/subreddit-subscribers/stalwartlabs?label=Join%20%2Fr%2Fstalwartlabs&logo=reddit&style=flat-square" alt="Reddit"></a>
</p>

## Features

**Stalwart** is an open-source mail & collaboration server with JMAP, IMAP4, POP3, SMTP, CalDAV, CardDAV and WebDAV support and a wide range of modern features. It is written in Rust and designed to be secure, fast, robust and scalable.

Key features:

- **Email** server with complete protocol support:
  - JMAP: 
    * [JMAP for Mail](https://datatracker.ietf.org/doc/html/rfc8621) server.
    * [JMAP for Sieve Scripts](https://www.ietf.org/archive/id/draft-ietf-jmap-sieve-22.html).
    * [WebSocket](https://datatracker.ietf.org/doc/html/rfc8887), [Blob Management](https://www.rfc-editor.org/rfc/rfc9404.html) and [Quotas](https://www.rfc-editor.org/rfc/rfc9425.html) extensions.
  - IMAP:
    * [IMAP4rev2](https://datatracker.ietf.org/doc/html/rfc9051) and [IMAP4rev1](https://datatracker.ietf.org/doc/html/rfc3501) server.
    * [ManageSieve](https://datatracker.ietf.org/doc/html/rfc5804) server.
    * Numerous [extensions](https://stalw.art/docs/development/rfcs#imap4-and-extensions) supported.
  - POP3:
    - [POP3](https://datatracker.ietf.org/doc/html/rfc1939) server.
    - [STLS](https://datatracker.ietf.org/doc/html/rfc2595) and [SASL](https://datatracker.ietf.org/doc/html/rfc5034) support as well as other [extensions](https://datatracker.ietf.org/doc/html/rfc2449).
  - SMTP:
    * SMTP server with built-in [DMARC](https://datatracker.ietf.org/doc/html/rfc7489), [DKIMv2](https://datatracker.ietf.org/doc/draft-ietf-dkim-dkim2-spec/), [DKIMv1](https://datatracker.ietf.org/doc/html/rfc6376), [SPF](https://datatracker.ietf.org/doc/html/rfc7208) and [ARC](https://datatracker.ietf.org/doc/html/rfc8617) support for message authentication.
    * Strong transport security through [DANE](https://datatracker.ietf.org/doc/html/rfc6698), [MTA-STS](https://datatracker.ietf.org/doc/html/rfc8461) and [SMTP TLS](https://datatracker.ietf.org/doc/html/rfc8460) reporting.
    * Automated DKIM key rotation and management.
    * Inbound throttling and filtering with granular configuration rules, sieve scripting, MTA hooks and milter integration.
    * Distributed virtual queues with delayed delivery, priority delivery, quotas, routing rules and throttling support.
    * Envelope rewriting and message modification.
- **Collaboration** server:
  - Calendaring and scheduling:
    - [CalDAV](https://datatracker.ietf.org/doc/html/rfc4791) and [CalDAV Scheduling](https://datatracker.ietf.org/doc/html/rfc6638) support.
    - [JMAP for Calendars](https://datatracker.ietf.org/doc/html/draft-ietf-jmap-calendars-24) support.
  - Contact management:
    - [CardDAV](https://datatracker.ietf.org/doc/html/rfc6352) support.
    - [JMAP for Contacts](https://datatracker.ietf.org/doc/html/rfc9610) support.
  - File storage:
    - [WebDAV](https://datatracker.ietf.org/doc/html/rfc4918) support.
    - [JMAP for File Storage](https://datatracker.ietf.org/doc/html/draft-ietf-jmap-filenode-03) support.
  - Sharing with fine-grained access controls:
    - [WebDAV ACL](https://datatracker.ietf.org/doc/html/rfc3744) support.
    - [JMAP Sharing](https://datatracker.ietf.org/doc/html/rfc9670) support.
- **Spam** and **Phishing** built-in filter:
  - Comprehensive set of filtering **rules** on par with popular solutions.
  - LLM-driven spam filtering and message analysis.
  - Statistical **spam classifier** with collaborative filtering, automatic training capabilities and address book integration.
  - DNS Blocklists (**DNSBLs**) checking of IP addresses, domains, and hashes.
  - Collaborative digest-based spam filtering with **Pyzor**.
  - **Phishing** protection against homographic URL attacks, sender spoofing and other techniques.
  - Trusted **reply** tracking to recognize and prioritize genuine e-mail replies.
  - Sender **reputation** monitoring by IP address, ASN, domain and email address.
  - **Greylisting** to temporarily defer unknown senders.
  - **Spam traps** to set up decoy email addresses that catch and analyze spam.
- **Flexible**:
  - Pluggable storage backends with **RocksDB**, **FoundationDB**, **PostgreSQL**, **mySQL**, **SQLite**, **S3-Compatible**, **Azure** and **Redis** support.
  - Full-text search available in 17 languages using the built-in search engine or via **Meilisearch**, **ElasticSearch**, **OpenSearch**, **PostgreSQL** or **mySQL** backends.
  - Sieve scripting language with support for all [registered extensions](https://www.iana.org/assignments/sieve-extensions/sieve-extensions.xhtml).
  - Email aliases, mailing lists, subaddressing and catch-all addresses support.
  - Automated DNS management.
  - Automatic account configuration and discovery with [autoconfig](https://www.ietf.org/id/draft-bucksch-autoconfig-02.html) and [autodiscover](https://learn.microsoft.com/en-us/exchange/architecture/client-access/autodiscover?view=exchserver-2019). 
  - Multi-tenancy support with domain and tenant isolation.
  - Disk quotas per user and tenant.
- **Secure and robust**:
  - Encryption at rest with **S/MIME** or **OpenPGP**.
  - Automatic TLS certificate provisioning with [ACME](https://datatracker.ietf.org/doc/html/rfc8555) using `TLS-ALPN-01`, `DNS-01`, `DNS-PERSIST-01` or `HTTP-01` challenges.
  - Automated blocking of IP addresses that attack, abuse or scan the server for exploits.
  - Rate limiting.
  - Security audited (read the [report](https://stalw.art/blog/security-audit)).
  - Memory safe (thanks to Rust).
- **Scalable and fault-tolerant**:
  - Designed to handle growth seamlessly, from small setups to large-scale deployments of thousands of nodes.
  - Built with **fault tolerance** and **high availability** in mind, recovers from hardware or software failures with minimal operational impact. 
  - Peer-to-peer cluster coordination or with **Kafka**, **Redpanda**, **NATS** or **Redis**.
  - **Kubernetes**, **Apache Mesos** and **Docker Swarm** support for automated scaling and container orchestration.
  - Read replicas, sharded blob storage and in-memory data stores for high performance and low latency.
- **Authentication and Authorization**:
  - **OpenID Connect** authentication.
  - OAuth 2.0 authorization with [authorization code](https://www.rfc-editor.org/rfc/rfc8628) and [device authorization](https://www.rfc-editor.org/rfc/rfc8628) flows.
  - **LDAP**, **OIDC**, **SQL** or built-in authentication backend support.
  - Two-factor authentication with Time-based One-Time Passwords (`2FA-TOTP`) 
  - Application passwords (App Passwords).
  - Roles and permissions.
  - Access Control Lists (ACLs).
- **Observability**:
  - Logging and tracing with **OpenTelemetry**, journald, log files and console support.
  - Metrics with **OpenTelemetry** and **Prometheus** integration.
  - Webhooks for event-driven automation.
  - Alerts with email and webhook notifications.
  - Live tracing and metrics.
- **Web-based administration**:
  - Dashboard with real-time statistics and monitoring.
  - Account, domain, group and mailing list management.
  - SMTP queue management for messages and outbound DMARC and TLS reports.
  - Report visualization interface for received DMARC, TLS-RPT and Failure (ARF) reports.
  - Configuration of every aspect of the mail server.
  - Log viewer with search and filtering capabilities.
  - Self-service portal for password reset and encryption-at-rest key management.

## Screenshots

<img src="./img/demo.gif">

## Presentation

**Want a deeper dive?** Need to explain to your boss why Stalwart is the perfect fit? Whether you're evaluating options, making a case to your team, or simply curious about how it all works under the hood, these slides walk you through the key features, architecture, and benefits of Stalwart. Browse the [slides](https://stalw.art/slides) to see what makes it stand out.

## Install This Version

For complete prerequisites, an installer prompt walkthrough, post-install
steps, verification, and troubleshooting, read [How to install Stalwart and the
Mail/Calendar WebUI](docs/INSTALL.md).

For account holders, read [How to sign in to the WebUI and send
email](docs/WEBUI_USER_GUIDE.md).

Build or obtain the two release artifacts, then put them in the same directory
as `install.sh`:

```sh
install.sh
stalwart
stalwart-webui.tar.gz
```

The Stalwart binary must be compiled from this revision. To build the community
edition without the enterprise-only feature gates:

```sh
cargo build --release --package stalwart --locked --no-default-features \
  --features "sqlite postgres mysql rocks s3 redis azure nats"
cp target/release/stalwart ./stalwart
```

Build and package the WebUI on a build machine with Node.js 22.12 or later:

```sh
cd webui
npm ci
npm test
npm run build
tar -czf ../stalwart-webui.tar.gz \
  install.sh server.mjs stalwart-webui.service dist
```

Copy the three files to the new Linux systemd server and run:

```sh
chmod +x stalwart
sudo sh ./install.sh
```

The installer accepts no setup answers as command-line parameters. It asks for:

1. standard system paths or a custom self-contained prefix;
2. the local Stalwart binary and prebuilt WebUI archive;
3. the WebUI prefix, local service port, and exact public HTTPS origin;
4. automatic Caddy publishing (recommended) or an existing operator-managed proxy;
5. confirmation before changing the system;
6. quick setup (hostname and mail domain only) or advanced Stalwart setup (every initial server setting);
7. whether to send outbound mail through a Mailjet SMTP relay; and
8. whether to publish the printed DNS rows through the name.com API when they are not already in the zone.

The installer validates both artifacts before system changes, installs
`stalwart.service` and `stalwart-webui.service`, and keeps the WebUI bound to
`127.0.0.1` (port 8081 by default). The supplied binary must match the new
server's operating system, CPU architecture, and runtime libraries. A
compatible system Node.js is reused. If Node.js 22.12 or later is unavailable,
the installer downloads an official Node.js 22 Linux archive, verifies its
SHA-256 checksum, and installs a private version without replacing the system
`node` command.

Quick setup is the default. It asks for the server hostname and mail domain, then keeps every other WebUI bootstrap default and proceeds to the final review. Advanced setup uses the same embedded schema as the webpage bootstrap form. It offers server identity and TLS/DKIM choices; every data, blob, search, and cache backend; internal, LDAP, SQL, and OpenID Connect directories; all logging destinations; and every manual or automatic DNS provider with its nested settings. Empty input accepts the displayed default, and unavailable backends are clearly marked when the selected binary lacks their build feature.

On a fresh install, the script detects the server's public IPv4 and IPv6 addresses over HTTPS and passes them to setup as editable defaults. After review, setup initializes the selected store and writes the configuration. Once both services are healthy, the installer uses the generated internal administrator credential—or prompts for an external-directory administrator—through Stalwart's local JMAP management API to add the exact WebUI CORS origin and reload settings. The password is streamed over standard input to the local updater; it is not placed in command arguments or an environment variable.

The final aligned `TYPE`, `HOST`, `ANSWER`, `TTL`, `PRIO` table contains all Stalwart records plus the WebUI hostname's A/AAAA rows with the detected or supplied public addresses. Reverse DNS remains the responsibility of the provider that owns the public IP. Existing non-empty `config.json` files are preserved on reinstall; a reinstall asks for an administrator password to reapply and verify CORS.

If outbound TCP 25 is blocked (as on Google Cloud), choose the Mailjet SMTP relay when asked and enter the API key and secret key from [Mailjet's SMTP settings](https://app.mailjet.com/account/relay). If the DNS rows are not already in the zone and the domain is at name.com, the installer can publish them with a name.com API username and token. See [How to set up a Mailjet SMTP relay](docs/MAILJET_SMTP_RELAY.md).

The two public HTTPS hostnames require hostname-based routing: Stalwart uses a hostname such as `mail.example.com`, while `webmail.example.com` routes to the localhost WebUI service. In the recommended mode, the installer installs an otherwise-unconfigured Caddy package, moves Stalwart's HTTP listeners to loopback, writes both routes, obtains public certificates, and synchronizes Caddy's mail-host certificate into Stalwart for IMAPS/SMTPS. It refuses to overwrite an existing operator-owned Caddyfile. Choose operator-managed mode to keep an existing Caddy, NGINX, Apache, load balancer, or other proxy untouched. The installer never exposes the WebUI over public plain HTTP.

## Support

If you are having problems running Stalwart, found a bug, or just have a question, please head to the [Stalwart Support Portal](https://support.stalw.art) at [support.stalw.art](https://support.stalw.art). 
Additionally, you may purchase an [Enterprise License](https://stalw.art/enterprise) to obtain priority support from Stalwart Labs LLC, including response-time commitments and a private Priority Support area on the portal.

## Contributing

We welcome contributions, but to keep the project maintainable there are a few things to know before opening a pull request. Because of the high volume of low-quality, AI-generated submissions, pull requests are limited to a list of vouched contributors; to be added, post at [support.stalw.art](https://support.stalw.art) describing the change you would like to submit, together with a link to the proposed change. At this stage only bug fixes and translations are accepted, and new features are not, unless they involve just a few lines of code.
For the full guidelines, please read [CONTRIBUTING.md](CONTRIBUTING.md).

## Roadmap

Stalwart has reached an exciting point in its journey, it’s now **feature complete**. All the core functionality and open standard email and collaboration protocols that we set out to support are in place. In other words, Stalwart already does everything you’d expect from a modern, standards-compliant mail and collaboration platform.

The next major milestone is all about refinement: finalizing the database schema and focusing on performance optimizations to ensure everything runs as efficiently and reliably as possible. Once that’s done, we’ll be ready to roll out version **1.0**.

Of course, development doesn’t stop there. The community has contributed hundreds of great ideas for improvements and new features, everything from subtle usability tweaks to entirely new integrations. You can see the full list of proposals over on our [GitHub issues](https://github.com/stalwartlabs/stalwart/issues?q=is%3Aissue+is%3Aopen+sort%3Areactions-%2B1-desc+label%3Aenhancement). If there’s something you’d like to see prioritized, just give it a thumbs up as we plan to implement enhancements based on the community’s votes.

## Sponsorship

Your support is crucial in helping us continue to improve the project, add new features, and maintain the highest level of quality. By [becoming a sponsor](https://opencollective.com/stalwart), you help fund the development and future of Stalwart. As a thank-you, sponsors who contribute $5 per month or more will automatically receive a [Enterprise edition](https://stalw.art/enterprise/) license. And, sponsors who contribute $30 per month or more, also have access to [Premium Support](https://stalw.art/support) from Stalwart Labs.

## Funding

Part of the development of this project was funded through:

- [NGI0 Entrust Fund](https://nlnet.nl/entrust), a fund established by [NLnet](https://nlnet.nl/) with financial support from the European Commission's [Next Generation Internet](https://ngi.eu/) programme, under the aegis of DG Communications Networks, Content and Technology under grant agreement No 101069594.
- [NGI Zero Core](https://nlnet.nl/NGI0/), a fund established by [NLnet](https://nlnet.nl/) with financial support from the European Commission's programme, under the aegis of DG Communications Networks, Content and Technology under grant agreement No 101092990.

If you find the project useful you can help by [becoming a sponsor](https://opencollective.com/stalwart). Thank you!

## License

This project is dual-licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0; as published by the Free Software Foundation) and the **Stalwart Enterprise License v2 (SELv2)**:

- The [GNU Affero General Public License v3.0](./LICENSES/AGPL-3.0-only.txt) is a free software license that ensures your freedom to use, modify, and distribute the software, with the condition that any modified versions of the software must also be distributed under the same license. 
- The [Stalwart Enterprise License v2 (SELv2)](./LICENSES/LicenseRef-SEL.txt) is a proprietary license designed for commercial use. It offers additional features and greater flexibility for businesses that do not wish to comply with the AGPL-3.0 license requirements. 

Each file in this project contains a license notice at the top, indicating the applicable license(s). The license notice follows the [REUSE guidelines](https://reuse.software/) to ensure clarity and consistency. The full text of each license is available in the [LICENSES](./LICENSES/) directory.

## Copyright

Copyright (C) 2020, Stalwart Labs LLC
