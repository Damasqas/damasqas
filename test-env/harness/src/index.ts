import { startProducers } from "./producer";
import { startWorkers } from "./workers";
import { startControlPanel } from "./control";

async function main() {
  console.log("=== Damasqas Test Harness ===\n");
  console.log("Starting workers...");
  startWorkers();
  console.log("\nStarting producers...");
  startProducers();
  console.log("\nStarting control panel...");
  startControlPanel();
}

main().catch(console.error);
