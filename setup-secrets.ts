import { TenantClient, getNodeUrl } from "@terminal3/t3n-sdk";
import { connect, fail } from "./auth.js";

// Every registration mints a NEW contract id — bumping the version moves the running contract
// out of any ACL that pinned the old id, and the failure only shows up at the KV read. List
// every id that should keep access. See finding 13.
const CONTRACT_IDS = (process.env.CONTRACT_IDS ?? "501,502")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n));

const { t3n, tenantDid } = await connect();

const tenant = new TenantClient({ t3n, baseUrl: getNodeUrl(), tenantDid });

console.log(`Granting map access to contract ids: ${CONTRACT_IDS.join(", ")}`);

// `readers` is mandatory in practice: the KV governor defaults to deny, so omitting it
// creates the map successfully and then fails every read with AccessDenied.
const acl = {
  visibility: "private" as const,
  writers: { only: CONTRACT_IDS },
  readers: { only: CONTRACT_IDS },
};

try {
  await tenant.maps.create({ tail: "secrets", ...acl });
  console.log(`Created map ${tenant.canonicalName("secrets")}`);
} catch (err) {
  const msg = (err as Error)?.message ?? "";
  if (/MapAlreadyExists|already exists/i.test(msg)) {
    await tenant.maps.update("secrets", acl).catch((e) => fail("tenant.maps.update(secrets)", e));
    console.log(`Map already existed — ACL updated on ${tenant.canonicalName("secrets")}`);
  } else {
    fail("tenant.maps.create(secrets)", err);
  }
}

// No Duffel account here, so the seeded value is a placeholder. That is enough to prove the
// KV read path; the contract then reaches Duffel and gets an auth error from Duffel itself,
// which is the next link in the chain.
const duffelKey = process.env.DUFFEL_API_KEY ?? "placeholder_no_duffel_account";
if (duffelKey === "placeholder_no_duffel_account") {
  console.warn("DUFFEL_API_KEY not set — seeding a placeholder. Duffel will reject it.");
}

// The docs use `executeControl("map-entry-set", …)`; `maps.entrySet` is the typed equivalent.
try {
  await tenant.maps.entrySet("secrets", "duffel_api_key", duffelKey);
  console.log("Seeded duffel_api_key into secrets map.");
} catch (err) {
  fail("tenant.maps.entrySet(secrets)", err);
}
