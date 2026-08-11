/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

use flate2::read::GzDecoder;
use serde_json::{Map, Value};
use std::io::{BufRead, Read, Write};
use utils::{DomainPart, is_valid_domain};

const WEB_SCHEMA_GZ: &[u8] = include_bytes!("../../../../resources/schema/schema.json.gz");

#[derive(Clone, Debug)]
struct MenuChoice {
    value: String,
    label: String,
    schema_name: Option<String>,
    unavailable: Option<&'static str>,
}

/// Terminal renderer for the same form/schema data consumed by the WebUI.
///
/// Keeping the nested questions schema-driven is important: storage, directory,
/// and tracer variants evolve frequently and a handwritten CLI form would drift.
pub struct WebSetupWizard<'a, R, W> {
    input: &'a mut R,
    output: &'a mut W,
    schema: Value,
}

impl<'a, R: BufRead, W: Write> WebSetupWizard<'a, R, W> {
    pub fn new(input: &'a mut R, output: &'a mut W) -> Result<Self, String> {
        Ok(Self {
            input,
            output,
            schema: load_web_schema()?,
        })
    }

    pub fn configure_object(&mut self, object_name: &str, current: Value) -> Result<Value, String> {
        let schema = self
            .schema
            .pointer(&format!("/schemas/{}", escape_pointer(object_name)))
            .cloned()
            .ok_or_else(|| format!("Web setup schema '{object_name}' was not found"))?;

        match schema.get("type").and_then(Value::as_str) {
            Some("multiple") => self.configure_multiple(object_name, &schema, current),
            Some("single") => self.configure_single(object_name, current),
            other => Err(format!(
                "Unsupported web setup schema type {other:?} for {object_name}"
            )),
        }
    }

    /// Prompts only for the two identity fields used by quick setup while
    /// retaining the WebUI bootstrap defaults for every other field.
    pub fn configure_bootstrap_identity(&mut self, current: Value) -> Result<Value, String> {
        let fields = self
            .schema
            .pointer("/fields/x:Bootstrap")
            .cloned()
            .ok_or_else(|| "Web setup fields for x:Bootstrap were not found".to_string())?;
        let form = self
            .schema
            .pointer("/forms/x:Bootstrap")
            .cloned()
            .ok_or_else(|| "Web setup form for x:Bootstrap was not found".to_string())?;
        let mut value = if current.is_object() {
            current
        } else {
            Value::Object(Map::new())
        };

        writeln!(self.output, "\n  Server Identity").map_err(io_error)?;
        for name in ["serverHostname", "defaultDomain"] {
            let field = fields
                .pointer(&format!("/properties/{}", escape_pointer(name)))
                .ok_or_else(|| format!("Web setup field '{name}' was not found"))?;
            let form_field = form
                .get("sections")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|section| section.get("fields").and_then(Value::as_array))
                .flatten()
                .find(|form_field| form_field.get("name").and_then(Value::as_str) == Some(name));
            let label = form_field
                .and_then(|form_field| form_field.get("label"))
                .and_then(Value::as_str)
                .unwrap_or(name);
            if let Some(description) = field.get("description").and_then(Value::as_str) {
                for line in description.lines() {
                    writeln!(self.output, "    {line}").map_err(io_error)?;
                }
            }
            let existing = value.get(name).cloned().unwrap_or(Value::Null);
            let updated = self.prompt_domain(label, existing)?;
            value
                .as_object_mut()
                .expect("value was converted to an object")
                .insert(name.to_string(), updated);
        }

        Ok(value)
    }

    fn configure_multiple(
        &mut self,
        object_name: &str,
        schema: &Value,
        current: Value,
    ) -> Result<Value, String> {
        let variants = schema
            .get("variants")
            .and_then(Value::as_array)
            .ok_or_else(|| format!("Schema {object_name} has no variants"))?;
        let choices = variants
            .iter()
            .map(|variant| {
                let value = variant
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| format!("Schema {object_name} has an unnamed variant"))?;
                Ok(MenuChoice {
                    value: value.to_string(),
                    label: variant
                        .get("label")
                        .and_then(Value::as_str)
                        .unwrap_or(value)
                        .to_string(),
                    schema_name: variant
                        .get("schemaName")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    unavailable: unavailable_reason(object_name, value),
                })
            })
            .collect::<Result<Vec<_>, String>>()?;

        let current_type = current.get("@type").and_then(Value::as_str);
        let default_index = choices
            .iter()
            .position(|choice| Some(choice.value.as_str()) == current_type)
            .unwrap_or(0);
        let selected = self.prompt_menu("Type", &choices, default_index)?;
        let choice = &choices[selected];

        let mut value = if Some(choice.value.as_str()) == current_type {
            current
        } else {
            let mut object = Map::new();
            object.insert("@type".to_string(), Value::String(choice.value.clone()));
            Value::Object(object)
        };

        if let Some(schema_name) = &choice.schema_name {
            let mut seeded = self.defaults_for(schema_name);
            deep_merge(&mut seeded, value);
            value = self.configure_single(schema_name, seeded)?;
        }

        if let Value::Object(object) = &mut value {
            object.insert("@type".to_string(), Value::String(choice.value.clone()));
        }
        Ok(value)
    }

    fn configure_single(&mut self, schema_name: &str, current: Value) -> Result<Value, String> {
        let form = self
            .schema
            .pointer(&format!("/forms/{}", escape_pointer(schema_name)))
            .cloned();
        let fields = self
            .schema
            .pointer(&format!("/fields/{}", escape_pointer(schema_name)))
            .cloned()
            .unwrap_or(Value::Null);

        let Some(sections) = form
            .as_ref()
            .and_then(|form| form.get("sections"))
            .and_then(Value::as_array)
        else {
            return Ok(current);
        };

        let mut value = current;
        if !value.is_object() {
            value = Value::Object(Map::new());
        }

        for section in sections {
            if let Some(title) = section.get("title").and_then(Value::as_str) {
                writeln!(self.output, "\n  {title}").map_err(io_error)?;
            }
            let Some(form_fields) = section.get("fields").and_then(Value::as_array) else {
                continue;
            };
            for form_field in form_fields {
                let Some(name) = form_field.get("name").and_then(Value::as_str) else {
                    continue;
                };
                if name == "@type" {
                    continue;
                }
                let Some(field) = fields.pointer(&format!("/properties/{}", escape_pointer(name)))
                else {
                    continue;
                };
                if matches!(
                    field.get("update").and_then(Value::as_str),
                    Some("serverSet")
                ) {
                    continue;
                }

                let label = form_field
                    .get("label")
                    .and_then(Value::as_str)
                    .unwrap_or(name);
                let description = field
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let field_type = field.get("type").cloned().unwrap_or(Value::Null);
                let existing = value.get(name).cloned().unwrap_or(Value::Null);
                let updated = if schema_name == "x:Bootstrap"
                    && matches!(name, "serverHostname" | "defaultDomain")
                {
                    for line in description.lines() {
                        writeln!(self.output, "    {line}").map_err(io_error)?;
                    }
                    self.prompt_domain(label, existing)?
                } else {
                    self.prompt_field(label, description, &field_type, existing)?
                };
                value
                    .as_object_mut()
                    .expect("value was converted to an object")
                    .insert(name.to_string(), updated);
            }
        }

        Ok(value)
    }

    fn prompt_field(
        &mut self,
        label: &str,
        description: &str,
        field_type: &Value,
        current: Value,
    ) -> Result<Value, String> {
        if !description.is_empty() {
            for line in description.lines() {
                writeln!(self.output, "    {line}").map_err(io_error)?;
            }
        }

        let nullable = field_type.get("nullable").and_then(Value::as_bool) == Some(true);
        match field_type.get("type").and_then(Value::as_str) {
            Some("boolean") => {
                let default = current.as_bool().unwrap_or(false);
                prompt_yes_no(self.input, self.output, label, default).map(Value::Bool)
            }
            Some("enum") => self.prompt_enum(label, field_type, current),
            Some("object") => {
                let object_name = field_type
                    .get("objectName")
                    .and_then(Value::as_str)
                    .ok_or_else(|| format!("Object field '{label}' has no objectName"))?;
                if nullable && current.is_null() {
                    if !prompt_yes_no(
                        self.input,
                        self.output,
                        &format!("Configure {label}"),
                        false,
                    )? {
                        return Ok(Value::Null);
                    }
                }
                writeln!(self.output, "\n    {label}").map_err(io_error)?;
                self.configure_object(object_name, current)
            }
            Some("number") => self.prompt_typed_json(label, current, nullable, JsonKind::Number),
            Some("map") | Some("set") => {
                self.prompt_typed_json(label, current, nullable, JsonKind::Object)
            }
            Some("list") | Some("array") => {
                self.prompt_typed_json(label, current, nullable, JsonKind::Array)
            }
            Some("string") | Some("objectId") | Some("blobId") | Some("utcDateTime") => {
                self.prompt_string(label, field_type, current, nullable)
            }
            _ => self.prompt_typed_json(label, current, nullable, JsonKind::Any),
        }
    }

    fn prompt_enum(
        &mut self,
        label: &str,
        field_type: &Value,
        current: Value,
    ) -> Result<Value, String> {
        let enum_name = field_type
            .get("enumName")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("Enum field '{label}' has no enumName"))?;
        let entries = self
            .schema
            .pointer(&format!("/enums/{}", escape_pointer(enum_name)))
            .and_then(Value::as_array)
            .ok_or_else(|| format!("Enum '{enum_name}' was not found"))?;
        let choices = entries
            .iter()
            .filter_map(|entry| {
                let value = entry.get("name")?.as_str()?;
                Some(MenuChoice {
                    value: value.to_string(),
                    label: entry
                        .get("label")
                        .and_then(Value::as_str)
                        .unwrap_or(value)
                        .to_string(),
                    schema_name: None,
                    unavailable: None,
                })
            })
            .collect::<Vec<_>>();
        let current = current.as_str();
        let default_index = choices
            .iter()
            .position(|choice| Some(choice.value.as_str()) == current)
            .unwrap_or(0);
        let index = self.prompt_menu(label, &choices, default_index)?;
        Ok(Value::String(choices[index].value.clone()))
    }

    fn prompt_string(
        &mut self,
        label: &str,
        field_type: &Value,
        current: Value,
        nullable: bool,
    ) -> Result<Value, String> {
        let current = current.as_str();
        let secret = field_type.get("format").and_then(Value::as_str) == Some("secret");
        loop {
            let shown = match (secret, current) {
                (true, Some(value)) if !value.is_empty() => "configured".to_string(),
                (_, Some(value)) if !value.is_empty() => value.to_string(),
                _ if nullable => "not set".to_string(),
                _ => String::new(),
            };
            if shown.is_empty() {
                write!(self.output, "{label}: ").map_err(io_error)?;
            } else {
                write!(self.output, "{label} [{shown}]: ").map_err(io_error)?;
            }
            self.output.flush().map_err(io_error)?;
            let answer = read_line(self.input)?;
            let answer = answer.trim();
            if answer.is_empty() {
                if let Some(current) = current {
                    if !current.is_empty() || nullable {
                        return Ok(Value::String(current.to_string()));
                    }
                } else if nullable {
                    return Ok(Value::Null);
                }
                writeln!(self.output, "  A value is required.").map_err(io_error)?;
                continue;
            }
            if nullable && answer == "-" {
                return Ok(Value::Null);
            }
            return Ok(Value::String(answer.to_string()));
        }
    }

    fn prompt_domain(&mut self, label: &str, current: Value) -> Result<Value, String> {
        loop {
            let value = self.prompt_string(label, &Value::Null, current.clone(), false)?;
            let normalized = value
                .as_str()
                .unwrap_or_default()
                .trim()
                .to_lowercase()
                .to_ascii_domain()
                .map(|value| value.into_owned())
                .unwrap_or_default();
            if is_valid_domain(&normalized) {
                return Ok(Value::String(normalized));
            }
            writeln!(self.output, "  Enter a valid fully-qualified domain name.")
                .map_err(io_error)?;
        }
    }

    fn prompt_typed_json(
        &mut self,
        label: &str,
        current: Value,
        nullable: bool,
        expected: JsonKind,
    ) -> Result<Value, String> {
        loop {
            let shown = if current.is_null() {
                "not set".to_string()
            } else {
                compact_json(&current)
            };
            write!(self.output, "{label} [{shown}]: ")
                .and_then(|_| self.output.flush())
                .map_err(io_error)?;
            let answer = read_line(self.input)?;
            let answer = answer.trim();
            if answer.is_empty() {
                return Ok(current);
            }
            if nullable && answer == "-" {
                return Ok(Value::Null);
            }
            let parsed: Value = match serde_json::from_str(answer) {
                Ok(value) => value,
                Err(err) => {
                    writeln!(self.output, "  Enter valid JSON: {err}").map_err(io_error)?;
                    continue;
                }
            };
            if expected.matches(&parsed) || (nullable && parsed.is_null()) {
                return Ok(parsed);
            }
            writeln!(
                self.output,
                "  Expected {}, received {}.",
                expected.label(),
                json_type(&parsed)
            )
            .map_err(io_error)?;
        }
    }

    fn prompt_menu(
        &mut self,
        label: &str,
        choices: &[MenuChoice],
        default_index: usize,
    ) -> Result<usize, String> {
        if choices.is_empty() {
            return Err(format!("No choices are available for {label}"));
        }
        loop {
            writeln!(self.output, "{label}:").map_err(io_error)?;
            for (index, choice) in choices.iter().enumerate() {
                let marker = if index == default_index {
                    " (default)"
                } else {
                    ""
                };
                let unavailable = if choice.unavailable.is_some() {
                    " [unavailable in this build]"
                } else {
                    ""
                };
                writeln!(
                    self.output,
                    "  {}) {}{}{}",
                    index + 1,
                    choice.label,
                    marker,
                    unavailable
                )
                .map_err(io_error)?;
            }
            write!(self.output, "Select {label} [{}]: ", default_index + 1)
                .and_then(|_| self.output.flush())
                .map_err(io_error)?;
            let answer = read_line(self.input)?;
            let answer = answer.trim();
            let index = if answer.is_empty() {
                default_index
            } else {
                match answer.parse::<usize>() {
                    Ok(index) if (1..=choices.len()).contains(&index) => index - 1,
                    _ => {
                        writeln!(self.output, "  Choose a number from the menu.")
                            .map_err(io_error)?;
                        continue;
                    }
                }
            };
            if let Some(reason) = choices[index].unavailable {
                writeln!(self.output, "  This choice is unavailable: {reason}")
                    .map_err(io_error)?;
                continue;
            }
            return Ok(index);
        }
    }

    fn defaults_for(&self, schema_name: &str) -> Value {
        self.schema
            .pointer(&format!("/fields/{}/defaults", escape_pointer(schema_name)))
            .cloned()
            .unwrap_or_else(|| Value::Object(Map::new()))
    }
}

#[derive(Clone, Copy)]
enum JsonKind {
    Any,
    Number,
    Object,
    Array,
}

impl JsonKind {
    fn matches(self, value: &Value) -> bool {
        match self {
            JsonKind::Any => true,
            JsonKind::Number => value.is_number(),
            JsonKind::Object => value.is_object(),
            JsonKind::Array => value.is_array(),
        }
    }

    const fn label(self) -> &'static str {
        match self {
            JsonKind::Any => "a JSON value",
            JsonKind::Number => "a JSON number",
            JsonKind::Object => "a JSON object",
            JsonKind::Array => "a JSON array",
        }
    }
}

pub fn prompt_yes_no<R: BufRead, W: Write>(
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

pub fn read_line<R: BufRead>(input: &mut R) -> Result<String, String> {
    let mut value = String::new();
    match input.read_line(&mut value) {
        Ok(0) => Err("Setup input ended before the wizard completed".to_string()),
        Ok(_) => Ok(value),
        Err(err) => Err(format!("Failed to read setup input: {err}")),
    }
}

fn load_web_schema() -> Result<Value, String> {
    let mut decoder = GzDecoder::new(WEB_SCHEMA_GZ);
    let mut json = Vec::new();
    decoder
        .read_to_end(&mut json)
        .map_err(|err| format!("Failed to decompress the embedded web setup schema: {err}"))?;
    serde_json::from_slice(&json)
        .map_err(|err| format!("Failed to parse the embedded web setup schema: {err}"))
}

fn unavailable_reason(object_name: &str, variant: &str) -> Option<&'static str> {
    let needs_feature = match (object_name, variant) {
        ("x:DataStore", "RocksDb") => (!cfg!(feature = "rocks")).then_some("rocks"),
        ("x:DataStore" | "x:SqlAuthStore", "Sqlite") => {
            (!cfg!(feature = "sqlite")).then_some("sqlite")
        }
        ("x:DataStore" | "x:BlobStore" | "x:BlobStoreBase" | "x:SearchStore", "FoundationDb") => {
            (!cfg!(feature = "foundationdb")).then_some("foundationdb")
        }
        (
            "x:DataStore" | "x:BlobStore" | "x:BlobStoreBase" | "x:SearchStore" | "x:SqlAuthStore",
            "PostgreSql",
        ) => (!cfg!(feature = "postgres")).then_some("postgres"),
        (
            "x:DataStore" | "x:BlobStore" | "x:BlobStoreBase" | "x:SearchStore" | "x:SqlAuthStore",
            "MySql",
        ) => (!cfg!(feature = "mysql")).then_some("mysql"),
        ("x:BlobStore" | "x:BlobStoreBase", "S3") => (!cfg!(feature = "s3")).then_some("s3"),
        ("x:BlobStore" | "x:BlobStoreBase", "Azure") => {
            (!cfg!(feature = "azure")).then_some("azure")
        }
        ("x:InMemoryStore" | "x:InMemoryStoreBase", "Redis" | "RedisCluster" | "RedisSentinel") => {
            (!cfg!(feature = "redis")).then_some("redis")
        }
        ("x:BlobStore" | "x:InMemoryStore", "Sharded") => {
            (!cfg!(feature = "enterprise")).then_some("enterprise")
        }
        _ => None,
    };
    needs_feature.map(|feature| match feature {
        "foundationdb" => {
            "rebuild Stalwart with the 'foundationdb' feature and the matching FoundationDB client library"
        }
        "rocks" => "rebuild Stalwart with the 'rocks' feature",
        "sqlite" => "rebuild Stalwart with the 'sqlite' feature",
        "postgres" => "rebuild Stalwart with the 'postgres' feature",
        "mysql" => "rebuild Stalwart with the 'mysql' feature",
        "s3" => "rebuild Stalwart with the 's3' feature",
        "azure" => "rebuild Stalwart with the 'azure' feature",
        "redis" => "rebuild Stalwart with the 'redis' feature",
        "enterprise" => "rebuild Stalwart with the 'enterprise' feature",
        _ => "rebuild Stalwart with the required feature",
    })
}

fn deep_merge(base: &mut Value, overlay: Value) {
    match (base, overlay) {
        (Value::Object(base), Value::Object(overlay)) => {
            for (key, value) in overlay {
                if let Some(existing) = base.get_mut(&key) {
                    deep_merge(existing, value);
                } else {
                    base.insert(key, value);
                }
            }
        }
        (base, overlay) => *base = overlay,
    }
}

fn compact_json(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "<invalid>".to_string())
}

fn json_type(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "a boolean",
        Value::Number(_) => "a number",
        Value::String(_) => "a string",
        Value::Array(_) => "an array",
        Value::Object(_) => "an object",
    }
}

fn escape_pointer(value: &str) -> String {
    value.replace('~', "~0").replace('/', "~1")
}

fn io_error(error: std::io::Error) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn embedded_schema_contains_every_bootstrap_section() {
        let schema = load_web_schema().unwrap();
        let form = &schema["forms"]["x:Bootstrap"];
        let names = form["sections"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|section| section["fields"].as_array().unwrap())
            .filter_map(|field| field["name"].as_str())
            .collect::<Vec<_>>();
        for expected in [
            "serverHostname",
            "defaultDomain",
            "requestTlsCertificate",
            "generateDkimKeys",
            "dataStore",
            "blobStore",
            "searchStore",
            "inMemoryStore",
            "directory",
            "tracer",
            "dnsServer",
        ] {
            assert!(names.contains(&expected), "missing {expected}");
        }
    }

    #[test]
    fn default_web_setup_path_round_trips_to_bootstrap() {
        use registry::schema::{prelude::ObjectImpl, structs::Bootstrap};

        let schema = load_web_schema().unwrap();
        let mut input = Cursor::new(vec![b'\n'; 512]);
        let mut output = Vec::new();
        let mut wizard = WebSetupWizard::new(&mut input, &mut output).unwrap();
        let configured = wizard
            .configure_object(
                "x:Bootstrap",
                serde_json::to_value(Bootstrap {
                    server_hostname: "mail.example.test".to_string(),
                    default_domain: "example.test".to_string(),
                    ..Default::default()
                })
                .unwrap(),
            )
            .unwrap();
        let bootstrap: Bootstrap = serde_json::from_value(configured).unwrap();
        let mut errors = Vec::new();
        assert!(bootstrap.validate(&mut errors), "{errors:?}");

        let output = String::from_utf8(output).unwrap();
        for expected in [
            "Server Identity",
            "Storage",
            "Account Directory",
            "Logging",
            "Automatic DNS Management",
            "FoundationDB",
            "Open Telemetry (HTTP)",
            "Cloudflare",
        ] {
            assert!(output.contains(expected), "missing CLI choice {expected}");
        }
        for object_name in [
            "x:DataStore",
            "x:BlobStore",
            "x:SearchStore",
            "x:InMemoryStore",
            "x:DirectoryBootstrap",
            "x:Tracer",
            "x:DnsServerBootstrap",
        ] {
            for variant in schema["schemas"][object_name]["variants"]
                .as_array()
                .unwrap()
            {
                let label = variant["label"].as_str().unwrap();
                assert!(
                    output.contains(label),
                    "CLI omitted {object_name} choice {label}"
                );
            }
        }
    }

    #[test]
    fn quick_setup_prompts_only_for_server_identity() {
        use registry::schema::structs::Bootstrap;

        let mut input = Cursor::new(b"mail.quick.test\nquick.test\n".as_slice());
        let mut output = Vec::new();
        let mut wizard = WebSetupWizard::new(&mut input, &mut output).unwrap();
        let configured = wizard
            .configure_bootstrap_identity(serde_json::to_value(Bootstrap::default()).unwrap())
            .unwrap();
        let bootstrap: Bootstrap = serde_json::from_value(configured).unwrap();

        assert_eq!(bootstrap.server_hostname, "mail.quick.test");
        assert_eq!(bootstrap.default_domain, "quick.test");
        let output = String::from_utf8(output).unwrap();
        assert!(output.contains("Server Identity"));
        assert!(!output.contains("Storage"));
        assert!(!output.contains("Logging"));
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
    fn typed_json_retries_until_the_container_type_matches() {
        let mut input = Cursor::new(b"[]\n{\"mail\":true}\n".as_slice());
        let mut output = Vec::new();
        let mut wizard = WebSetupWizard::new(&mut input, &mut output).unwrap();
        let value = wizard
            .prompt_typed_json(
                "Attributes",
                Value::Object(Map::new()),
                false,
                JsonKind::Object,
            )
            .unwrap();
        assert_eq!(value["mail"], true);
        assert!(
            String::from_utf8(output)
                .unwrap()
                .contains("Expected a JSON object")
        );
    }

    #[test]
    fn eof_is_an_error() {
        let mut input = Cursor::new(Vec::<u8>::new());
        let mut output = Vec::new();
        assert!(prompt_yes_no(&mut input, &mut output, "Continue", true).is_err());
    }
}
