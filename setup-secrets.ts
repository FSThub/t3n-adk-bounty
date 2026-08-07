import { TenantClient, getNodeUrl } from "@terminal3/t3n-sdk";
import { connect, fail } from "./auth.js";

const CONTRACT_ID = 501;

const { t3n, tenantDid } = await connect();

const tenant = new TenantClient({ t3n, baseUrl: getNodeUrl(), tenantDid });

// `readers` is mandatory in practice: the KV governor defaults to deny, so omitting it
// creates the map successfully and then fails every read with AccessDenied.
try {
  await tenant.maps.create({
    tail: "secrets",
    visibility: "private",
    writers: { only: [CONTRACT_ID] },
    readers: { only: [CONTRACT_ID] },
  });
  console.log(`Created map ${tenant.canonicalName("secrets")}`);
} catch (err) {
  const msg = (err as Error)?.message ?? "";
  if (/MapAlreadyExists|already exists/i.test(msg)) {
    console.log("Map already exists — continuing (create is idempotent).");
  } else {
    fail("tenant.maps.create(secrets)", err);
  }
}

// No Duffel account here, so the seeded value is a placeholder. That is enough to prove the
// KV read path; the contract will then reach Duffel and get an auth error from Duffel itself,
// which is the next link in the chain.
const duffelKey = process.env.DUFFEL_API_KEY ?? "placeholder_no_duffel_account";
if (duffelKey === "placeholder_no_duffel_account") {
  console.warn("DUFFEL_API_KEY not set — seeding a placeholder. Duffel will reject it.");
}

try {
  await tenant.executeControl("map-entry-set", {
    map_name: tenant.canonicalName("secrets"),
    key: "duffel_api_key",
    value: duffelKey,
  });
  console.log("Seeded duffel_api_key into secrets map.");
} catch (err) {
  fail('executeControl("map-entry-set")', err);
}
