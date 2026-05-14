import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  chooseClickableTextCandidate,
  deriveLocalNumber,
  errorMessageFromUnknown,
  extractNewMessages,
  filterNumbersByCountryCode,
  getLeetCodeCountryOptionPrefix,
  resolveBrowserConnectionMode,
  supportsLeetCodeSignup,
} from "./lib/leetcode-signup-smoke.mjs";

const browserMode = resolveBrowserConnectionMode(process.argv[8]);
const config = {
  baseUrl: process.argv[2] ?? "http://127.0.0.1:18083",
  providerSequence: (process.argv[3] ?? "onlinesim,receive_smss,sms24,yunduanxin")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  perProviderLimit: Number.parseInt(process.argv[4] ?? "5", 10),
  pollSeconds: Number.parseInt(process.argv[5] ?? "10", 10),
  timeoutSeconds: Number.parseInt(process.argv[6] ?? "90", 10),
  edgePath: process.argv[7] ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  browserMode,
  targetCountryCode: process.argv[9] ? String(process.argv[9]).trim() : undefined,
};

if (!Number.isFinite(config.perProviderLimit) || config.perProviderLimit <= 0) {
  throw new Error(`Invalid per-provider limit: ${process.argv[4] ?? ""}`);
}
if (!Number.isFinite(config.pollSeconds) || config.pollSeconds <= 0) {
  throw new Error(`Invalid poll interval: ${process.argv[5] ?? ""}`);
}
if (!Number.isFinite(config.timeoutSeconds) || config.timeoutSeconds <= 0) {
  throw new Error(`Invalid timeout: ${process.argv[6] ?? ""}`);
}
if (config.browserMode.connection === "launch" && !fs.existsSync(config.edgePath)) {
  throw new Error(`Microsoft Edge was not found at: ${config.edgePath}`);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const puppeteerPath = path.resolve(
  repoRoot,
  ".tmp",
  "twilio-browser-tools",
  "node_modules",
  "puppeteer-core",
  "lib",
  "cjs",
  "puppeteer",
  "puppeteer-core.js",
);

if (!fs.existsSync(puppeteerPath)) {
  throw new Error(
    `puppeteer-core runtime was not found at ${puppeteerPath}. ` +
      "Reuse the existing .tmp/twilio-browser-tools install or bootstrap puppeteer-core first.",
  );
}

const { default: puppeteer } = await import(pathToFileURL(puppeteerPath).href);

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Request failed ${response.status} ${response.statusText} for ${url}: ${body}`);
  }
  return await response.json();
}

async function listProviderNumbers(baseUrl, providerKey, limit, countryCode) {
  const searchParams = new URLSearchParams({
    providerKey,
    limit: String(limit),
  });
  if (countryCode) {
    searchParams.set("countryCode", countryCode);
  }
  const response = await fetchJson(`${baseUrl}/sms/public-numbers?${searchParams.toString()}`);
  return response.items ?? [];
}

async function openSession(baseUrl, number) {
  const response = await fetchJson(`${baseUrl}/sms/sessions/open`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      providerKey: number.providerKey,
      costTier: "free",
      numberId: number.numberId,
      countryCode: number.countryCode,
      service: "otp",
    }),
  });
  return response.session;
}

async function fetchSessionMessages(baseUrl, sessionId) {
  return await fetchJson(`${baseUrl}/sms/sessions/${encodeURIComponent(sessionId)}/messages`);
}

async function fetchBestCode(baseUrl, sessionId) {
  return await fetchJson(`${baseUrl}/sms/sessions/${encodeURIComponent(sessionId)}/code`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function clickTextNode(page, exactText) {
  const candidates = await page.evaluate((text) => {
    const normalized = String(text).trim();
    return Array.from(document.querySelectorAll("*"))
      .filter((node) => node.textContent?.trim() === normalized)
      .map((node, index) => {
        const marker = `easy-sms-click-${normalized}-${index}-${Math.random().toString(36).slice(2, 8)}`;
        node.setAttribute("data-easy-sms-click", marker);
        return {
          marker,
          cursor: getComputedStyle(node).cursor,
          role: node.getAttribute("role"),
          tagName: node.tagName,
          depth: (() => {
            let depth = 0;
            let current = node.parentElement;
            while (current) {
              depth += 1;
              current = current.parentElement;
            }
            return depth;
          })(),
        };
      });
  }, exactText);

  const selected = chooseClickableTextCandidate(candidates);
  if (!selected) {
    throw new Error(`Text node not found or not clickable: ${exactText}`);
  }

  await page.click(`[data-easy-sms-click="${selected.marker}"]`);
  await page.evaluate((marker) => {
    const node = document.querySelector(`[data-easy-sms-click="${marker}"]`);
    node?.removeAttribute("data-easy-sms-click");
  }, selected.marker);
}

async function navigateToSignup(page) {
  await page.goto("https://leetcode.cn/accounts/signup/?next=%2F", {
    waitUntil: "networkidle2",
  });
  await page.waitForSelector('input[placeholder="输入手机号"]', { timeout: 20000 });
}

function isLeetCodeSignupUrl(url) {
  return url.startsWith("https://leetcode.cn/accounts/signup");
}

async function acquireBrowserSession(puppeteerLib, browserConfig) {
  if (browserConfig.browserMode.connection === "attach") {
    const browser = await puppeteerLib.connect({
      browserURL: `http://127.0.0.1:${browserConfig.browserMode.remoteDebuggingPort}`,
      defaultViewport: null,
    });
    return {
      browser,
      close: async () => {
        await browser.disconnect();
      },
      mode: "attach",
    };
  }

  const browser = await puppeteerLib.launch({
    executablePath: browserConfig.edgePath,
    headless: browserConfig.browserMode.headless,
    defaultViewport: null,
    args: ["--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check"],
  });
  return {
    browser,
    close: async () => {
      await browser.close();
    },
    mode: "launch",
  };
}

async function acquireLeetCodePage(browserSession) {
  const pages = await browserSession.browser.pages();
  const existing = pages.find((page) => isLeetCodeSignupUrl(page.url()));
  if (existing) {
    await existing.bringToFront();
    return existing;
  }

  const page = await browserSession.browser.newPage();
  await page.bringToFront();
  return page;
}

async function sendLeetCodeSignupCode(page, number) {
  const countryOptionPrefix = getLeetCodeCountryOptionPrefix(number.countryCode);
  const localNumber = deriveLocalNumber(number);
  const sendResults = [];
  let initialState = null;
  let afterPhoneState = null;

  const responseHandler = async (response) => {
    try {
      const request = response.request();
      if (!response.url().includes("/graphql/")) {
        return;
      }
      if (request.method() !== "POST") {
        return;
      }
      if (request.headers()["x-operation-name"] !== "sendSignInSmsCode") {
        return;
      }

      const bodyText = await response.text();
      let body;
      try {
        body = JSON.parse(bodyText);
      } catch {
        body = { raw: bodyText };
      }

      sendResults.push({
        status: response.status(),
        requestHeaders: request.headers(),
        requestBody: request.postDataJSON?.() ?? request.postData(),
        body,
      });
    } catch (error) {
      sendResults.push({
        status: 0,
        body: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  };

  page.on("response", responseHandler);

  try {
    await navigateToSignup(page);
    initialState = await captureLeetCodePageState(page);
    await page.evaluate(() => {
      const trigger = Array.from(document.querySelectorAll("button")).find((button) =>
        /^\+\d+/.test(button.textContent?.trim() ?? ""),
      );
      if (!(trigger instanceof HTMLElement)) {
        throw new Error("Country-code selector button was not found.");
      }
      trigger.click();
    });
    await page.waitForFunction(
      (prefix) =>
        Array.from(document.querySelectorAll("*")).some((node) => node.textContent?.trim().startsWith(prefix)),
      { timeout: 20000 },
      countryOptionPrefix,
    );
    await page.evaluate((prefix) => {
      const candidates = Array.from(document.querySelectorAll("*")).filter((node) =>
        node.textContent?.trim().startsWith(prefix),
      );
      const target =
        candidates.find((node) => node instanceof HTMLElement && getComputedStyle(node).cursor === "pointer") ??
        candidates[candidates.length - 1];
      if (!(target instanceof HTMLElement)) {
        throw new Error(`Country option not found for prefix: ${prefix}`);
      }
      target.click();
    }, countryOptionPrefix);
    await sleep(500);
    await page.waitForFunction(
      (dialCode) =>
        Array.from(document.querySelectorAll("button")).some((button) => button.textContent?.trim() === dialCode),
      { timeout: 10000 },
      number.countryCode,
    );

    await page.waitForSelector('input[placeholder="输入手机号"]', { timeout: 20000 });
    await page.click('input[placeholder="输入手机号"]', { clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.type('input[placeholder="输入手机号"]', localNumber, { delay: 80 });
    await sleep(250);
    await page.$eval('input[placeholder="输入手机号"]', (input) => {
      input.dispatchEvent(new Event("blur", { bubbles: true }));
    });
    afterPhoneState = await captureLeetCodePageState(page);

    await clickTextNode(page, "获取验证码");
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const countdownVisible = await page.evaluate(() =>
        Array.from(document.querySelectorAll("*")).some((node) => /\d+\s*秒后可重发/.test(node.textContent ?? "")),
      );
      if (countdownVisible || sendResults.length > 0) {
        break;
      }
      await sleep(500);
    }
  } finally {
    page.off("response", responseHandler);
  }

  return {
    countryOptionPrefix,
    localNumber,
    sendResults,
    initialState,
    countdownVisible: await page.evaluate(() =>
      Array.from(document.querySelectorAll("*")).some((node) => /\d+\s*秒后可重发/.test(node.textContent ?? "")),
    ),
    afterPhoneState,
    finalState: await captureLeetCodePageState(page),
  };
}

async function captureLeetCodePageState(page) {
  return await page.evaluate(() => {
    const dialCode =
      Array.from(document.querySelectorAll("button"))
        .map((button) => button.textContent?.trim())
        .find((text) => /^\+\d+/.test(text ?? "")) ?? null;
    const phoneInput = document.querySelector('input[placeholder="输入手机号"]');
    const allText = document.body?.innerText ?? "";
    return {
      dialCode,
      phoneValue: phoneInput instanceof HTMLInputElement ? phoneInput.value : null,
      hasCountdown: allText.includes("秒后可重发"),
      hasGetCode: allText.includes("获取验证码"),
      hasSlider: Boolean(document.querySelector("#aliyunCaptcha-sliding-wrapper")),
      text: allText.slice(0, 1000),
    };
  });
}

async function pollForNewMessages(baseUrl, sessionId, baselineIds, timeoutSeconds, pollSeconds) {
  const deadline = Date.now() + (timeoutSeconds * 1000);

  while (Date.now() < deadline) {
    const response = await fetchSessionMessages(baseUrl, sessionId);
    const messages = response.messages ?? [];
    const newMessages = extractNewMessages(messages, baselineIds);
    if (newMessages.length > 0) {
      const bestCode = await fetchBestCode(baseUrl, sessionId);
      return {
        newMessages,
        bestCode: bestCode.code ?? null,
      };
    }
    await sleep(pollSeconds * 1000);
  }

  return null;
}

const browserSession = await acquireBrowserSession(puppeteer, config);

try {
  const page = await acquireLeetCodePage(browserSession);
  const attempts = [];
  let success = null;

  for (const providerKey of config.providerSequence) {
    const numbers = filterNumbersByCountryCode(
      (
        await listProviderNumbers(
          config.baseUrl,
          providerKey,
          config.perProviderLimit,
          config.targetCountryCode,
        )
      ).filter(supportsLeetCodeSignup),
      config.targetCountryCode,
    );

    for (const number of numbers) {
      try {
        const session = await openSession(config.baseUrl, number);
        const baselineResponse = await fetchSessionMessages(config.baseUrl, session.id);
        const baselineIds = new Set((baselineResponse.messages ?? []).map((message) => message.id));

        const sendState = await sendLeetCodeSignupCode(page, number);
        const delivery = await pollForNewMessages(
          config.baseUrl,
          session.id,
          baselineIds,
          config.timeoutSeconds,
          config.pollSeconds,
        );

        const attempt = {
          providerKey,
          number,
          session,
          baselineMessageCount: baselineIds.size,
          sendState,
          delivery,
        };
        attempts.push(attempt);

        if (delivery) {
          success = attempt;
          break;
        }
      } catch (error) {
        attempts.push({
          providerKey,
          number,
          error: errorMessageFromUnknown(error),
        });
      }
    }

    if (success) {
      break;
    }
  }

  console.log(
    JSON.stringify(
      {
        config,
        browserConnection: browserSession.mode,
        success,
        attempts,
      },
      null,
      2,
    ),
  );
} finally {
  await browserSession.close();
}
