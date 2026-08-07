import { getScriptVersion, getNodeUrl } from "@terminal3/t3n-sdk";
import { connect, fail } from "./auth.js";

const CONTRACT_TAIL = "travel-contracts";

const { t3n, tenantDid } = await connect();

// The docs use three separate credentials (T3N_API_KEY / AGENT_KEY / USER_KEY). The claim
// page issues one key per signup, so this runs the self-grant variant the docs describe:
// the same DID acts as tenant, agent, and data owner.
const agentDid = tenantDid;
const TENANT_SCRIPT = `z:${tenantDid.slice("did:t3n:".length)}:${CONTRACT_TAIL}`;

let scriptVersion = "";
try {
  scriptVersion = await getScriptVersion(getNodeUrl(), TENANT_SCRIPT);
  console.log(`${TENANT_SCRIPT} @ ${scriptVersion}`);
} catch (err) {
  fail("getScriptVersion(tenant script)", err);
}

// Grant the agent the right to call our two functions and reach the Duffel host.
try {
  const userContractVersion = await getScriptVersion(getNodeUrl(), "tee:user/contracts");
  console.log(`tee:user/contracts @ ${userContractVersion}`);

  await t3n.execute({
    script_name: "tee:user/contracts",
    script_version: userContractVersion,
    function_name: "agent-auth-update",
    input: {
      agents: [
        {
          agentDid,
          scripts: [
            {
              scriptName: TENANT_SCRIPT,
              versionReq: scriptVersion,
              functions: ["search-offers", "book-offer"],
              allowedHosts: ["api.duffel.com"],
            },
          ],
        },
      ],
    },
  });
  console.log("agent-auth-update OK — grant in place");
} catch (err) {
  fail("agent-auth-update", err);
}

try {
  const search = await t3n.executeAndDecode<{ offers?: unknown[] }>({
    script_name: TENANT_SCRIPT,
    script_version: scriptVersion,
    function_name: "search-offers",
    input: {
      origin: "LHR",
      destination: "JFK",
      departure_date: "2026-09-15",
      cabin_class: "economy",
      adult_count: 1,
    },
  });
  console.log("search-offers returned:", JSON.stringify(search).slice(0, 400));
} catch (err) {
  fail("search-offers", err);
}
