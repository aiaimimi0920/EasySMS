import path from "node:path";
import { pathToFileURL } from "node:url";

const port = Number.parseInt(process.argv[2] ?? "9223", 10);
if (!Number.isFinite(port) || port <= 0) {
  throw new Error(`Invalid port: ${process.argv[2] ?? ""}`);
}

const toolDir = path.resolve(process.cwd(), ".tmp", "twilio-browser-tools", "node_modules", "puppeteer-core", "lib", "cjs", "puppeteer", "puppeteer-core.js");
const { default: puppeteer } = await import(pathToFileURL(toolDir).href);

const browser = await puppeteer.connect({
  browserURL: `http://127.0.0.1:${port}`,
  defaultViewport: null,
});

try {
  const pages = await browser.pages();
  const page = pages.find((candidate) => candidate.url().includes("console.twilio.com"))
    ?? pages.find((candidate) => candidate.url().startsWith("http"))
    ?? pages[0];

  if (!page) {
    throw new Error("No suitable page found in controlled browser.");
  }

  await page.bringToFront();
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const info = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    textPreview: document.body?.innerText?.slice(0, 4000) ?? "",
  }));

  console.log(JSON.stringify(info, null, 2));
} finally {
  await browser.disconnect();
}
