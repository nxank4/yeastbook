#!/usr/bin/env bun
// scripts/capture-screenshots.ts — Capture README screenshots using Playwright

import { chromium } from "playwright";
import { resolve } from "node:path";

const DEMO_NOTEBOOK = resolve("demos/screenshot-demo.ybk");
const ASSETS_DIR = resolve("assets");
const PORT = 9222;
const VIEWPORT = { width: 1280, height: 800 };
const SERVER_TIMEOUT = 15_000;
const EXECUTE_TIMEOUT = 30_000;

async function waitForServer(port: number, timeout: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(`http://localhost:${port}`);
      if (res.ok) return;
    } catch {}
    await Bun.sleep(200);
  }
  throw new Error(`Server did not start within ${timeout}ms`);
}

async function main() {
  console.log("Starting yeastbook server...");
  const serverProc = Bun.spawn(
    ["bun", "packages/app/src/cli.ts", DEMO_NOTEBOOK, "--port", String(PORT), "--no-open"],
    { stdout: "inherit", stderr: "inherit" }
  );

  try {
    await waitForServer(PORT, SERVER_TIMEOUT);
    console.log("Server ready.");

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: VIEWPORT });

    await page.goto(`http://localhost:${PORT}`);
    // Wait for notebook UI to load (Monaco editors to initialize)
    await page.waitForSelector(".cell-wrapper", { timeout: 10_000 });
    await page.waitForTimeout(1000); // let Monaco finish rendering

    // Click "Run All Cells"
    console.log("Executing all cells...");
    const runAllBtn = page.locator('button[title="Run All Cells"]');
    await runAllBtn.click();

    // Wait for execution to start (button becomes disabled)
    await page.waitForFunction(() => {
      const btn = document.querySelector('button[title="Run All Cells"]') as HTMLButtonElement | null;
      return btn?.disabled === true;
    }, { timeout: 5_000 }).catch(() => {
      // May have already finished if cells are fast
    });

    // Wait for execution to finish (button re-enabled and no busy cells)
    await page.waitForFunction(() => {
      const btn = document.querySelector('button[title="Run All Cells"]') as HTMLButtonElement | null;
      const busyCells = document.querySelectorAll(".cell-exec-busy");
      return btn?.disabled === false && busyCells.length === 0;
    }, { timeout: EXECUTE_TIMEOUT });
    // Extra settle time for charts/tables to render
    await page.waitForTimeout(2000);

    // Screenshot 1: Hero — top of notebook
    console.log("Capturing demo-hero.png...");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(ASSETS_DIR, "demo-hero.png") });

    // Screenshot 2: Rich output section — scroll to rich-md cell
    console.log("Capturing demo-rich-output.png...");
    const richSection = page.locator('[data-type="markdown"]:has-text("Rich Output")');
    if (await richSection.count() > 0) {
      await richSection.scrollIntoViewIfNeeded();
    } else {
      // Fallback: scroll to middle of page
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.4));
    }
    await page.waitForTimeout(500);
    await page.screenshot({ path: resolve(ASSETS_DIR, "demo-rich-output.png") });

    // Screenshot 3: SQL section — scroll to sql-md cell
    console.log("Capturing demo-sql.png...");
    const sqlSection = page.locator('[data-type="markdown"]:has-text("SQL Support")');
    if (await sqlSection.count() > 0) {
      await sqlSection.scrollIntoViewIfNeeded();
    } else {
      // Fallback: scroll to bottom
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    }
    await page.waitForTimeout(500);
    await page.screenshot({ path: resolve(ASSETS_DIR, "demo-sql.png") });

    console.log("All screenshots captured!");
    await browser.close();
  } finally {
    serverProc.kill();
  }
}

main().catch((err) => {
  console.error("Screenshot capture failed:", err);
  process.exit(1);
});
