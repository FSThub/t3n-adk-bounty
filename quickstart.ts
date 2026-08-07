import { connect } from "./auth.js";

const { tenantDid } = await connect();
console.log("Connected as:", tenantDid);
