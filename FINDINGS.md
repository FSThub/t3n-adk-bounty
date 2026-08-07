# T3N ADK — Findings Log

Environment: Windows 11, Node v22.21.1, npm 10.9.4, `@terminal3/t3n-sdk@4.30.0`,
Rust 1.97.1 (`x86_64-pc-windows-gnu` host, target `wasm32-wasip2`), `setEnvironment("testnet")`.

---

## 1. Critical vulnerability in the SDK dependency tree

`npm audit` reports 4 vulnerabilities (1 critical, 3 moderate) on a clean install of
`@terminal3/t3n-sdk` alone. The critical one is `decompress@4.2.1`, reached only through the
SDK:

```
@terminal3/t3n-sdk@4.30.0
`-- @bytecodealliance/jco@1.27.0
  `-- @bytecodealliance/componentize-js@0.22.0
    `-- @bytecodealliance/weval@0.4.1
      `-- decompress@4.2.1
```

Reproduce:

```
npm init -y && npm pkg set type=module
npm install @terminal3/t3n-sdk
npm audit
```

Impact: every new developer following the Quickstart starts with a critical advisory.
Suggested fix: bump `@bytecodealliance/jco`, or pin an override for `decompress`.

## 2. Quickstart states the wrong default environment

The Quickstart says the SDK "defaults to production — set this explicitly".

The shipped types say the opposite. `dist/index.d.ts` around the `DEFAULT_ENVIRONMENT`
declaration:

> Default environment for the public (@terminal3/t3n-sdk) artifact. External consumers
> default to testnet (not production) — a safer default [...]

One of the two is wrong. If the code is right, the docs scare developers about a risk that
does not exist; if the docs are right, the published types are misleading. Either way a
developer cannot tell which environment they are hitting without reading `dist/`.

## 3. Quickstart has no Windows instructions

The Quickstart sets the key with `export T3N_API_KEY="..."`, which is bash-only. On Windows
(PowerShell) this fails silently in the sense that `process.env.T3N_API_KEY` is simply
`undefined`, and the sample then calls `eth_get_address(undefined!)` because the sample uses
a non-null assertion (`process.env.T3N_API_KEY!`) instead of a guard.

Suggested fix: use a `.env` file plus `process.loadEnvFile()` (Node 20.12+/22+) in the sample,
and replace the `!` assertion with an explicit check and a readable error.

## 4. Third-party report: endpoints unreachable

Another participant reported on the bounty listing (approx. 3h before this test) that the
signup and docs links returned `ERR_CONNECTION_REFUSED`. At the time of this test the
following were all reachable: the product/claim page, the Quickstart, and the Walkthrough.
Noted as a possible intermittent availability issue rather than a confirmed defect.

## 5. The Quickstart sample cannot run as published — required field omitted

`T3nClientConfig.trustAnchor` is documented in the shipped types as **Required**:

> **Required.** Client-pinned trust anchor the node's DKG attestation is verified against
> before the handshake trusts its ML-KEM key (SP-003). [...] It is a required field precisely
> so no caller can omit it by accident.

The Quickstart's `new T3nClient({ wasmComponent, handlers })` omits it. Copy-pasting the
sample verbatim therefore fails at `handshake()` with:

```
TypeError: Cannot read properties of undefined (reading 'unsafe_trust_server')
```

The sample is the first thing a new developer runs, and it is broken. Suggested fix: add
`trustAnchor` to the Quickstart snippet.

The same defect is on the public product page (`terminal3.io/products/agent-developer-kit`),
whose "From signup to first protected action in 5 minutes" snippet also constructs
`new T3nClient({ wasmComponent, handlers })` with no `trustAnchor`. That page additionally
calls `setEnvironment("sandbox")` while the Quickstart calls `setEnvironment("testnet")`, with
nothing explaining which a new developer should pick — see also finding 2.

## 6. Missing required config surfaces as a cryptic TypeError, and the stack is unreadable

Two problems compound finding 5:

**a. No runtime guard.** `trustAnchor` is enforced only by TypeScript. When it is absent at
runtime the SDK dereferences it anyway, deep inside the handshake, producing a `TypeError`
that names an internal field (`unsafe_trust_server`) rather than the missing config key. A
constructor-time check — `trustAnchor is required; pass a TrustAnchor or { unsafe_trust_server: true }`
— would turn a 20-minute debugging session into a one-line fix.

**b. Obfuscated bundle destroys stack traces.** `dist/index.esm.js` is shipped minified *and*
name-mangled (`_0x18ca94` style). An uncaught error prints roughly 20,000 characters of
mangled source to the terminal, and the actual message scrolls off screen entirely. The only
way to read the error is to wrap every call in `try/catch` and print `err.message` by hand —
see `quickstart.ts` in this repo. Shipping a source map, or simply not obfuscating a client
SDK, would fix this.

## 7. `fetchTrustedManifest()` is broken — SDK sends GET, server accepts only POST

This is the security-relevant one.

`fetchTrustedManifest(env)` is the SDK's only supported way to obtain a real `TrustAnchor`
instead of the `unsafe_trust_server` escape hatch. On testnet it fails:

```
Trust manifest request to https://cn-api.sg.testnet.t3n.terminal3.io/api/trust-manifest
failed: 405 Method Not Allowed
```

Probing the endpoint directly shows a plain method mismatch — the server explicitly
advertises `Allow: POST`, while the SDK issues a GET:

| Method  | Status                 | `Allow` header |
|---------|------------------------|----------------|
| GET     | 405 Method Not Allowed | `POST`         |
| HEAD    | 405 Method Not Allowed | `POST`         |
| OPTIONS | 200 OK                 | `POST`         |
| POST    | 400 Bad Request        | —              |

(`POST` with `{}` and with a JSON-RPC envelope both return 400 with an empty body, so the
expected request shape is undocumented as well.)

Impact: because the secure path is unavailable, every developer on testnet today is pushed
onto `{ unsafe_trust_server: true }` — which the SDK's own documentation describes as the
condition where "a network attacker with their own TDX VM can hand the SDK a
forged-but-valid attestation for a key it controls and read every session." The careful
design intent of SP-003 (making the bypass a visible, grep-able choice) is defeated in
practice, because the bypass is currently the *only* choice that works.

Suggested fix: correct the HTTP method in `fetchTrustedManifest`, or make the endpoint accept
GET; and document the POST body shape. Until then, the 400-on-empty-body means the endpoint
cannot be used manually as a workaround either.

## 8. `z-tenant-flight` README: the documented test command fails out of the box

The README says:

```bash
cargo test --lib
```

Run verbatim in a fresh clone, this fails:

```
Running unittests src\lib.rs (target\wasm32-wasip2\debug\deps\z_tenant_flight-….wasm)
error: test failed, to rerun pass `--lib`
Caused by: could not execute process …z_tenant_flight-….wasm (never executed)
Caused by: %1 is not a valid Win32 application. (os error 193)
```

Cause: `.cargo/config.toml` pins `[build] target = "wasm32-wasip2"` for the whole workspace, so
`cargo test` compiles the unit tests to WASM and then tries to execute the `.wasm` as a native
binary. The tests themselves are fine — forcing the host triple runs all 7 green:

```
cargo test --lib --target x86_64-pc-windows-gnu
test result: ok. 7 passed; 0 failed
```

Suggested fix: document the host-target form in the README, or scope the pinned target so it
does not apply to test profiles. (`cargo clippy --all-targets -- -D warnings`, the other
documented command, passes clean as written.)

## 9. `z-tenant-flight` states three different versions

| Source | Version |
|---|---|
| `README.md` line 3 | `v0.3.0` |
| `src/lib.rs` line 1 (doc comment) | `v0.4.0` |
| `Cargo.toml` + `CONTRACT_VERSION` | `0.4.1` |

Relatedly, the test asserting the constant is named `contract_version_is_v0_4_0` but asserts
`"0.4.1"` — the name was not updated with the bump. For a contract whose version is registered
on-chain, three disagreeing sources of truth is a real hazard.

## 10. The Walkthrough is five pages, but page 1 dead-ends

`/developers/adk/get-started/walkthrough` renders "1. Write your TEE contract" and contains
**no forward navigation** — no "next" link, no sidebar, no breadcrumb, and no reference to the
four pages that follow it:

```
walkthrough/write-contract     ← what /walkthrough serves
walkthrough/build-contract
walkthrough/register-contract
walkthrough/invoke-contract
walkthrough/test
```

Following the bounty instruction "complete Quickstart and Walkthrough in Docs" literally, a
participant reads page 1, builds the contract, and has no way to discover that registration,
invocation, and testing exist. The full list is only reachable via `llms.txt` — a file aimed
at AI crawlers, not humans.

Suggested fix: add next/previous links, or link the step list from the walkthrough landing page.

## 11. `set-up-dev-env`: `tenant.me()` does not exist

The documented sample:

```typescript
await tenant.me(); // validates authentication
```

fails on a copy-paste:

```
TypeError: tenant.me is not a function
```

`me()` is defined on the `tenant` **namespace**, not on the client, so the working call is:

```typescript
await tenant.tenant.me();
```

(`TenantClient` exposes four namespaces — `tenant`, `maps`, `contracts`, `token`.) Same class
of defect as finding 5: the first sample on the page cannot run as written.

Minor, on the same page: `register-contract` rebuilds the canonical name by hand —

```typescript
const scriptName = `z:${tenantDid.slice("did:t3n:".length)}:${CONTRACT_TAIL}`;
```

— but `ContractRegisterResult` already returns `name`, and `TenantClient` exposes
`canonicalName(tail)`. Teaching the manual string build invites drift if the format changes.

## 12. `z-tenant-flight`: the documented error-forwarding invariant holds on only one of the two paths

The README states the guarantee unconditionally:

> Error responses from Duffel are logged inside the TEE and never forwarded to the caller.

`book-offer` honours it. `src/booking.rs` logs the upstream body inside the enclave and returns
the status code alone:

```rust
let _ = logging::error(&alloc::format!(
    "Duffel create-order HTTP {}: {}", resp.code,
    alloc::string::String::from_utf8_lossy(&resp.payload)
));
return Err(alloc::format!("Duffel create-order failed: HTTP {}", resp.code));
```

`search-offers` does the opposite. `src/search.rs` interpolates the **entire upstream body**
into the error that crosses the WIT boundary:

```rust
let body = alloc::string::String::from_utf8_lossy(&offer_req_resp.payload);
return Err(alloc::format!("Duffel offer-request failed: HTTP {} — {body}", offer_req_resp.code));
```

Observed against testnet, contract `z:f49412c2…:travel-contracts` id 501 — the caller receives
Duffel's full JSON, including an upstream correlation id:

```
RPC Error: contract error: Duffel offer-request failed: HTTP 401 —
{"errors":[{"documentation_url":"…","title":"Access token not found",
"type":"authentication_error","code":"access_token_not_found"}],
"meta":{"request_id":"GMmaS4jQ8eTGEZkAPXYJ","status":401}}
```

`search-offers` takes no PII, so this specific call leaks no passenger data. The problem is
that the invariant is stated as a property of the contract while being enforced on one path
only, in the file *next to* the one that gets it right — and this is the reference
implementation developers are told to copy. Anyone following the `search.rs` pattern on a path
that does carry PII inherits a leak, and the README will tell them they are safe.

Suggested fix: apply the `booking.rs` log-inside/return-code-only treatment in `search.rs`, or
scope the README sentence to `book-offer` explicitly.

## 13. Re-registering a contract mints a new id and silently breaks every KV ACL pinned to the old one

Found by accident while re-capturing a registration transcript, then reproduced deliberately.

`create-kv-maps` teaches ACLs written against a contract id:

```typescript
await tenant.maps.create({
  tail: "secrets",
  visibility: "private",
  writers: { only: [contractId] },
  readers: { only: [contractId] },
});
```

Nothing on that page, or on `register-contract`, says that `contract_id` changes on
**every** registration — including a version bump of the same tail. Observed:

| Registration | Result |
|---|---|
| `travel-contracts` v0.1.0 | contract id **501** |
| `travel-contracts` v0.1.1 (same tail, same wasm) | contract id **502** |

The map ACL still named 501. The bump therefore produced a contract that authenticates, passes
`agent-auth-update`, executes inside the enclave — and then dies at the KV read:

```
RPC Error: contract error: kv read: kv_store.get on 'z:f49412c2…:secrets' read denied:
access denied: TenantContract(did:t3n:f49412c2…/502) cannot read map "z:f49412c2…:secrets"
```

The failure mode is the bad one: nothing fails at deploy time. Registration succeeds, the
grant succeeds, and the break only surfaces at runtime on the first call that touches a
secret. On a production tenant that is a version bump that looks clean and takes the contract
down.

Confirmed as the cause by widening the ACL to `{ only: [501, 502] }` — the same invocation
then reaches Duffel and returns the expected upstream `401`.

Suggested fix: say plainly on `register-contract` that each registration mints a new id and
that map ACLs must be updated alongside; or let ACLs be expressed against a tail rather than a
numeric id, so they survive version bumps.

Minor, same area: `seed-api-key` teaches the low-level control call —

```typescript
await tenant.executeControl("map-entry-set", { map_name: …, key: …, value: … });
```

— while `TenantMapsNamespace` already exposes the typed `tenant.maps.entrySet(tail, key, value)`.
The typed helper is the better thing to teach.

---

## Environment note (not a defect)

The ADK docs give no Windows prerequisites. On a clean Windows 11 machine with Visual Studio
Community 2022 but **without** the C++ workload, the default `x86_64-pc-windows-msvc` Rust host
has no linker. Installing the GNU host instead avoids a multi-GB Visual Studio component:

```bash
rustup-init.exe -y --default-host x86_64-pc-windows-gnu
```

Worth a line in the docs, since the Walkthrough's audience is explicitly told no prior Rust
experience is needed.

One consequence: the build page's `cargo install wasm-tools` does not work on the GNU host —
the `windows-sys` crate needs `dlltool.exe`, which rustup's GNU toolchain does not ship:

```
error: error calling dlltool 'dlltool.exe': program not found
error: could not compile `windows-sys`
```

Prebuilt `wasm-tools` binaries are published on GitHub releases, so the documented
`cargo install` is avoidable — but on Windows it is a dead end either way without extra setup.

---

## Verification status

- [x] Toolchain check
- [x] Project scaffold + SDK install
- [x] Quickstart script written and symbols verified against `dist/index.d.ts`
- [x] Quickstart executed against testnet — **authenticated successfully**
      (`did:t3n:f49412c2…`, node `cn-api.sg.testnet.t3n.terminal3.io`)
- [x] Rust toolchain installed (1.97.1, GNU host, targets `wasm32-wasip2` + `wasm32-wasip1`)
- [x] `z-tenant-flight` reference contract cloned and **built successfully** —
      `target/wasm32-wasip2/release/z_tenant_flight.wasm`, 193.4 KB, header
      `00 61 73 6d 0d 00 01 00` (valid WASM **component**, not a bare module)
- [x] Native test suite green (7/7) and `clippy -D warnings` clean
- [x] Contract **registered on testnet** — `z:f49412c2…:travel-contracts`. Four registrations
      (v0.1.0–v0.1.3) minted ids `501`–`504`; current deployment is v0.1.3 / id `504`.
      See finding 13 for why the id moves.
- [x] Walkthrough step 4 (invoke) — self-grant applied via `agent-auth-update`, contract
      executed in the TEE, secret read from KV, outbound HTTP reached `api.duffel.com`.
      Terminal state is Duffel's own `401` on the placeholder token (no Duffel account here).
- [x] Walkthrough step 5 (test) — 7/7 native tests green; see finding 8 for the command
- [ ] Own contract written (going beyond the reference — judged as bonus)
- [ ] `wasm-tools component wit` verification (blocked, see environment note)
