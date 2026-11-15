// End-to-end test of the real UI against a running stack (API + web export + workers).
// Usage: MCS_BASE_URL=http://127.0.0.1:4100 node tests/e2e/run-e2e.mjs
// Requires Playwright (Chromium). Screenshots go to docs/screenshots/.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const BASE = process.env.MCS_BASE_URL ?? "http://127.0.0.1:4100";
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), "../../docs/screenshots");
mkdirSync(SHOTS, { recursive: true });

const results = [];
const step = async (name, fn) => {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log(`✔ ${name} (${Date.now() - t}ms)`);
  } catch (e) {
    results.push({ name, ok: false, error: String(e?.message ?? e) });
    console.log(`✖ ${name}: ${e?.message ?? e}`);
    throw e;
  }
};

const email = `e2e-${Date.now()}@example.com`;
const browser = await chromium.launch();
let exitCode = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  await step("landing page renders in Arabic RTL", async () => {
    await page.goto(BASE + "/");
    await page.getByRole("tab", { name: "حساب جديد" }).waitFor();
    const dir = await page.evaluate(() => document.documentElement.dir);
    if (dir !== "rtl") throw new Error("dir is " + dir);
    await page.screenshot({ path: join(SHOTS, "01-landing.png") });
  });

  await step("register account", async () => {
    await page.getByRole("tab", { name: "حساب جديد" }).click();
    await page.getByLabel("الاسم").fill("مختبر");
    await page.getByLabel("البريد الإلكتروني").fill(email);
    await page.getByLabel(/كلمة المرور/).fill("password-123");
    await page.getByRole("button", { name: "إنشاء الحساب" }).click();
    await page.getByRole("heading", { name: "مشاريعك" }).waitFor();
  });

  await step("create project from console template", async () => {
    await page.getByRole("button", { name: "مشروع جديد" }).first().click();
    await page.getByRole("button", { name: /تطبيق Console/ }).click();
    await page.screenshot({ path: join(SHOTS, "02-new-project.png") });
    await page.getByRole("button", { name: "إنشاء وفتح" }).click();
    await page.waitForURL(/\/ide\/\?project=/);
    await page.locator(".monaco-editor").first().waitFor({ timeout: 30000 });
  });

  await step("introduce an error, build, see Arabic diagnostics", async () => {
    // Replace the editor content through Monaco's API (reliable across keyboards/RTL).
    await page.evaluate(() => {
      const m = window.monaco?.editor.getModels().find((x) => x.uri.path.endsWith("main.cpp"));
      m.setValue('#include <iostream>\nint main() {\n    std::cout << "hi" << std::endl\n    return 0;\n}\n');
    });
    await page.getByRole("button", { name: "بناء", exact: true }).click();
    await page.getByText("فاصلة منقوطة", { exact: false }).first().waitFor({ timeout: 60000 });
    await page.screenshot({ path: join(SHOTS, "03-diagnostics.png") });
  });

  await step("fix the error and build a real Windows EXE", async () => {
    await page.evaluate(() => {
      const m = window.monaco.editor.getModels().find((x) => x.uri.path.endsWith("main.cpp"));
      m.setValue('#include <iostream>\n#include <string>\n#include <windows.h>\nint main() {\n    SetConsoleOutputCP(CP_UTF8);\n    std::cout << "Name? " << std::flush;\n    std::string n;\n    std::getline(std::cin, n);\n    std::cout << "مرحباً " << n << "!\\n";\n    return 0;\n}\n');
    });
    await page.getByRole("button", { name: "بناء", exact: true }).click();
    await page.getByText("PE32+", { exact: false }).first().waitFor({ timeout: 90000 });
    await page.screenshot({ path: join(SHOTS, "04-build-success.png") });
  });

  await step("download EXE and verify PE header", async () => {
    await page.getByRole("tab", { name: /الملفات الناتجة/ }).click();
    const link = page.getByRole("link", { name: /تنزيل/ }).first();
    const href = await link.getAttribute("href");
    const res = await page.request.get(BASE + href);
    const buf = Buffer.from(await res.body());
    const peOff = buf.readUInt32LE(0x3c);
    if (buf[0] !== 0x4d || buf[1] !== 0x5a || buf.toString("latin1", peOff, peOff + 4) !== "PE\0\0") throw new Error("not a PE file");
    if (!/\.exe"?$/.test(res.headers()["content-disposition"] ?? "")) throw new Error("bad filename " + res.headers()["content-disposition"]);
  });

  await step("run EXE in Windows Runner and interact via terminal", async () => {
    await page.getByRole("button", { name: "تشغيل", exact: true }).click();
    const log = page.getByRole("log", { name: "مخرجات البرنامج" });
    await log.getByText("Name?").waitFor({ timeout: 90000 });
    const stdin = page.getByLabel("إدخال للبرنامج");
    await stdin.fill("Muhammad");
    await stdin.press("Enter");
    await log.getByText("مرحباً Muhammad!").waitFor({ timeout: 30000 });
    await log.getByText(/برمز 0/).waitFor({ timeout: 30000 });
    await page.screenshot({ path: join(SHOTS, "05-run-terminal.png") });
  });

  await step("GUI app: live preview frame and click interaction", async () => {
    await page.goto(BASE + "/");
    await page.getByRole("button", { name: "مشروع جديد" }).first().click();
    await page.getByRole("button", { name: /واجهة Windows/ }).click();
    await page.getByRole("button", { name: "إنشاء وفتح" }).click();
    await page.waitForURL(/\/ide\//);
    await page.locator(".monaco-editor").first().waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "تشغيل", exact: true }).click();
    const img = page.getByAltText("معاينة نافذة البرنامج");
    await page.waitForFunction(() => {
      const i = document.querySelector('img[alt="معاينة نافذة البرنامج"]');
      return i && i.style.visibility === "visible" && i.naturalWidth > 0;
    }, null, { timeout: 120000 });
    await page.waitForTimeout(1500);
    const box = await img.boundingBox();
    // The "Click me" button is drawn at about (44..204, 63..103) of the 1024x768 remote screen.
    // object-fit: contain → compute the drawn content box inside the element.
    let cw = box.width, ch = box.height;
    if (cw / ch > 1024 / 768) cw = ch * (1024 / 768); else ch = cw / (1024 / 768);
    const x = box.x + (box.width - cw) / 2 + (123 / 1024) * cw;
    const y = box.y + (box.height - ch) / 2 + (82 / 768) * ch;
    const before = await img.getAttribute("src");
    await page.mouse.click(x, y);
    await page.waitForFunction((b) => document.querySelector('img[alt="معاينة نافذة البرنامج"]').getAttribute("src") !== b, before, { timeout: 15000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(SHOTS, "06-gui-preview.png") });
    await page.getByRole("button", { name: "إيقاف" }).first().click();
  });

  await step("learning mode: verify an exercise by real build+run", async () => {
    await page.goto(BASE + "/learn/");
    await page.getByRole("button", { name: /المتغيرات والعمليات/ }).click();
    await page.locator(".monaco-editor").first().waitFor({ timeout: 30000 });
    await page.evaluate(() => window.monaco.editor.getModels()[0].setValue("#include <iostream>\nint main() { int w = 6, h = 4; std::cout << w * h << '\\n'; }\n"));
    await page.getByRole("button", { name: "تحقق من الحل" }).click();
    await page.getByText("أحسنت!").waitFor({ timeout: 90000 });
    await page.screenshot({ path: join(SHOTS, "07-learn.png") });
  });

  if (consoleErrors.length) console.log("page errors:", consoleErrors);

  // Mobile (iPhone viewport + UA, rendered by Chromium — NOT real Safari).
  const mctx = await browser.newContext({ ...devices["iPhone 15 Pro"], acceptDownloads: true });
  await mctx.addCookies((await ctx.cookies()).map((c) => ({ ...c })));
  const m = await mctx.newPage();
  m.on("dialog", (d) => d.accept());
  await step("mobile (iPhone viewport emulation): dashboard and IDE layout", async () => {
    await m.goto(BASE + "/");
    await m.getByRole("heading", { name: "مشاريعك" }).waitFor();
    await m.screenshot({ path: join(SHOTS, "08-mobile-dashboard.png") });
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) throw new Error("horizontal overflow on mobile dashboard");
    await m.locator("ul li a").first().click();
    await m.locator(".monaco-editor").first().waitFor({ timeout: 30000 });
    await m.getByRole("navigation", { name: "التنقل" }).waitFor();
    await m.screenshot({ path: join(SHOTS, "09-mobile-ide.png") });
    await m.getByRole("button", { name: "بناء", exact: true }).click();
    await m.getByText("PE32+", { exact: false }).first().waitFor({ timeout: 90000 });
    await m.screenshot({ path: join(SHOTS, "10-mobile-build.png") });
  });
} catch {
  exitCode = 1;
} finally {
  await browser.close();
  console.log(JSON.stringify({ passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length }, null, 0));
  process.exit(exitCode);
}
