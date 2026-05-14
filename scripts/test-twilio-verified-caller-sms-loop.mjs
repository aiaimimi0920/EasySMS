import path from "node:path";
import { pathToFileURL } from "node:url";

const config = {
  browserPort: Number.parseInt(process.argv[2] ?? "9223", 10),
  baseUrl: process.argv[3] ?? "http://127.0.0.1:18090",
  providerSequence: (process.argv[4] ?? "onlinesim,receive_smss").split(",").map((value) => value.trim()).filter(Boolean),
  perProviderLimit: Number.parseInt(process.argv[5] ?? "5", 10),
  pollSeconds: Number.parseInt(process.argv[6] ?? "5", 10),
  timeoutSeconds: Number.parseInt(process.argv[7] ?? "45", 10),
};

if (!Number.isFinite(config.browserPort) || config.browserPort <= 0) {
  throw new Error(`Invalid browser port: ${process.argv[2] ?? ""}`);
}

const toolPath = path.resolve(
  process.cwd(),
  ".tmp",
  "twilio-browser-tools",
  "node_modules",
  "puppeteer-core",
  "lib",
  "cjs",
  "puppeteer",
  "puppeteer-core.js",
);
const { default: puppeteer } = await import(pathToFileURL(toolPath).href);

function normalizeDigits(input) {
  return String(input ?? "").replace(/\D/g, "");
}

function chooseCountrySearchTerm(number) {
  if (number.countryCode === "+44") {
    return "United Kingdom";
  }
  if (number.countryCode === "+1") {
    return "United States";
  }
  if (number.countryName) {
    return number.countryName;
  }
  throw new Error(`Cannot determine country selector term for ${JSON.stringify(number)}`);
}

function deriveLocalNumber(number) {
  const phoneDigits = normalizeDigits(number.phoneNumber);
  const countryDigits = normalizeDigits(number.countryCode);
  if (!phoneDigits || !countryDigits || !phoneDigits.startsWith(countryDigits)) {
    throw new Error(`Cannot derive local number from ${number.phoneNumber} / ${number.countryCode}`);
  }
  return phoneDigits.slice(countryDigits.length);
}

function extractOtpCandidates(text) {
  return Array.from(String(text ?? "").matchAll(/\b\d{4,8}\b/g), (match) => match[0]);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Request failed ${response.status} ${response.statusText} for ${url}: ${body}`);
  }
  return await response.json();
}

async function listProviderNumbers(baseUrl, providerKey, limit) {
  const response = await fetchJson(`${baseUrl}/sms/public-numbers?providerKey=${encodeURIComponent(providerKey)}&limit=${limit}`);
  return response.items ?? [];
}

async function fetchInbox(baseUrl, providerKey, numberId) {
  return await fetchJson(`${baseUrl}/sms/inbox?providerKey=${encodeURIComponent(providerKey)}&numberId=${encodeURIComponent(numberId)}`);
}

async function resetVerifiedCallerPage(page) {
  await page.goto("https://console.twilio.com/us1/develop/phone-numbers/manage/verified", {
    waitUntil: "networkidle2",
  });
}

async function ensureLoggedIn(page) {
  const text = await page.evaluate(() => document.body?.innerText ?? "");
  if (/Welcome\s+Email address/i.test(text) || /Create an account for free/i.test(text)) {
    throw new Error("Controlled Twilio browser is not logged in.");
  }
}

async function openAddCallerIdModal(page) {
  await page.waitForSelector("button", { timeout: 15000 });
  const buttons = await page.$$("button");
  for (const button of buttons) {
    const text = await page.evaluate((el) => el.innerText.trim(), button);
    if (text === "Add a new Caller ID") {
      await button.click();
      await page.waitForSelector("#caller-id-create-modal-number-input", { timeout: 15000 });
      return;
    }
  }
  throw new Error("Add a new Caller ID button was not found.");
}

async function fillCallerIdForm(page, number) {
  const countrySearchTerm = chooseCountrySearchTerm(number);
  const localNumber = deriveLocalNumber(number);

  const countryInput = await page.$("#country-dropdown-input");
  if (!countryInput) {
    throw new Error("Country dropdown input not found.");
  }
  await countryInput.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  await countryInput.type(countrySearchTerm, { delay: 40 });
  await page.waitForSelector("#country-dropdown-menu [role=option]", { timeout: 10000 });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  const numberInput = await page.$("#caller-id-create-modal-number-input");
  if (!numberInput) {
    throw new Error("Caller ID number input not found.");
  }
  await numberInput.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  await numberInput.type(localNumber, { delay: 30 });

  const verifyButton = await page.$$eval("button", (buttons) => {
    const match = buttons.find((button) => button.innerText.trim() === "Verify number");
    if (!match) {
      return null;
    }
    const marker = `verify-${Math.random().toString(36).slice(2)}`;
    match.setAttribute("data-easy-sms-marker", marker);
    return marker;
  });
  if (!verifyButton) {
    throw new Error("Verify number button not found.");
  }
  await page.click(`button[data-easy-sms-marker="${verifyButton}"]`);
}

async function snapshotTwilioResult(page) {
  await new Promise((resolve) => setTimeout(resolve, 2500));
  return await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    text: document.body?.innerText?.slice(0, 5000) ?? "",
    codeInputPresent: Boolean(document.querySelector("input[name='verificationCode'], input[id*='verification'], input[autocomplete='one-time-code']")),
    visibleInputs: Array.from(document.querySelectorAll("input")).map((input) => ({
      id: input.id,
      name: input.getAttribute("name"),
      type: input.getAttribute("type"),
      value: input.value,
    })),
  }));
}

async function pollForNewSms(baseUrl, number, baselineIds, timeoutSeconds, pollSeconds) {
  const deadline = Date.now() + (timeoutSeconds * 1000);

  while (Date.now() < deadline) {
    const inbox = await fetchInbox(baseUrl, number.providerKey, number.numberId);
    const messages = inbox.messages ?? [];
    const newMessages = messages.filter((message) => !baselineIds.has(message.id));
    if (newMessages.length > 0) {
      return {
        inbox,
        newMessages,
        extractedCodes: newMessages.flatMap((message) => extractOtpCandidates(message.content)),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, pollSeconds * 1000));
  }

  return null;
}

const browser = await puppeteer.connect({
  browserURL: `http://127.0.0.1:${config.browserPort}`,
  defaultViewport: null,
});

try {
  const pages = await browser.pages();
  const page = pages.find((candidate) => candidate.url().includes("console.twilio.com/us1/develop/phone-numbers/manage/verified"));
  if (!page) {
    throw new Error("Twilio Verified Caller IDs page not found in controlled browser.");
  }

  await page.bringToFront();
  await ensureLoggedIn(page);

  const attempts = [];
  let success = null;

  for (const providerKey of config.providerSequence) {
    const numbers = await listProviderNumbers(config.baseUrl, providerKey, config.perProviderLimit);
    for (const number of numbers) {
      await resetVerifiedCallerPage(page);
      await openAddCallerIdModal(page);

      let baselineInbox;
      try {
        baselineInbox = await fetchInbox(config.baseUrl, providerKey, number.numberId);
      } catch (error) {
        attempts.push({
          providerKey,
          number,
          skipped: true,
          reason: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      const baselineIds = new Set((baselineInbox.messages ?? []).map((message) => message.id));

      await fillCallerIdForm(page, number);
      const twilioState = await snapshotTwilioResult(page);
      const delivery = await pollForNewSms(
        config.baseUrl,
        number,
        baselineIds,
        config.timeoutSeconds,
        config.pollSeconds,
      );

      const attempt = {
        providerKey,
        number,
        baselineMessageCount: baselineIds.size,
        twilioState,
        delivery,
      };
      attempts.push(attempt);

      if (delivery) {
        success = attempt;
        break;
      }
    }

    if (success) {
      break;
    }
  }

  console.log(JSON.stringify({
    config,
    success,
    attempts,
  }, null, 2));
} finally {
  await browser.disconnect();
}
