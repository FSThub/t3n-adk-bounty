# T3N ADK Bounty Submission

**Bounty:** Create Agent ID, claim free tokens, & deploy first RUST contract on the network
**Sponsor:** LOL ventures
**Agent ID (DID):** `did:t3n:f49412c299be54937e42e5ea3f69ca2ff3d6ddc5`
**Registered contract:** `z:f49412c299be54937e42e5ea3f69ca2ff3d6ddc5:travel-contracts` — contract id **501**
**GitHub repo:** `<PASTE PUBLIC REPO URL HERE>`

---

## 1. What was completed

All of the Quickstart and all five Walkthrough steps, on Windows 11.

| Step | Outcome |
|---|---|
| Quickstart | Authenticated to testnet |
| 1. Write contract | Reference implementation `z-tenant-flight` cloned |
| 2. Build contract | `z_tenant_flight.wasm` — 193.4 KB, header `00 61 73 6d 0d 00 01 00` (valid WASM component, not a bare module) |
| 3. Register contract | Registered as contract id 501 |
| 4. Invoke contract | Grant applied, contract executed inside the TEE, KV secret read, outbound HTTP reached `api.duffel.com` |
| 5. Test contract | 7/7 native tests green; `clippy -D warnings` clean |

Step 4 ends at Duffel's own `HTTP 401`, because no Duffel account was available and a
placeholder token was seeded. Every T3N-side link in the chain — authentication, agent grant,
enclave execution, KV read, egress — is exercised and passing. Supplying a real
`DUFFEL_API_KEY` is the only thing between this and a completed booking.

> **[SCREENSHOT 1]** — the claim-page success screen showing the Agent ID / DID (redact the API key)

> **[SCREENSHOT 2]** — terminal output of `npm run quickstart` showing `Connected as: did:t3n:f494…`

> **[SCREENSHOT 3]** — terminal output of `npm run register` showing `Registered z:… as contract id 501`

> **[SCREENSHOT 4]** — terminal output of `npm run invoke` showing the grant applied and the Duffel 401

> **[SCREENSHOT 5]** — `cargo test --lib --target x86_64-pc-windows-gnu` showing 7 passed

---

## 2. Environment

Windows 11 · Node v22.21.1 · `@terminal3/t3n-sdk@4.30.0` · Rust 1.97.1
(`x86_64-pc-windows-gnu` host, target `wasm32-wasip2`) · `setEnvironment("testnet")` ·
node `cn-api.sg.testnet.t3n.terminal3.io`

---

## 3. Bugs found

12 findings, all reproduced. Full detail with code excerpts and repro steps is in
`FINDINGS.md` in the repo. Ranked by what I would fix first.

### High — worth fixing before more developers onboard

**A. `fetchTrustedManifest()` is broken, and the failure pushes everyone into the unsafe mode.**
It is the SDK's only supported way to get a real trust anchor. On testnet it returns
`405 Method Not Allowed`. Probing the endpoint shows a plain method mismatch — the server
advertises `Allow: POST`, the SDK sends `GET`:

| Method | Status | `Allow` |
|---|---|---|
| GET | 405 | `POST` |
| HEAD | 405 | `POST` |
| OPTIONS | 200 | `POST` |
| POST | 400 | — |

Because the secure path is unavailable, every developer on testnet today falls back to
`{ unsafe_trust_server: true }` — which your own type docs describe as the condition where
"a network attacker with their own TDX VM can hand the SDK a forged-but-valid attestation for
a key it controls and read every session." SP-003's design intent, that bypassing verification
must be a visible deliberate choice, is defeated when the bypass is the only thing that works.

**B. The reference contract's documented privacy guarantee holds on only one of its two paths.**
`z-tenant-flight`'s README states, without qualification, that Duffel error responses are
"logged inside the TEE and never forwarded to the caller." `book-offer` honours this — it logs
the body inside the enclave and returns only a status code. `search-offers`, in the file next
to it, interpolates the **entire upstream body** into the error that crosses the WIT boundary.
Observed live:

```
RPC Error: contract error: Duffel offer-request failed: HTTP 401 —
{"errors":[{...,"code":"access_token_not_found"}],"meta":{"request_id":"GMmaS4jQ8eTGEZkAPXYJ",...}}
```

`search-offers` takes no PII, so this call leaks no passenger data. The risk is that this is
the reference implementation developers are told to copy: anyone reusing the `search.rs`
pattern on a path that *does* carry PII inherits a leak, and the README tells them they are safe.

**C. The Quickstart sample cannot run as published.** `T3nClientConfig.trustAnchor` is marked
**Required** in the shipped types, but the Quickstart's `new T3nClient({ wasmComponent, handlers })`
omits it. Copy-pasting fails at `handshake()` with
`TypeError: Cannot read properties of undefined (reading 'unsafe_trust_server')`.

**D. The Walkthrough is five pages and page 1 dead-ends.** `/walkthrough` serves
"1. Write your TEE contract" with no next link, no sidebar, no step list. Pages 2–5 (build,
register, invoke, test) are discoverable only through `llms.txt`, a file aimed at AI crawlers.
A participant following the bounty instruction literally builds the contract and never learns
that registration and invocation exist.

**E. Critical advisory on a clean install.** `npm install @terminal3/t3n-sdk` alone yields
4 vulnerabilities, 1 critical: `decompress@4.2.1`, reached only through
`t3n-sdk → jco → componentize-js → weval`.

### Medium

**F. `tenant.me()` does not exist.** The `set-up-dev-env` sample fails with
`TypeError: tenant.me is not a function`; `me()` lives on the `tenant` namespace, so the working
call is `tenant.tenant.me()`. Third page in a row whose first sample cannot run.

**G. Missing required config produces an unreadable failure.** `trustAnchor` is enforced only
by TypeScript — no constructor-time check — so the error surfaces deep in the handshake naming
an internal field rather than the missing key. Compounding it, `dist/index.esm.js` ships
minified *and* name-mangled, so an uncaught throw prints ~20,000 characters of scrambled source
and the actual message scrolls off screen. Every call had to be wrapped in `try/catch` to read
errors at all.

**H. Quickstart states the wrong default environment.** The page says the SDK "defaults to
production — set this explicitly." The shipped types say the public artifact defaults to
*testnet*. One of the two is wrong.

**I. Quickstart is bash-only.** It sets the key with `export T3N_API_KEY=...`. On Windows this
leaves the variable undefined, and the sample's non-null assertion (`process.env.T3N_API_KEY!`)
turns that into a confusing downstream failure instead of a clear message.

**J. The documented test command fails out of the box.** `z-tenant-flight`'s README says
`cargo test --lib`; `.cargo/config.toml` pins `build.target = wasm32-wasip2`, so tests compile
to WASM and cannot execute natively (`os error 193`). Forcing the host triple runs all 7 green.

### Low

**K. Three conflicting versions in one crate.** README says `v0.3.0`, `src/lib.rs` says
`v0.4.0`, `Cargo.toml` and `CONTRACT_VERSION` say `0.4.1`. The test asserting the constant is
named `contract_version_is_v0_4_0` but asserts `"0.4.1"`. For a contract whose version is
registered on chain, three disagreeing sources of truth is a hazard.

**L. Another participant reported all endpoints returning `ERR_CONNECTION_REFUSED`** roughly
three hours before this run. Everything was reachable during my test, so I log it as possible
intermittent availability rather than a confirmed defect.

### Undocumented prerequisites worth adding

- **No Windows guidance anywhere.** On a clean Windows 11 box with Visual Studio Community 2022
  but no C++ workload, the default MSVC Rust host has no linker. Installing the GNU host
  (`rustup-init.exe -y --default-host x86_64-pc-windows-gnu`) avoids a multi-GB Visual Studio
  component. Worth a line, since the Walkthrough tells readers no prior Rust experience is needed.
- **`cargo install wasm-tools` fails on the GNU host** — `windows-sys` needs `dlltool.exe`,
  which rustup's GNU toolchain does not ship. Prebuilt binaries sidestep it.
- **Step 4 has two prerequisites it does not mention.** The `secrets` KV map must exist with an
  ACL naming the contract id, and the API key must be seeded, before `search-offers` will run.
  Without them the call fails `access denied: TenantContract(...) cannot read map`. Both are
  covered on separate *Tips* pages that the invoke page never links to.

---

## 4. Use case suggestion

The privacy primitive that makes T3N interesting here is that the enclave can hold a
credential the caller never sees, and place PII into an outbound request without the agent
ever handling it. The flight demo shows it, but a sharper fit is **agent-driven KYC reuse**:
a user verifies identity once, and thereafter any agent can prove specific attributes
("over 18", "resident of Indonesia", "sanctions-clear") to a third party without the agent, the
relying party, or the developer ever seeing the underlying documents. The audit row per action
is what makes it defensible to a regulator — which is the part existing agent frameworks
cannot offer at all.

---

*Prepared with Claude Code. Every command, error message, and endpoint probe quoted above was
executed against T3N testnet; nothing here is reproduced from documentation alone.*
