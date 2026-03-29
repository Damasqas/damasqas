import { initProducers } from "./producer";
import { startWorkers } from "./workers";
import { startControlPanel } from "./control";

async function main() {
  console.log("=== Damasqas Test Harness ===\n");
  console.log("Starting workers...");
  startWorkers();
  console.log("\nInitializing producers (idle)...");
  initProducers();
  console.log("\nStarting control panel...");
  startControlPanel();
  console.log("\n  All queues idle. Use the control panel to start producing jobs.\n");
}

main().catch(console.error);
