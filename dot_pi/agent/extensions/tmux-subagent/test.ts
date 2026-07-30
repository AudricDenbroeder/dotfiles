import {
  checkTmuxAvailable,
  splitWindow,
  sendKeys,

  sendKey,
  capturePane,

  setPaneTitle,
  listPanes,
  killPane,
  paneExists,
} from "./tmux.js"; // note: .js extension for ESM/NodeNext resolution

async function main() {
  // 1. availability
  await checkTmuxAvailable();
  console.log("✓ tmux available");

  // 2. list before
  console.log("panes before:", await listPanes());


  // 3. split → get new pane id
  const pane = await splitWindow({ direction: "right" });
  console.log("✓ split, new pane:", pane);

  // 4. exists + list should now include it
  console.log("exists?", await paneExists(pane));       // expect true
  console.log("panes after:", await listPanes());       // expect pane present

  // 5. title
  await setPaneTitle(pane, "test-agent");
  console.log("✓ title set (check tmux status bar / pane border)");


  // 6. send literal text + Enter (runs `echo hi` in the new pane's shell)
  await sendKeys(pane, "echo hello-from-test");
  await new Promise((r) => setTimeout(r, 100));         // small delay before Enter
  await sendKey(pane, "Enter");
  await new Promise((r) => setTimeout(r, 300));         // let it run

  console.log("sleeping a bit...")
  await new Promise((r) => setTimeout(r, 10000));         // let it run
  // 7. capture → should contain our echo output
  const out = await capturePane(pane);
  console.log("--- captured ---\n" + out + "\n---------------");
  console.log("contains output?", out.includes("hello-from-test")); // expect true

  // 8. kill + verify gone

  console.log("going to kill...")
  await new Promise((r) => setTimeout(r, 5000));         // let it run
  await killPane(pane);
  await new Promise((r) => setTimeout(r, 100));

  console.log("exists after kill?", await paneExists(pane)); // expect false
}

main().catch((e) => {
  console.error("✗ FAILED:", e);
  process.exit(1);
});
