import { readFile } from "node:fs/promises";
import { TenantClient, getNodeUrl } from "@terminal3/t3n-sdk";
import { connect, fail } from "./auth.js";

const WASM_PATH = "./z-tenant-flight/target/wasm32-wasip2/release/z_tenant_flight.wasm";
const CONTRACT_TAIL = "travel-contracts";
// Re-registering the same tail at the same version is rejected, so allow a bump from the
// environment: CONTRACT_VERSION=0.1.1 npm run register
const CONTRACT_VERSION = process.env.CONTRACT_VERSION ?? "0.1.0";

const { t3n, tenantDid } = await connect();

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
} catch (err) {
  fail("tenant.contracts.register()", err);
}
