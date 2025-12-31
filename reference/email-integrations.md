# Email Integrations (SMTP + Microsoft Graph)

## Overview

CommerceOS provides unified email delivery supporting both SMTP and Microsoft Graph (MS Graph) providers. A single **Email** settings page lets administrators enable providers using per-provider **active** toggles with mutual-exclusion behavior (enabling one provider disables the other).

Email functionality is split across four packages:
- `@commerceos/email-provider` – Provider abstraction layer with registry and selection API
- `@commerceos/connector-smtp` – SMTP provider implementation (self-registers on import)
- `@commerceos/connector-msgraph` – MS Graph provider implementation (self-registers on import)
- `@commerceos/email` – Orchestrator that registers the unified SendEmailTask handler

The `@commerceos/email-provider` package defines the `EmailProvider` interface and provides the provider registry used by connectors and the orchestrator:
- **Interface:** `EmailProvider<T>` – connectors implement `isActive()`, `validateConfig()`, `decode()`, and `send()`
- **Registration:** `registerEmailProvider()` – connectors call this at module load to self-register
- **Selection:** `selectActiveProvider()` – orchestrator calls this to find the active provider based on `EmailConfig.provider` and each provider's `active` flag

**Startup requirement:** Connectors self-register providers when their modules are imported. The bootloader loads connectors before the email orchestrator to ensure providers are registered before the unified handler is created.

---

## Settings Page

- **Route:** `/cos/integrations/email`
- **Menu location:** Integrations → Email

The page renders:

1. **No provider warning** – A cautionary alert shown when neither provider is enabled
2. **Microsoft Graph panel** – Collapsible expander card with MS Graph configuration
3. **SMTP panel** – Collapsible expander card with SMTP configuration

Each panel contains an **Enable** toggle. Enabling one provider automatically disables the other (mutual-exclusion).

### Provider Active Flags

Each provider has an **active** flag in its configuration:

| Provider | Toggle Label | Config Class |
|----------|--------------|--------------|
| SMTP | "Enable SMTP" | `SMTPConfig.active` |
| MS Graph | "Enable Microsoft Graph" | `MSGraphMailConfig.active` |

When a provider is enabled (active=true), its configuration **must** be valid or email sending will fail hard.

### SMTP Panel Fields

- Server URL, Username
- Password (basic auth, shown when OAuth2 disabled)
- OAuth2/XOAUTH2 toggle ("Use OAuth2 (XOAUTH2) - Required for Microsoft 365")
- OAuth2 Client ID, Client Secret, Tenant ID (shown when OAuth2 enabled)
- Default sender email and name
- Demand STARTTLS toggle

### Microsoft Graph Panel Fields

- Tenant ID, Client ID, Client Secret
- Sender email and name (default sender)
- Save to Sent Items toggle

---

## Configuration

### Provider Selection Rules

Provider selection at runtime is driven by `EmailConfig.provider` (defaults to `"smtp"`) combined with each provider's `active` flag:

1. **Primary path:** If `EmailConfig` is configured, the orchestrator looks up the provider by `EmailConfig.provider` value (`"smtp"` or `"msgraph"`) and uses it only if that provider's `active` flag is true.
2. **Legacy fallback:** If `EmailConfig` is empty (no provider explicitly selected), the orchestrator iterates through registered providers and uses the first one with `active=true`.
3. If no provider is active, email sending fails.

The UI handles this transparently: enabling a provider sets both its `active` flag and updates `EmailConfig.provider`, while disabling clears both.

### Required Fields

| Config Class | Required Fields |
|--------------|-----------------|
| `SMTPConfig` | `url`, `username`, and either `password` (basic auth) or `oauth2ClientId` + `oauth2ClientSecret` (OAuth2) |
| `MSGraphMailConfig` | `tenantId`, `clientId`, `clientSecret`, `defaultSender` |

### Optional Fields

| Config Class | Optional Fields |
|--------------|-----------------|
| `SMTPConfig` | `defaultSender`, `defaultSenderName`, `demandSTARTTLS`, `oauth2TenantId` (defaults to `"common"`) |
| `MSGraphMailConfig` | `defaultSenderName`, `saveToSentItems` |

- If a provider is **active** (flag is true), its configuration must include all required fields or sending fails hard.
- If a provider is **inactive**, it is ignored even if partially configured.

---

## Runtime Behavior

### Package Roles

- `@commerceos/email-provider` defines the `EmailProvider` interface and provides the registry/selection API (`registerEmailProvider()`, `selectActiveProvider()`). It has no dependencies on connectors.
- `@commerceos/connector-smtp` contains SMTP send logic and self-registers as a provider on import via `registerEmailProvider()`.
- `@commerceos/connector-msgraph` contains MS Graph send logic and self-registers as a provider on import via `registerEmailProvider()`.
- `@commerceos/email` registers the **only** SendEmailTask handler and orchestrates provider selection via `selectActiveProvider()` (imported from `@commerceos/email-provider`).

### Orchestrator Flow

1. Select the active provider based on `EmailConfig.provider` and `active` flags (see [Provider Selection Rules](#provider-selection-rules)).
2. If no active provider is found, fail with a configuration error.
3. Validate the active provider's configuration; if invalid, fail with a detailed error listing missing fields.
4. Decode the email task using the provider's `decode()` method.
5. Send via the provider's `send()` method.

This design ensures only one handler is active and avoids load-order conflicts.

---

## Error Messages

Configuration errors direct users to the unified settings page:

| Scenario | Error Message |
|----------|---------------|
| No providers registered | "No email providers are registered. Ensure at least one email connector package (e.g., @commerceos/connector-msgraph, @commerceos/connector-smtp) is imported before sending emails." |
| No provider active (providers registered) | "No email provider is active. Registered providers: SMTP, Microsoft Graph. Enable and configure at least one provider in Settings → Integrations → Email." |
| SMTP active but misconfigured | "SMTP is active but not properly configured. Missing: url, username. Configure it in Settings → Integrations → Email, or disable this provider." |
| MS Graph active but misconfigured | "Microsoft Graph is active but not properly configured. Missing: clientId, senderEmail. Configure it in Settings → Integrations → Email, or disable this provider." |

Note: The "Missing: ..." portion lists the specific fields that failed validation.

---

## Security Notes

- Masked credential fields (password, client secrets) display as repeated asterisks in the UI
- When a masked field is left unchanged, the original secret is preserved (the UI does not overwrite with literal asterisks)
- Secrets, URLs, headers, and tokens never appear in UI labels or metrics

---
