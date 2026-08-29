import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { RouterClient } from "@orpc/server";
import type { AppRouter } from "../src/routes/orpc/router";

const link = new RPCLink({
  url: "http://localhost:9998/rpc",
});
const client: RouterClient<AppRouter> = createORPCClient(link);

async function testGetDashboard() {
  const result = await client.dashboard.get();
  console.log("getDashboard:", result);
}

async function testListCommands() {
  const result = await client.commands.list();
  console.log("commands.list:", result);
}

async function testListTabs() {
  const result = await client.tabs.list();
  console.log("tabs.list:", result);
}

async function main() {
  await testGetDashboard();
  await testListCommands();
  await testListTabs();
}

if (import.meta.main) {
  main().catch(console.error);
}
