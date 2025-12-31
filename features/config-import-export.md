# API Utils: Config Import/Export

This spec defines the config import/export utility in the API utilities UI (`/api-utils`). It focuses on exporting a curated set of configuration resources to a zip file and importing that zip back into another environment.

---

## Goals

- Provide a safe, user-driven export/import flow for configuration resources via the CommerceOS API.
- Use a hardcoded, curated whitelist of resources eligible for config export/import.
- Make export produce a zip format that import can consume (no signing/verification required).
- Keep the UI fully client-side and reuse existing auth/session patterns.

## Non-goals

- No automatic discovery of configuration resources via OpenAPI.
- No secret signing/verification or cryptographic validation.
- No support for product, customer, receipt, or transactional data.
- Do not export or import masked secret fields (they must be re-entered manually).

---

## Configuration Resource Scope

### Must-include: Config API

The config API is rooted at `/v1/config` with sub-resources:

- `/v1/config/api`
- `/v1/config/bankID`
- `/v1/config/booking`
- `/v1/config/consumer-signin`
- `/v1/config/customer-validation`
- `/v1/config/file-signing`
- `/v1/config/gateway-api`
- `/v1/config/infrasec`
- `/v1/config/mobile-pick`
- `/v1/config/oauth2`
- `/v1/config/root-click-and-collect`
- `/v1/config/root-order`
- `/v1/config/root-price-checking-terminal`
- `/v1/config/root-trade-relationship`
- `/v1/config/smtp`
- `/v1/config/spar`
- `/v1/config/validation-rules`
- `/v1/config/webshop`

Also in config scope:
- `/v1/serials`

### Refined Whitelist (Final)

These are additional resources that constitute configuration but are not in the config API. The whitelist has been refined to distinguish true configuration from operational/transactional data.

**Admin / Access**
- `/v1/users` *(borderline operational data, but included for environment setup/replication)*
- `/v1/user-roles`
- `/v1/user-role-assignments`
- `/v1/user-permissions`
- `/v1/root-organization`
- `/v1/systems`

**POS + Devices**
- `/v1/pos-terminals`
- `/v1/pos-profiles`
- `/v1/pos-functions`
- `/v1/payment-terminals`
- `/v1/devices`
- `/v1/device-roles`
- `/v1/device-role-assignments`
- `/v1/device-permissions`
- `/v1/templates`
- `/v1/printers`
- `/v1/star-webprnt-printers`
- `/v1/epson-epos-printers`
- `/v1/system-printers`
- `/v1/verifone-cloud-printers`
- `/v1/serial-printers`
- `/v1/esc-pos-serial-printers`
- `/v1/currency-denominations`

**Retail Config** *(reference data for retail operations)*
- `/v1/payment-methods`
- `/v1/return-reasons`
- `/v1/vat-codes`
- `/v1/discount-phases`
- `/v1/discount-reasons`
- `/v1/sales-channels`

**Integrations**
- `/v1/payment-integrations`
- `/v1/shipment-integrations`
- `/v1/epi-integrations`
- `/v1/epi-configurations`

### Explicitly Excluded (Non-Config)

- Products, prices, assortments, stock
- Customers, agents (except users), trade relationships
- Orders, receipts, payments, reports
- Any transactional or historical data
- `/v1/oauth2-clients` *(contains masked secrets, security-sensitive)*
- `/v1/sync-webhooks` *(environment-specific URLs and tokens)*
- `/v1/price-rules` *(business logic, closer to data than static configuration)*

### Configuration vs Data Decision Criteria

Resources are considered **configuration** if they:
1. Define HOW the system operates (settings, behaviors)
2. Are reference data that rarely changes (payment methods, VAT codes, return reasons)
3. Control access and permissions (users, roles, permissions)
4. Configure hardware/devices (devices, printers, POS terminals)
5. Define integration settings

Resources are considered **data** (excluded) if they:
1. Are transactional records (orders, receipts, payments, shipments)
2. Are customer/business entity data (agents, companies, customers, trade relationships)
3. Are product/inventory data (products, prices, stock, assortments)
4. Are historical/reporting data (reports, logs)
5. Contain environment-specific secrets or URLs

---

## Export Format (Zip)

**Root files:**
- `manifest.json`
- `resources/` (one file per resource)

**manifest.json**
```json
{
  "formatVersion": 1,
  "exportedAt": "2025-01-10T12:34:56.000Z",
  "environment": "production",
  "baseUri": "https://api.example.com",
  "resources": [
    {
      "key": "config/oauth2",
      "path": "/v1/config/oauth2",
      "method": "PUT",
      "filename": "resources/config.oauth2.json",
      "type": "singleton"
    },
    {
      "key": "payment-methods",
      "path": "/v1/payment-methods",
      "method": "PUT",
      "filename": "resources/payment-methods.json",
      "type": "collection"
    }
  ]
}
```

**Resource files**
- JSON payloads, saved exactly as returned by the API.
- Collections are stored as JSON arrays.
- Singletons are stored as JSON objects.

---

## Export Flow

1. Authenticate (reuse existing OAuth2/API key flows).
2. Load the hardcoded whitelist grouped by category.
3. Render a collapsible, grouped selection list with checkboxes.
4. On export:
   - For each selected resource:
     - Fetch from the API with `fields=all` (or `~withAll` where needed).
     - Store response in `resources/*.json`.
   - Build `manifest.json` describing resource paths/methods.
   - Create zip, download as `commerceos-config-YYYYMMDD.zip`.

**Notes:**
- If responses are large, chunking should be supported (later phase).
- If a resource fails, export should continue and annotate failures in the manifest.

---

## Import Flow

1. User selects a zip file (drag/drop or file picker).
2. Parse `manifest.json` and validate against whitelist.
3. Show a summary screen (resources found, missing/unsupported entries, counts).
4. Allow selecting a subset to import.
5. Execute import in dependency order:
   - Config API singletons first (foundational settings)
   - Admin/Access: permissions → roles → users → role-assignments → systems
   - Devices: permissions → roles → devices → role-assignments
   - POS: templates → printers (all types) → currency-denominations → pos-functions → pos-profiles → pos-terminals
   - Retail Config: vat-codes → discount-phases → discount-reasons → sales-channels
   - Payments: payment-methods → return-reasons → payment-terminals
   - Integrations: payment-integrations → shipment-integrations → epi-integrations → epi-configurations
6. For each resource:
   - `PUT` to collection endpoints with array payloads.
   - `PUT` to singleton endpoints with object payloads.
   - Log results per resource and show summary (success/fail).

**Assumptions:**
- Import zip matches the exported format (no signing needed).
- Unknown files should be ignored as long as manifest is valid.
- Any masked secrets are excluded from export and must never be re-applied on import.

### Whitelist Type Validation

During import, each manifest resource is validated against the whitelist for both **path** and **type**:

| Validation Result | Criteria | UI Behavior |
|-------------------|----------|-------------|
| **Valid** | Path in whitelist AND type matches (or manifest has no type) | Checkbox enabled, checked by default |
| **Type Mismatch** | Path in whitelist BUT type differs from whitelist | Checkbox disabled, shown as "blocked" with mismatch details (e.g., `type mismatch: collection ≠ singleton`) |
| **Invalid** | Path not in whitelist | Checkbox disabled, shown as "not in whitelist" |

This ensures that manifests exported from different API versions (where resource types may have changed) cannot corrupt the target environment by treating a singleton as a collection or vice versa.

---

## Masked Secrets Handling

Several configuration resources contain masked secret fields that return `"********"` from the API. These fields cannot be meaningfully exported or imported and require special handling:

### Affected Resources (in Whitelist)

| Resource | Masked Fields |
|----------|---------------|
| `/v1/config/oauth2` | `privateKeyPem` |
| `/v1/config/gateway-api` | `apiKey` |
| `/v1/config/infrasec` | `enrollmentPassphrase`, `ccuPassphrase` |
| `/v1/config/bankID` | `privateKey` |
| `/v1/config/file-signing` | `secret` |
| `/v1/config/smtp` | `password`, `oauth2ClientSecret` |

### Export Behavior

When exporting resources:
1. The export flow fetches each resource from the API
2. Any field with the value `"********"` is **stripped** from the exported JSON
3. The log shows how many masked fields were omitted (e.g., `[2 masked field(s) omitted]`)
4. The exported file contains all non-secret fields

### Import Behavior

When importing resources:
1. The import flow parses the resource JSON from the zip file
2. Any field with the value `"********"` (if present in old exports) is **stripped** before sending
3. The log shows how many masked fields were skipped (e.g., `[2 masked field(s) skipped]`)
4. Only non-secret fields are PUT to the API

### User Implications

- **After import, secrets must be manually configured** in the target environment
- Affected resources will be imported with all non-secret settings intact
- Users should review imported configuration and add secrets via direct API calls or the UI

---

## EPI Integration Flow (Required Ordering)

EPI integrations and configurations must follow the same setup flow used in seeds:

1. **Create integrations** (payment + shipment) with `identifiers.name` and `baseUrl`.
2. **Create OAuth2 clients/users** for those integrations (manual or separate import step).
3. **Install integrations** via `install` action.
4. **Create EPI configurations** per node with `configuration` payloads.
5. **Run `configure`** on configurations to finalize first-time setup.

Reference seeds:
- `seed/pay/seed-config.json`
- `seed/test-epi-configuration/seed-config.json`

### Implementation Details

The import flow implements this ordering via:

1. **Dependency Order**: `IMPORT_DEPENDENCY_ORDER` places integrations before configurations:
   - `/v1/payment-integrations`
   - `/v1/shipment-integrations`
   - `/v1/epi-integrations`
   - `/v1/epi-configurations` (last)

2. **Post-Import Actions**: After PUT succeeds:
   - **Integrations**: For each item in the collection, call `PUT /{path}/{key}/install` with `{install: true}`
   - **Configurations**: For each item, call `PUT /v1/epi-configurations/{key}/configure` with `{configure: true}`

3. **Action Logging**: Install and configure actions are logged separately with success/failure counts

### OAuth2 Client Prerequisite

OAuth2 client creation is a prerequisite before `install` can succeed. Since `/v1/oauth2-clients` is excluded from the whitelist (contains masked secrets), users must:
- Create OAuth2 clients manually in the target environment before import
- Or use a separate setup step/script to provision clients

### UI Guidance for OAuth2 Setup

The import UI displays a warning banner when any EPI integration resources are selected (`/v1/payment-integrations`, `/v1/shipment-integrations`, `/v1/epi-integrations`). This warning:

- Appears dynamically based on checkbox selection (shows when EPI integrations are checked, hides when unchecked)
- Explains that OAuth2 clients must exist before the `install` action can succeed
- Lists the required manual steps: create OAuth2 clients, configure per-integration auth, notes that `/v1/oauth2-clients` is excluded from export/import
- Uses a warning-styled box (amber/yellow) to draw attention without blocking the flow

---

## Partial Export Handling

When an export fails to fetch some resources (e.g., HTTP errors, permissions issues, unavailable endpoints), the export flow:

1. Continues exporting the remaining resources
2. Includes failed resources in the `manifest.errors` array with error details:

```json
{
  "formatVersion": 1,
  "exportedAt": "2025-01-10T12:34:56.000Z",
  "resources": [ ... ],
  "errors": [
    {
      "path": "/v1/payment-integrations",
      "key": "payment-integrations",
      "error": "HTTP 404: Not Found"
    }
  ]
}
```

### Import Preflight for Partial Exports

When importing a zip with `manifest.errors`:

1. **Manifest Info**: Shows the count of export failures (e.g., `⚠ Export failures: 2 resource(s) failed to export`)
2. **Warning Banner**: Displays a red-styled warning box listing each failed resource with its error message
3. **Resource List**: Only successfully exported resources appear in the selection list (errors are informational only)

This ensures users are aware that the export is incomplete and can take corrective action (e.g., re-export from source, or manually fetch missing resources).

---

## UI Notes

- Add a new tab: **Config Import/Export**.
- Provide two card groups: **Export** and **Import**.
- Use collapsible lists grouped by category (Config API, POS, Integrations, etc.).
- Reuse existing auth state and theme toggles.
- When EPI integration resources are selected for import, display a non-blocking warning banner explaining that OAuth2 clients must be configured before the `install` action can succeed.

### JSZip Library Dependency

The Config Import/Export utility requires the JSZip library (loaded from CDN: `cdnjs.cloudflare.com`) to create and parse zip archives. If the library fails to load due to:

- **Content Security Policy (CSP)** blocking the CDN script
- **Network connectivity issues** to the CDN
- **Browser extensions** blocking external scripts

The UI will:

1. **Display a warning banner** at the top of the Config Import/Export panel explaining the issue and possible causes
2. **Show inline errors** when attempting export or import operations
3. **Log details to the browser console** for debugging
4. **Disable export/import functionality** until the library becomes available

Administrators should whitelist `https://cdnjs.cloudflare.com/ajax/libs/jszip/` in their CSP if zip functionality is required.

---

## Resolved Questions

- **Which admin endpoints are safe?** Users, roles, permissions, and role-assignments are safe. OAuth clients and API key credentials are excluded due to masked secrets.
- **Are any config endpoints returning masked secrets?** Yes, `/v1/oauth2-clients` returns masked secrets. Masked fields must be omitted from export/import.
- **Should export/import include `sales-channels`, `price-rules`, or `sync-webhooks`?**
  - `sales-channels`: **Yes** - included in Retail Config category (defines selling channels)
  - `price-rules`: **No** - excluded (business logic, closer to data than static configuration)
  - `sync-webhooks`: **No** - excluded (environment-specific URLs and tokens)
- **Do any resources require special ordering?** Yes, the import dependency order follows: config singletons → roles/permissions → users/assignments → devices → printers/templates → POS → retail config → payment methods → integrations.

---

## Implementation Status

The Config Import/Export utility is implemented in the API Utils UI (`/api-utils`) and includes:
- Curated whitelist and grouping data structure
- Export zip using JSZip library (CDN)
- Import flow with zip parsing, validation, and ordered execution
- Manifest format handling and versioning
- Error and progress reporting
