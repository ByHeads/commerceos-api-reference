# Working with the Configuration Store: `/v1/context`

This guide covers how an integration reads the configuration an administrator keeps for it and the state it keeps for itself: config panels, key-value stores and EPI configurations, all reached through one root, `/v1/context`. The administrator's side — creating a panel with its schema, creating a store, granting the scopes — is in [Configuration examples](../../guide/examples/configuration.md#config-panels).

---

## Table of Contents

1. [Overview](#overview)
2. [The Context Root](#the-context-root)
3. [Config Panel Values](#config-panel-values)
4. [Key-Value Stores](#key-value-stores)
5. [EPI Configurations](#epi-configurations)
6. [Scopes](#scopes)
7. [Secrets](#secrets)
8. [Placeholders](#placeholders)
9. [Refusals](#refusals)
10. [Endpoint Matrix](#endpoint-matrix)

---

## Overview

Three kinds of configuration live behind `/v1/context`, and each has a name or an id that is its path segment under the root:

| Kind | What it is | Who writes the definition | Reached at |
|---|---|---|---|
| **Config panel** | A named configuration document an administrator keeps for an integration: a type schema and the values that fit it. The back office renders the schema as a form | The administrator, under `/v1/config-panels` with the `config` scope | `/v1/context/<panel>` — the values only |
| **Key-value store** | A named bag of keys with any JSON value and no schema: a sync cursor, a feature flag, the state an integration keeps between calls | The administrator creates the store under `/v1/key-value-stores`; the integration writes the keys | `/v1/context/kv/<store>/<key>` |
| **EPI configuration** | The configuration of a hosted or external payment integration for one node | The administrator, under `/v1/epi-configurations` with the `integrations` scope | `/v1/context/<contextConfigId>` |

A panel's name and a store's name are [namespaced keys](../primitives.md#namespaced-key) — exactly three dot-separated parts, no dash in the first, at most 128 characters — and **one name is a panel or a store, never both**. An EPI configuration's `contextConfigId` is four characters.

The route an integration uses is decided by the scopes on its OAuth2 client or API key: `<name>:read` or `<name>:write` for a panel or a store of that name, `me` for the integration's own EPI configuration, and the two broad administrative scopes `admin:read` (everything, secrets masked) and `admin` (everything, in clear). `read:api` does **not** reach `/v1/context` at all. The full table is under [Scopes](#scopes).

---

## The Context Root

`GET /v1/context` answers an `agent context` for the calling credential:

```bash
curl -H "Authorization: Bearer <token>" "https://example.app.heads.com/api/v1/context"
```
```json
{
  "@type": "agent context",
  "client": { "@type": "http client info", "source": "203.0.113.7", "host": "example.app.heads.com" },
  "kv": { "@type": "context key value stores", "com.example.settings": {} }
}
```

| Member | What it is |
|---|---|
| `client` | The calling HTTP client: its source address and the host it called |
| `webhook` | The running sync webhook, present only while a webhook's request is being resolved. Its `lastStart`, `name`, `attempts` and the rest are what the `{api/v1/context/webhook/…}` template variables read — see [Sync Webhooks → URL Template Variables](../sync-webhooks.md#url-template-variables) |
| `kv` | The key-value stores the caller's scopes reach, by name, each as `{}` — a store never lists its keys |

Config panels and EPI configurations are addressed by name or id directly under the root (`/v1/context/<panel>`, `/v1/context/<contextConfigId>`); the root does not enumerate them. A name the caller's scopes do not reach is a `404` wherever it is asked for, so a missing grant shows up on the first request to the panel or store, not at the token endpoint — read the `scope` of the token response ([Scopes](#scopes)).

---

## Config Panel Values

`GET /v1/context/<panel>` answers **the values only** — the object that is the panel's `configuration` on the administrator's route — with no `@type`, `identifiers`, `title`, `schema`, `configurationType` or `configurationHash`. Secrets are in clear under the panel's own scopes (see [Secrets](#secrets)).

```bash
# The values
curl -H "Authorization: Bearer <token>" "https://example.app.heads.com/api/v1/context/com.example.carrier"
# → { "apiKey": "k-1", "defaultService": "standard", "parcels": [{ "weightKg": 2 }] }

# One value, at any depth
curl -H "Authorization: Bearer <token>" "https://example.app.heads.com/api/v1/context/com.example.carrier/defaultService"
# → "standard"

# An array member is read with the collection operators; ~first of an empty match is 404
curl -H "Authorization: Bearer <token>" "https://example.app.heads.com/api/v1/context/com.example.carrier/warehouses~where(code=9%20-%20EXPO)~first/storeId"
# → "S9"

# Projection applies to the values object like to any document
curl -H "Authorization: Bearer <token>" "https://example.app.heads.com/api/v1/context/com.example.carrier~just(defaultService)"
# → { "defaultService": "standard" }
```

Writes, under `<panel>:write` or `admin`:

```bash
# Replace every value. The body is validated against the panel's schema;
# a member left out is gone, so send all of them or write one member
curl -X PUT -H "Authorization: Bearer <token>" "https://example.app.heads.com/api/v1/context/com.example.carrier" \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "********", "defaultService": "express"}'
# → { "apiKey": "k-1", "defaultService": "express" }   ← ******** kept the stored secret

# Replace one value and leave its siblings alone
curl -X PUT -H "Authorization: Bearer <token>" "https://example.app.heads.com/api/v1/context/com.example.carrier/defaultService" \
  -H "Content-Type: application/json" \
  -d '"pickup"'
```

- `PUT` and `PATCH` at the top do the same thing: **replace every value**. A member the body leaves out is gone, a `requiredOnCreate` member that is missing is `400 Missing required config panel member '<member>'`, and a value outside its declared type is `400 failed coercion` naming the member.
- A write at `/<member>` replaces that value and keeps its siblings. `DELETE` or `null` removes an optional member's value.
- A write carrying `********` where a `secret` member is expected keeps the stored secret, so a client can read the values back and write them again without knowing the secret.
- `schema`, `configurationType`, `title` and `documentationUrl` are the administrator's members and have no place on this route: a body that carries them is read as values and refused by the schema (`400`). The administrator's full element is at `/v1/config-panels/<name>` ([Configuration examples → Config Panels](../../guide/examples/configuration.md#config-panels)).
- `DELETE /v1/context/<panel>` is `403 Panel scopes cannot create or delete panels`: the panel is the administrator's, whatever the caller's scope.
- A name no panel has is `404 No config panel is named <name>`. A store's name at the root answers the same: stores are under `kv` ([below](#key-value-stores)).
- A panel whose values have never been written answers `{}`.

---

## Key-Value Stores

A store holds keys with any JSON value, no schema, each key written and read apart from the others. The route is `/v1/context/kv/<store>/<key>`; sub-paths of a value are addressable.

```bash
# The stores the caller reaches
curl -H "Authorization: Bearer <token>" "https://example.app.heads.com/api/v1/context/kv"
# → { "@type": "context key value stores", "com.example.settings": {} }

# A store never lists its keys: keep your own index
curl -H "Authorization: Bearer <token>" "https://example.app.heads.com/api/v1/context/kv/com.example.settings"
# → {}

# Store a document. The answer echoes the body
curl -X PUT -H "Authorization: Bearer <token>" "https://example.app.heads.com/api/v1/context/kv/com.example.settings/cursor" \
  -H "Content-Type: application/json" \
  -d '{"since": "2026-10-16T00:00:00Z", "nested": {"a": "b"}}'

# Read it back, whole or one sub-path
curl -H "Authorization: Bearer <token>" "https://example.app.heads.com/api/v1/context/kv/com.example.settings/cursor"
curl -H "Authorization: Bearer <token>" "https://example.app.heads.com/api/v1/context/kv/com.example.settings/cursor/nested/a"
# → "b"

# A write replaces what is at the path — nothing merges. PATCH does the same as PUT
curl -X PATCH -H "Authorization: Bearer <token>" "https://example.app.heads.com/api/v1/context/kv/com.example.settings/cursor" \
  -H "Content-Type: application/json" \
  -d '{"m": 2}'
# → { "m": 2 }   and the document now is exactly that

# Delete: DELETE, or PUT with a body of null. A key never written, or deleted, reads 200 null
curl -X DELETE -H "Authorization: Bearer <token>" "https://example.app.heads.com/api/v1/context/kv/com.example.settings/cursor"
curl -H "Authorization: Bearer <token>" "https://example.app.heads.com/api/v1/context/kv/com.example.settings/cursor"
# → null
```

- **A write replaces what is at the path.** To change one field, write that field's own leaf.
- **Keys are never listed.** `GET /v1/context/kv/<store>` is `{}` whatever the store holds.
- **`/v1/context/<store>/…` is `404`.** A namespaced key directly under the root is a panel's name only; the answer is `No config panel is named <store>`.
- **A store scope cannot create or delete the store.** `DELETE /v1/context/kv/<store>` is `403 Store scopes cannot create or delete stores`; `PUT /v1/context/kv/<new-name>` is `404`; `/v1/key-value-stores` and `/v1/config-panels` are `404` for it. A store nobody has created yet is `404` on every key, whatever scope the client holds — the administrator creates it ([Configuration examples → Key-Value Stores](../../guide/examples/configuration.md#key-value-stores)), or an EPI install does, for each `<name>:write` scope the integration's client holds where no panel or store has the name.
- **A read scope cannot write.** `<store>:read` answers a write with `403 This key-value store is read-only`.
- In a store document the write envelope keys `@value`, `@if` and `@resolveValue` are data, not directives — see [Resource Patterns](../resource-patterns.md#not-envelope-positions).

---

## EPI Configurations

A payment integration reads its own configuration at `GET /v1/context/<contextConfigId>` with its own token (scope `me`), and an administrator's `admin` or `admin:read` credential reads any. The answer is the **EPI configuration element**: `identifiers` (with `contextConfigId`), `integration`, `node`, `configuration`, `configurationHash`, `schema` and `configurationType`.

```bash
curl -H "Authorization: Bearer <token>" "https://example.app.heads.com/api/v1/context/Ab_9"
```
```json
{
  "@type": "EPI configuration",
  "identifiers": { "@type": "EPI configuration identifiers", "key": "…", "contextConfigId": "Ab_9" },
  "integration": { "…": "…" },
  "node": { "…": "…" },
  "configuration": { "merchantId": "m-1", "apiKey": "k-1" },
  "configurationHash": "tEEJCjTFLcZGeeTO3nsYt_HPadK11elfulR-AOlRtfo",
  "schema": { "…": "…" },
  "configurationType": "piggy configuration"
}
```

- `configuration` is in clear for the integration that owns it and under `admin`; masked under `admin:read`. `configurationHash` is in the default answer and is the value CommerceOS sends as `X-EPI-Context-Config-Hash`; compare the two before re-reading.
- The owning integration and `admin` write `configuration` there, **whole**: `PUT …/configuration` with the complete object (a `********` keeps the stored secret). A member left out is gone.
- Creating, deleting or reassigning a configuration on this route is `403 Context scopes cannot create, delete or reassign EPI configurations`; that stays with the `integrations` scope on `/v1/epi-configurations`.
- Another integration's id is `404`. `/v1/context/config` and `/v1/context/config/<id>` are `404`.

The lifecycle around it — the schema the integration declares, install, configure — is in [Build a payment integration](../../guide/examples/payment-epi.md).

---

## Scopes

| Scope | Reaches under `/v1/context` | Creates or deletes a panel or store |
|---|---|---|
| `<name>:read` | The panel or store named `<name>`, read-only. A panel's secrets in clear. A write is `403 This config panel is read-only` / `403 This key-value store is read-only` | No |
| `<name>:write` | The same, read and write. Reads in clear | No (`403 Panel scopes cannot create or delete panels`, `403 Store scopes cannot create or delete stores`) |
| `me` | The integration's own EPI configuration, in clear and writable | No |
| `admin:read` | Every panel and store, read-only, **secrets masked `********`**; every EPI configuration masked | No. `/v1/config-panels` and `/v1/key-value-stores` are `404` |
| `admin` (part of `write:api`) | Every panel, store and EPI configuration, in clear, read and write | No — that stays with `config` |
| `config` | Nothing under `/v1/context` on its own; the administrator's routes `/v1/config-panels` and `/v1/key-value-stores` | Yes |
| `read:api` | **Nothing** — `/v1/context` is `404` | No |

`<name>` is the panel's or store's name: a namespaced key of exactly three dot-separated parts, no dash in the first, at most 128 characters. The scope names are listed by the token endpoint like any other, and an administrator grants them on the integration's OAuth2 client or API key ([Credentials](../credentials.md)).

**A client-credentials token carries only the scopes its client holds.** The token endpoint narrows the request to them and the response's `scope` says what was granted:

| `scope` in the token request | Answer |
|---|---|
| `me com.example.settings:write` on a client that holds both | `200`, `"scope": "me com.example.settings:write"` |
| `me com.example.other:write` — a scope the client lacks | `200`, `"scope": "me"` — dropped silently; the first request to the store is `404` |
| `com.example.other:write` only | `200`, `"scope": ""` — and the API answers `401` to that token |
| none | `200` with every scope the client holds |
| `me kv` | `400 invalid_scope`, `"error_details": "Check the \`kv\` scope(s)"` — there is no `kv` scope |
| a name outside the catalogue | `400 invalid_scope` naming it |

So read `scope` in the token response and treat a missing store or panel scope as a configuration error. There is no `/v1/kv` (`404`).

---

## Secrets

A panel member typed `secret`, and a member of an EPI configuration the schema types `secret`, is stored by CommerceOS and shown back according to the caller:

| Caller | Reads |
|---|---|
| `<panel>:read`, `<panel>:write`, `admin`; the integration that owns an EPI configuration | The value in clear |
| `admin:read` | `********` |
| The administrator's routes `/v1/config-panels` and `/v1/epi-configurations`, under any scope | `********` |

A write that sends `********` back keeps the stored secret, on every route. A sync webhook that names a panel member as a credential must read the panel **in clear**: under `admin:read` alone the run stops with a configuration error instead of sending `********` — see [Sync Webhooks → Configuration for a webhook](../sync-webhooks.md#configuration-for-a-webhook-config-panels).

---

## Placeholders

`{<panel>/<member>}` anywhere in a request path, an operator argument, a `/v1/new` template, a sync webhook URL template, body selector or `then.set` target reads the member under the caller's scopes and substitutes it before the URL is parsed. It is shorthand for `{api/v1/context/<panel>/<member>}` — the same path as the route. There is no `/configuration/` segment in it.

```bash
# As a value
curl -g -H "Authorization: Bearer <token>" "https://example.app.heads.com/api/v1/new~with(region:'{com.example.carrier/defaultService}')"
# → { "region": "standard" }

# The long form, the same
curl -g -H "Authorization: Bearer <token>" "https://example.app.heads.com/api/v1/new~with(region:'{api/v1/context/com.example.carrier/defaultService}')"

# Percent-encoded braces are accepted, which is what most URL libraries send
curl -H "Authorization: Bearer <token>" "https://example.app.heads.com/api/v1/new~with(region:'%7Bcom.example.carrier/defaultService%7D')"
```

| Case | Resolves to |
|---|---|
| The member exists and the scopes reach the panel | Its value |
| The member does not exist, or the scopes do not reach the panel | The text `null` — the request goes on |
| `{<panel>/<member>!}` — strict — and the member resolves to nothing | `400 Placeholder {<panel>/<member>} resolved to nothing (strict)` |
| A `secret` member under `admin:read` alone | `********` — a URL template still interpolates the mask |
| A `secret` member under the panel's own scope or `admin` | The value in clear |

A `receive` reference on a sync webhook (`pathToken`, `verification.secret`) and the credential members of `auth` keep the bare `<panel>/<member>` form without braces — see [Sync Webhooks](../sync-webhooks.md#configuration-for-a-webhook-config-panels).

---

## Refusals

| Request | Answer |
|---|---|
| `GET /v1/context` under `read:api` | `404` |
| `GET /v1/context/<name>`, no panel of that name | `404 No config panel is named <name>` — a store's name answers this too |
| `GET /v1/context/<panel>` under a scope that does not reach it | `404` |
| `GET /v1/context/kv/<store>/<key>`, a store the scopes do not reach or nobody created | `404` |
| A write under `<panel>:read` / `admin:read` | `403 This config panel is read-only`, `authorizedScopes: ["<panel>:write"]` |
| A write under `<store>:read` / `admin:read` | `403 This key-value store is read-only`, `authorizedScopes: ["<store>:write"]` |
| `DELETE /v1/context/<panel>` | `403 Panel scopes cannot create or delete panels`, `authorizedScopes: ["config"]` |
| `DELETE /v1/context/kv/<store>` | `403 Store scopes cannot create or delete stores`, `authorizedScopes: ["config"]` |
| `PUT /v1/context/<panel>` leaving out a required member | `400 Missing required config panel member '<member>'` |
| `PUT /v1/context/<panel>/<member>` with a value outside its type | `400 failed coercion` naming the member |
| `DELETE /v1/context/<contextConfigId>`, or a write of its `node` or `integration` | `403 Context scopes cannot create, delete or reassign EPI configurations` |
| `/v1/context/config/<id>`, `/v1/kv/…` | `404` |
| A token request naming `kv` | `400 invalid_scope` |

---

## Endpoint Matrix

| Need | Method | Path | Scope |
|---|---|---|---|
| The root | GET | `/v1/context` | any scope that reaches something under it |
| A panel's values | GET | `/v1/context/<panel>` | `<panel>:read`, `<panel>:write`, `admin:read` (masked), `admin` |
| One value | GET | `/v1/context/<panel>/<member>[/<path>]` | same |
| Replace every value | PUT, PATCH | `/v1/context/<panel>` | `<panel>:write`, `admin` |
| Replace or remove one value | PUT, PATCH, DELETE | `/v1/context/<panel>/<member>` | same |
| The stores reached | GET | `/v1/context/kv` | any store scope, `admin:read`, `admin` |
| A key | GET | `/v1/context/kv/<store>/<key>[/<path>]` | `<store>:read`, `<store>:write`, `admin:read`, `admin` |
| Write, delete a key | PUT, PATCH, DELETE | `/v1/context/kv/<store>/<key>[/<path>]` | `<store>:write`, `admin` |
| An EPI configuration | GET | `/v1/context/<contextConfigId>` | `me` (own), `admin:read` (masked), `admin` |
| Write its configuration | PUT | `/v1/context/<contextConfigId>/configuration` | `me` (own), `admin` |
| Create, delete a panel or store | — | — | Not here: `/v1/config-panels`, `/v1/key-value-stores` under `config` |

Related: [Configuration examples → Config Panels](../../guide/examples/configuration.md#config-panels), [Key-Value Stores](../../guide/examples/configuration.md#key-value-stores), [Sync Webhooks](../sync-webhooks.md), [Build a payment integration](../../guide/examples/payment-epi.md), [Credentials → Scope names](../credentials.md#scope-names), [Overview → Scope map](../overview.md#scope-map-concepts-not-endpoints).
