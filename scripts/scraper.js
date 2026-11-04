/**
 * 通用 Playwright 爬蟲（零截圖 / 零錄影）
 *
 * - 禁止 page.screenshot()、context.recordVideo、trace 錄影
 * - 各平台獨立 try/catch，單一銀行失敗不得中斷整體流程
 * - Auto-scroll 展開動態內容，關閉 Cookie／私隱彈窗
 * - 只輸出純文字 + 頁面上真實 <a href>（相對路徑會解析成絕對 URL）
 */

const { chromium } = require("playwright");
const path = require("path");

const {
  extractOffersWithAi,
  mergeOffers,
  loadPreviousData,
  sendNotifications,
  buildDashboardPayload,
  writeOutputs,
} = require("./ai-parser");

const banks = require("../config/banks.js");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const COOKIE_BUTTON_NAMES = [
  "接受所有",
  "接受全部",
  "接受",
  "同意",
  "允許全部",
  "允許",
  "我同意",
  "我明白",
  "關閉",
  "確定",
  "Accept All",
  "Accept all",
  "Accept",
  "Allow all",
  "Allow All",
  "I Agree",
  "I agree",
  "Agree",
  "Got it",
  "OK",
  "Close",
];

const COOKIE_SELECTORS = [
  "#onetrust-accept-btn-handler",
  "#accept-recommended-btn-handler",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  "#CybotCookiebotDialogBodyButtonAccept",
  "button[id*='accept' i]",
  "button[class*='accept' i]",
  "button[data-testid*='accept' i]",
  ".optanon-allow-all-button",
  ".cc-allow",
  ".cc-dismiss",
];

function enabledBanks() {
  return banks.filter((b) => b && b.enabled !== false && b.url);
}

async function dismissOverlays(page) {
  for (const selector of COOKIE_SELECTORS) {
    try {
      const loc = page.locator(selector).first();
      if (await loc.isVisible({ timeout: 600 }).catch(() => false)) {
        await loc.click({ timeout: 1500 });
      }
    } catch {
      /* 彈窗不存在或不可點，繼續 */
    }
  }

  for (const name of COOKIE_BUTTON_NAMES) {
    try {
      const btn = page.getByRole("button", { name, exact: false }).first();
      if (await btn.isVisible({ timeout: 400 }).catch(() => false)) {
        await btn.click({ timeout: 1500 });
      }
    } catch {
      /* ignore */
    }
  }

  try {
    await page.keyboard.press("Escape");
  } catch {
    /* ignore */
  }
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let lastHeight = 0;
    let stable = 0;
    for (let i = 0; i < 18; i += 1) {
      window.scrollBy(0, 900);
      await sleep(280);
      const height = document.body ? document.body.scrollHeight : 0;
      if (height <= lastHeight) {
        stable += 1;
        if (stable >= 3) break;
      } else {
        stable = 0;
        lastHeight = height;
      }
    }
    window.scrollTo(0, 0);
  });
}

async function collectPageContent(page) {
  return page.evaluate(() => {
    const root =
      document.querySelector("main, #content, #main, [role='main'], article, .content") ||
      document.body;

    const links = [];
    const seen = new Set();
    for (const a of document.querySelectorAll("a[href]")) {
      const raw = a.getAttribute("href");
      if (!raw) continue;
      let href;
      try {
        href = new URL(raw, location.href).href;
      } catch {
        continue;
      }
      if (seen.has(href)) continue;
      seen.add(href);
      links.push({
        href,
        text: (a.innerText || a.getAttribute("title") || a.getAttribute("aria-label") || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 180),
      });
    }

    const text = (root?.innerText || document.body?.innerText || "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return {
      title: document.title || "",
      text,
      links,
    };
  });
}

async function scrapeBank(page, bank) {
  console.log(`[scrape] ${bank.name} → ${bank.url}`);
  const response = await page.goto(bank.url, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await new Promise((r) => setTimeout(r, 1500));
  await dismissOverlays(page);
  await autoScroll(page);
  await new Promise((r) => setTimeout(r, 800));
  await dismissOverlays(page);

  const content = await collectPageContent(page);
  if (!content.text || content.text.length < 80) {
    throw new Error(
      `頁面文字過少（${content.text ? content.text.length : 0} 字），可能被攔截或結構變更`,
    );
  }

  return {
    status: response ? response.status() : null,
    finalUrl: page.url(),
    title: content.title,
    text: content.text.slice(0, 100000),
    links: content.links,
  };
}

async function withBankPage(context, bank, fn) {
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(60000);
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  const startedAt = Date.now();
  const list = enabledBanks();
  if (!list.length) {
    throw new Error("config/banks.js 沒有已啟用的平台");
  }

  console.log(`[boot] ${list.length} 個平台，零截圖模式`);
  if (!process.env.GEMINI_API_KEY) {
    console.warn("[boot] 警告：未偵測到 GEMINI_API_KEY，AI 解析將失敗並保留舊資料");
  }

  const previous = loadPreviousData(path.join(__dirname, "..", "data.json"));
  const incomingByBank = new Map();
  const errors = [];

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  const context = await browser.newContext({
    locale: "zh-HK",
    timezoneId: "Asia/Hong_Kong",
    userAgent: USER_AGENT,
    viewport: { width: 1440, height: 900 },
    javaScriptEnabled: true,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      "Accept-Language": "zh-HK,zh-TW;q=0.9,zh;q=0.8,en;q=0.7",
    },
    /* 明確關閉錄影：不得設定 recordVideo */
  });

  try {
    for (const [index, bank] of list.entries()) {
      try {
        const scraped = await withBankPage(context, bank, (page) => scrapeBank(page, bank));
        console.log(
          `[scrape] ${bank.name} 完成：${scraped.text.length} 字、${scraped.links.length} 條真實連結`,
        );
        try {
          const offers = await extractOffersWithAi(bank, scraped);
          if (!offers.length) {
            throw new Error("抽出 0 則優惠，為避免誤標過期而保留舊資料");
          }
          incomingByBank.set(bank.id, offers);
          console.log(`[ai] ${bank.name} 抽出 ${offers.length} 則優惠`);
        } catch (aiErr) {
          console.error(`[ai] ${bank.name} 解析失敗：`, aiErr.message);
          errors.push({
            bank_id: bank.id,
            bank_name: bank.name,
            stage: "ai",
            error: aiErr.message,
          });
        }
      } catch (scrapeErr) {
        console.error(`[scrape] ${bank.name} 失敗，繼續下一平台：`, scrapeErr.message);
        errors.push({
          bank_id: bank.id,
          bank_name: bank.name,
          stage: "scrape",
          error: scrapeErr.message,
        });
      }

      if (index < list.length - 1) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  const offers = mergeOffers({
    previous,
    incomingByBank,
    errors,
    banks: list,
  });

  const payload = buildDashboardPayload({
    banks: list,
    offers,
    errors,
    startedAt,
  });

  writeOutputs(payload);

  try {
    await sendNotifications(offers);
  } catch (notifyErr) {
    console.warn("[notify] 推播流程出錯（不中斷）：", notifyErr.message);
  }

  console.log(
    `[done] active=${payload.stats.active} new=${payload.stats.isNew} errors=${errors.length} ${payload.stats.durationMs}ms`,
  );
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
