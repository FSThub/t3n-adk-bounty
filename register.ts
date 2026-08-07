import { readFile, writeFile } from "node:fs/promises";
import { TenantClient, getNodeUrl, getScriptVersion } from "@terminal3/t3n-sdk";
import { connect, fail } from "./auth.js";

const WASM_PATH = "./z-tenant-flight/target/wasm32-wasip2/release/z_tenant_flight.wasm";
const CONTRACT_TAIL = "travel-contracts";
const ID_LOG = "./contract-ids.json";

const { t3n, tenantDid } = await connect();

const scriptName = `z:${tenantDid.slice("did:t3n:".length)}:${CONTRACT_TAIL}`;

/**
 * Re-registering at a version that is not strictly higher is rejected, so default to the next
 * patch above whatever is already deployed. Override with CONTRACT_VERSION when you want a
 * specific number.
 */
async function nextVersion(): Promise<string> {
  if (process.env.CONTRACT_VERSION) return process.env.CONTRACT_VERSION;
  try {
    const current = await getScriptVersion(getNodeUrl(), scriptName);
    const [major, minor, patch] = current.split(".").map(Number);
    const bumped = `${major}.${minor}.${patch + 1}`;
    console.log(`Current version ${current} — registering ${bumped}`);
    return bumped;
  } catch {
    console.log("No version deployed yet — registering 0.1.0");
    return "0.1.0";
  }
}

const CONTRACT_VERSION = await nextVersion();

const tenant = new TenantClient({
  t3n,
  baseUrl: getNodeUrl(),
  tenantDid,
});

// The docs say `await tenant.me()`, but `me()` lives on the `tenant` namespace.
try {
  await tenant.tenant.me();
  console.log("TenantClient ready.");
} catch (err) {
  fail("tenant.tenant.me()", err);
}

const wasmBytes = await readFile(WASM_PATH);
console.log(`Read ${WASM_PATH} (${(wasmBytes.length / 1024).toFixed(1)} KB)`);

try {
  const result = await tenant.contracts.register({
    tail: CONTRACT_TAIL,
    version: CONTRACT_VERSION,
    wasm: wasmBytes,
  });
  // The docs rebuild this name by hand from tenantDid; the SDK already returns it.
  console.log(`Registered ${result.name} as contract id ${result.contract_id}`);

  // Every registration mints a NEW id, and KV map ACLs are pinned to ids — so an id that
  // drops off the list silently loses access to its own secrets. Keep the full history and
  // let setup-secrets.ts grant all of them. See finding 13.
  const known: number[] = await readFile(ID_LOG, "utf8")
    .then((raw) => JSON.parse(raw) as number[])
    .catch(() => []);
  if (!known.includes(result.contract_id)) {
    known.push(result.contract_id);
    await writeFile(ID_LOG, `${JSON.stringify(known)}\n`);
  }
  console.log(`Contract ids so far: ${known.join(", ")} — run \`npm run secrets\` to refresh the map ACL.`);
} catch (err) {
  fail("tenant.contracts.register()", err);
}
