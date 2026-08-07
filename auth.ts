import {
  T3nClient,
  setEnvironment,
  loadWasmComponent,
  eth_get_address,
  metamask_sign,
  createEthAuthInput,
  fetchTrustedManifest,
  type TrustAnchorOrUnsafe,
} from "@terminal3/t3n-sdk";

/**
 * The published bundle is obfuscated, so an uncaught throw prints ~20k characters of
 * mangled source instead of a usable stack. Report the message only.
 */
export function fail(step: string, err: unknown): never {
  const e = err as Error;
  console.error(`FAILED at: ${step}`);
  console.error(`  name:    ${e?.name}`);
  console.error(`  message: ${e?.message}`);
  for (const k of ["code", "status", "cause"]) {
    const v = (e as unknown as Record<string, unknown>)?.[k];
    if (v !== undefined) console.error(`  ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
  }
  process.exit(1);
}

/** Authenticate against testnet and return the client plus the tenant DID. */
export async function connect() {
  // The docs run `export T3N_API_KEY=...`, which is bash-only. On Windows we keep
  // the key in .env and let Node load it.
  process.loadEnvFile(".env");

  const T3N_API_KEY = process.env.T3N_API_KEY;
  if (!T3N_API_KEY) {
    console.error("T3N_API_KEY is empty. Copy .env.example to .env and paste your key from the claim page.");
    process.exit(1);
  }

  setEnvironment("testnet");

  let wasmComponent;
  try {
    wasmComponent = await loadWasmComponent();
  } catch (err) {
    fail("loadWasmComponent()", err);
  }

  const address = eth_get_address(T3N_API_KEY);

  // The Quickstart sample omits `trustAnchor`, but T3nClientConfig marks it required.
  // Prefer the operator-signed manifest over the `unsafe_trust_server` escape hatch.
  let trustAnchor: TrustAnchorOrUnsafe;
  try {
    trustAnchor = await fetchTrustedManifest("testnet");
    console.log(
      `Trust anchor from manifest: ${trustAnchor.expected_peer_ids.length} peer id(s), ` +
        `${trustAnchor.rtmr3_allowlist.length} RTMR3 measurement(s)`,
    );
  } catch (err) {
    console.warn(`fetchTrustedManifest() failed: ${(err as Error)?.message}`);
    console.warn("Falling back to unsafe_trust_server — DKG attestation is NOT verified.");
    trustAnchor = { unsafe_trust_server: true };
  }

  const t3n = new T3nClient({
    wasmComponent,
    trustAnchor,
    handlers: { EthSign: metamask_sign(address, undefined, T3N_API_KEY) },
  });

  try {
    await t3n.handshake();
  } catch (err) {
    fail("t3n.handshake()", err);
  }

  let tenantDid = "";
  try {
    const did = await t3n.authenticate(createEthAuthInput(address));
    tenantDid = did.value;
  } catch (err) {
    fail("t3n.authenticate()", err);
  }

  console.log(`Authenticated as ${tenantDid} (${address})`);
  return { t3n, tenantDid, address };
}
