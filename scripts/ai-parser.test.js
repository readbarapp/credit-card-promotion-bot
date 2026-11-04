const fs = require("fs");
const path = require("path");
const assert = require("assert");

const parser = require("./ai-parser");

async function check(name, fn) {
  await fn();
  console.log(`ok  ${name}`);
}

async function main() {

await check("OpenRouter extraBody 不再一次送 4 個 fallback models", () => {
  const src = fs.readFileSync(path.join(__dirname, "ai-parser.js"), "utf8");
  assert.doesNotMatch(
    src,
    /extraBody:\s*\{\s*models:\s*\[[^\]]*(?:liquid\/lfm|gemma-4-26b|nemotron-3-ultra)/s,
    "should not send the 4-model OpenRouter fallback array that caused HTTP 400",
  );
  const extraModels = src.match(/extraBody:\s*\{\s*models:\s*\[([\s\S]*?)\]/);
  if (extraModels) {
    const items = extraModels[1].split(",").filter((line) => /["']/.test(line));
    assert.ok(items.length <= 3, `extraBody.models has ${items.length} items, OpenRouter max is 3`);
  }
});

await check("junk titles are skipped", () => {
  assert.equal(parser.isJunkTitle("Skip to content"), true);
  assert.equal(parser.isJunkTitle("Skip to Main Content"), true);
  assert.equal(parser.isJunkTitle("Invest"), true);
  assert.equal(parser.isJunkTitle("每天Banking Reward You!"), false);
});

await check("detail page heuristic fills all schema fields", () => {
  const bank = { id: "hsbc", name: "滙豐銀行", url: "https://www.redhotoffers.hsbc.com.hk/tc/home/" };
  const section = {
    kind: "detail",
    url: "https://www.redhotoffers.hsbc.com.hk/tc/latest-offers/everydaybankingrewardsyou/",
    title: "每天Banking Reward You! | 滙豐",
    text: [
      "每天Banking Reward You!",
      "成功登記可享高達 8% 現金回贈。",
      "須於 HSBC HK App 登記參加。",
      "推廣期內以指定滙豐信用卡簽賬滿 HK$3,000。",
      "指定商戶消費方可獲獎賞。",
      "截止日期 2026 年 12 月 31 日。",
    ].join("\n"),
  };
  const item = parser.extractFromSectionText(bank, section);
  assert.ok(item, "should extract an offer");
  assert.equal(item.bank_name, "滙豐銀行");
  assert.equal(item.title, "每天Banking Reward You!");
  assert.match(item.rewards, /現金回贈/);
  assert.ok(item.conditions.length >= 2, `conditions should not be empty: ${JSON.stringify(item.conditions)}`);
  assert.equal(item.requires_registration, "Yes");
  assert.equal(item.deadline, "2026-12-31");
  assert.equal(item.url, section.url);
});

await check("heuristic uses detail sections instead of nav link titles", async () => {
  const bank = { id: "hsbc", name: "滙豐銀行", url: "https://www.redhotoffers.hsbc.com.hk/tc/home/" };
  const scraped = {
    finalUrl: bank.url,
    title: "Red Hot Offers",
    text: "總覽",
    links: [
      { href: bank.url, text: "Skip to content" },
      { href: "https://www.redhotoffers.hsbc.com.hk/tc/latest-offers/everydaybankingrewardsyou/", text: "每天Banking Reward You!" },
    ],
    sections: [
      {
        kind: "listing",
        url: bank.url,
        title: "Skip to content",
        text: "Skip to content\n最新優惠",
      },
      {
        kind: "detail",
        url: "https://www.redhotoffers.hsbc.com.hk/tc/latest-offers/everydaybankingrewardsyou/",
        title: "每天Banking Reward You!",
        text: "每天Banking Reward You!\n高達 8% 現金回贈\n須於 App 登記參加\n指定信用卡簽賬滿 HK$1,000\n推廣期至 2026 年 11 月 30 日",
      },
    ],
  };
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const offers = await parser.extractOffersWithAi(bank, scraped);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].title, "每天Banking Reward You!");
  assert.notEqual(offers[0].title, "Skip to content");
  assert.ok(offers[0].conditions.length >= 1);
  assert.equal(offers[0].requires_registration, "Yes");
  assert.equal(offers[0].deadline, "2026-11-30");
  assert.equal(offers[0].bank_name, "滙豐銀行");
  assert.ok(offers[0].url);
});

await check("BEA listing cards are parsed from dropdown source HTML", () => {
  const { extractListingOfferCards, isOfferImageSrc, pickOfferImages, pickCardsAcrossCategories } = require("./offer-images");
  const html = `
    <div class="hide update-discover-offer-list-source" data-tag="迎新優惠">
      <div class="image-title-card"><a href="/html/tc/bea-credit-card-welcome-offer-bea-dual-card.html" target="_self">
        <div class="image-block"><img src="/images/Acq/Dual/banner_350x234.jpg" alt=""></div>
      </a></div>
    </div>
    <div class="hide update-discover-offer-list-source" data-tag="餐飲優惠">
      <div class="image-title-card"><a href="/html/tc/bea-credit-card-dining.html">
        <img src="/images/Usage/dining.jpg">
      </a></div>
    </div>`;
  const cards = extractListingOfferCards(html, "https://www.hkbea.com/html/tc/bea-credit-card-hot-promotions.html");
  assert.equal(cards.length, 2);
  assert.equal(cards[0].href, "https://www.hkbea.com/html/tc/bea-credit-card-welcome-offer-bea-dual-card.html");
  assert.equal(cards[0].tag, "迎新優惠");
  assert.equal(cards[1].tag, "餐飲優惠");
  assert.equal(isOfferImageSrc("https://www.hkbea.com/images/Acq/Dual/landing.jpg"), true);
  assert.equal(isOfferImageSrc("https://www.hkbea.com/images-solar/logo.png"), false);
  const picked = pickOfferImages([
    { src: "https://www.hkbea.com/images/Acq/Dual/banner_350x234.jpg" },
    { src: "https://www.hkbea.com/images/Acq/Dual/eDM_landing_R1.jpg" },
  ], 1);
  assert.match(picked[0].src, /landing/);
  const spread = pickCardsAcrossCategories(cards, 6);
  const tags = spread.map((c) => c.tag);
  assert.ok(tags.includes("迎新優惠"));
  assert.ok(tags.includes("餐飲優惠"));
  assert.notEqual(spread.every((c) => c.tag === "迎新優惠"), true);
});

await check("only Hang Seng and BEA are enabled while tab logic is being fixed", () => {
  const banks = require("../config/banks.js");
  assert.deepEqual(banks.filter((b) => b.enabled !== false).map((b) => b.id), ["hangseng", "bea"]);
  const hs = banks.find((b) => b.id === "hangseng");
  assert.equal(hs.url, "https://www.hangseng.com/zh-hk/personal/offers/");
  assert.ok(hs.categoryNav && hs.categoryNav.enabled !== false);
  assert.match(hs.categoryNav.tabSelector, /tablist/);
  assert.ok(hs.categoryNav.maxMoreClicks >= 8);
  const bea = banks.find((b) => b.id === "bea");
  assert.ok(bea.imageOffers.maxOffers >= 20);
});

await check("scraper never calls Playwright screenshot or recordVideo", () => {
  const src = fs.readFileSync(path.join(__dirname, "scraper.js"), "utf8");
  assert.doesNotMatch(src, /await\s+page\.screenshot\s*\(/);
  assert.doesNotMatch(src, /recordVideo\s*:/);
  assert.match(src, /expandCategoryDropdowns/);
  assert.match(src, /expandCategoryTabs/);
  assert.match(src, /collectImageOfferCards/);
});

await check("dashboard table markup includes required columns", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  for (const col of [
    "平台名稱",
    "優惠主題",
    "獎賞詳情",
    "任務條件",
    "需否登記",
    "截止日期",
    "官網原始連結",
    "bank_name",
    "requires_registration",
  ]) {
    assert.ok(html.includes(col), `index.html missing column ${col}`);
  }
  assert.ok(html.includes('id="cards"'));
  assert.ok(html.includes("result-table"));
  assert.doesNotMatch(html, /id="cards"><\/div>/);
});

  console.log("all tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
