import { createWorkloadSdk } from "@capakit/sdk";
import { registerHttp } from "./capakit_http.ts";
import { registerMcp } from "./capakit_mcp.ts";

const sdk = createWorkloadSdk();
sdk.hijackConsoleLogging();

registerMcp(sdk);
registerHttp(sdk);

await sdk.start();
