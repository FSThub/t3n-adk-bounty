# T3N ADK — Quickstart + Walkthrough run

Submission for the Superteam Earn bounty *"Create Agent ID, claim free tokens, & deploy first
RUST contract on the network"* (LOL ventures).

All five Walkthrough steps and the Quickstart were completed against T3N testnet on
Windows 11. **[FINDINGS.md](FINDINGS.md) is the substance of this submission** — 13 verified
defects found along the way, each with reproduction steps.

## Result

| Step | Outcome |
|---|---|
| Quickstart | Authenticated as `did:t3n:f49412c299be54937e42e5ea3f69ca2ff3d6ddc5` |
| 1. Write | Reference contract `z-tenant-flight` cloned |
| 2. Build | `z_tenant_flight.wasm`, 193.4 KB, valid WASM **component** (`00 61 73 6d 0d 00 01 00`) |
| 3. Register | `z:f49412c2…:travel-contracts`, contract id **501** |
| 4. Invoke | Grant applied, contract executed in TEE, KV secret read, egress reached `api.duffel.com` |
| 5. Test | 7/7 native tests green, `clippy -D warnings` clean |

Step 4 terminates at Duffel's own `HTTP 401` because no Duffel account was available — a
placeholder token was seeded. Every T3N-side link in the chain (auth → grant → enclave
execution → KV read → outbound HTTP) is exercised and passing.

## Environment

Windows 11 · Node v22.21.1 · `@terminal3/t3n-sdk@4.30.0` · Rust 1.97.1
(`x86_64-pc-windows-gnu` host, target `wasm32-wasip2`) · `setEnvironment("testnet")`

The GNU host is deliberate: the machine had Visual Studio Community 2022 without the C++
workload, so the default MSVC host has no linker. See the environment note in FINDINGS.md.

## Layout

| File | Purpose |
|---|---|
| [`auth.ts`](auth.ts) | Shared authentication; readable error reporting |
| [`quickstart.ts`](quickstart.ts) | Quickstart step |
| [`setup-secrets.ts`](setup-secrets.ts) | Creates the `secrets` KV map and seeds the API key |
| [`register.ts`](register.ts) | Registers the compiled contract |
| [`invoke.ts`](invoke.ts) | Applies the agent grant and calls `search-offers` |
| [`FINDINGS.md`](FINDINGS.md) | 12 findings |

`auth.ts` deviates from the published samples in three places, each because the sample as
written does not run — `trustAnchor` (finding 5), `.env` instead of `export` (finding 3), and
per-call `try/catch` so errors are legible (finding 6).

## Reproducing

```bash
npm install
cp .env.example .env   # then paste your key from the T3N claim page
```

The reference contract is cloned separately, not vendored:

```bash
git clone https://github.com/Terminal-3/z-tenant-flight.git
cd z-tenant-flight && cargo build --target wasm32-wasip2 --release && cd ..
```

Then, in order:

```bash
npm run quickstart
npm run register
npm run secrets
npm run invoke
```

`register.ts` pins `CONTRACT_TAIL`/`CONTRACT_VERSION` and `setup-secrets.ts` pins
`CONTRACT_ID = 501`; adjust both if you register under a different tail or get a different id.
Set `DUFFEL_API_KEY` in `.env` to take step 4 past the Duffel 401.

## Findings summary

| # | Finding | Severity |
|---|---|---|
| 1 | Critical vulnerability (`decompress`) in the SDK dependency tree | High |
| 2 | Quickstart states the wrong default environment | Medium |
| 3 | Quickstart has no Windows instructions | Medium |
| 4 | Third-party report: endpoints unreachable | Low |
| 5 | Quickstart sample cannot run — required `trustAnchor` omitted | High |
| 6 | Missing config surfaces as a cryptic TypeError; obfuscated bundle destroys stacks | Medium |
| 7 | `fetchTrustedManifest()` broken (GET vs POST) — forces `unsafe_trust_server` | **High** |
| 8 | Documented test command fails out of the box | Medium |
| 9 | Three conflicting version strings in one crate | Low |
| 10 | Walkthrough is 5 pages; page 1 has no forward navigation | High |
| 11 | `tenant.me()` does not exist | Medium |
| 12 | Documented error-forwarding guarantee holds on only one of two paths | **High** |
| 13 | Re-registering mints a new contract id, silently breaking KV ACLs | High |

Findings 7 and 12 are the security-relevant ones; 13 is the one most likely to bite a
production tenant.

Verbatim terminal transcripts for every step are in [`evidence/`](evidence).
