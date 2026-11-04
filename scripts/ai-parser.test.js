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
  assert.match(src, /rwd-promotion-card-viewDetails/);
  assert.match(src, /unwrapOfferUrl/);
});

await check("WhatsApp share links unwrap to the real Hang Seng offer URL", () => {
  const wa = "https://api.whatsapp.com/send?text=%E4%B8%80%E6%98%9F%E6%9C%9F%E5%A4%96%E5%B9%A3%E5%AE%9A%E5%AD%98%0A%0Ahttps%3A%2F%2Fwww.hangseng.com%2Fcms%2Femkt%2Fpmo%2Fgrp03%2Fp97%2Fchi%2Findex.html%3Fcid%3Ddt-d-promo-featured-1-zh%3Asocial%3A%24%7Bmedia%7D%3Ashare";
  const href = parser.unwrapOfferUrl(wa);
  assert.match(href, /hangseng\.com\/cms\/emkt/);
  assert.doesNotMatch(href, /whatsapp/i);
  assert.equal(parser.isBadOfferUrl(wa), true);
  assert.equal(parser.isBadOfferUrl(href.replace(/:social:.*$/, "")), false);
  assert.equal(
    parser.pickAllowedUrl(wa, [{ href: "https://www.hangseng.com/cms/emkt/pmo/grp03/p97/chi/index.html", text: "了解詳情" }], "https://www.hangseng.com/zh-hk/personal/offers/"),
    "https://www.hangseng.com/cms/emkt/pmo/grp03/p97/chi/index.html",
  );
  assert.equal(parser.isListingUrl("https://www.hangseng.com/zh-hk/personal/offers/"), true);
  assert.equal(parser.isJunkTitle("在 WhatsApp 上分享"), true);
});

await check("deadlines keep end dates and do not invent 額滿即止", () => {
  assert.equal(
    parser.extractDeadlineFromText("額外獎賞推廣有效期由2025年4月1日起至2026年12月31日。"),
    "2026-12-31",
  );
  assert.equal(
    parser.extractDeadlineFromText("於2027年1月13日或之前申請東亞銀行銀聯雙幣鑽石卡"),
    "2027-01-13",
  );
  assert.equal(parser.extractDeadlineFromText("年利率高達17%，只適用於兌換指定貨幣"), parser.UNKNOWN_DEADLINE);
  assert.equal(parser.normalizeDeadline(""), parser.UNKNOWN_DEADLINE);
  assert.equal(parser.normalizeDeadline("先到先得"), "先到先得");
  assert.equal(parser.normalizeDeadline("額滿即止"), "額滿即止");
  assert.equal(parser.deadlineFromCountdown("優惠僅剩16天", "2026-11-04"), "2026-11-20");
});

await check("BEA merchant hub keeps dropdown category name", () => {
  const bank = { id: "bea", name: "東亞銀行", url: "https://www.hkbea.com/html/tc/bea-credit-card-hot-promotions.html" };
  const item = parser.extractFromSectionText(bank, {
    kind: "detail",
    url: "https://www.hkbea.com/html/tc/bea-credit-card-dining-offer-yro.html",
    title: "餐飲優惠",
    category: "餐飲優惠",
    text: "餐飲優惠\n指定商戶\nagoda\nHutchgo\n條款及細則",
  });
  assert.equal(item.title, "餐飲優惠");
  assert.match(item.rewards, /合作商戶/);
  assert.ok(item.conditions.some((c) => /指定東亞信用卡/.test(c)));
  const concert = parser.extractFromSectionText(bank, {
    kind: "detail",
    url: "https://www.hkbea.com/html/tc/bea-credit-card-entertainment-offer-2026-gigi-leung.html",
    title: "梁詠琪演唱會門票優惠 | 東亞銀行",
    category: "娛樂優惠",
    text: "梁詠琪演唱會門票優惠\n憑指定東亞信用卡預購門票可享優先購票。\n須於推廣期內以指定信用卡付款。",
  });
  assert.match(concert.title, /梁詠琪/);
});

await check("Hang Seng listing blurb becomes task conditions, FAQ is skipped", () => {
  const bank = { id: "hangseng", name: "恒生銀行", url: "https://www.hangseng.com/zh-hk/personal/offers/" };
  const item = parser.extractFromSectionText(bank, {
    kind: "detail",
    url: "https://www.hangseng.com/zh-hk/personal/cards/products/travel-plus-card/",
    title: "恒生Travel+ Visa Signature卡",
    listingTitle: "升級餐飲迎新賞高達$1,200 +FUN Dollars",
    listingDescription: "申請恒生Travel+ Visa Signature卡，須於發卡後以指定商戶簽賬滿HK$3,000。完成登記指定推廣。",
    text: [
      "申請貸款前需要先開立恒生銀行戶口嗎？",
      "你需要注意的其他資訊",
      "貸款計算機的結果只供參考。",
      "以上案例只供參考。",
    ].join("\n"),
  });
  assert.equal(item.title, "升級餐飲迎新賞高達$1,200 +FUN Dollars");
  assert.ok(item.conditions.length >= 1, JSON.stringify(item.conditions));
  assert.ok(item.conditions.every((c) => !/嗎？/.test(c)));
  assert.ok(item.conditions.every((c) => !/只供參考/.test(c)));
  assert.equal(item.url, "https://www.hangseng.com/zh-hk/personal/cards/products/travel-plus-card/");
});

await check("mergeOffers drops disabled banks and junk WhatsApp rows", () => {
  const next = parser.mergeOffers({
    previous: {
      offers: [
        { id: "old-mox", bank_id: "mox", bank_name: "Mox Bank", title: "舊Mox", url: "https://mox.com/zh/promotions/x/", deadline: "2026-12-31" },
        { id: "old-wa", bank_id: "hangseng", bank_name: "恒生銀行", title: "在 WhatsApp 上分享", url: "https://api.whatsapp.com/send?text=x", deadline: "額滿即止" },
      ],
    },
    incomingByBank: new Map([
      ["hangseng", [{
        id: "new-hs",
        bank_id: "hangseng",
        bank_name: "恒生銀行",
        title: "美股必中賞",
        rewards: "半價佣金",
        conditions: ["須於推廣期內完成指定美股交易"],
        requires_registration: "No",
        deadline: "未註明",
        url: "https://www.hangseng.com/cms/emkt/pmo/grp04/p95/chi/index.html",
      }]],
    ]),
    errors: [],
    banks: [{ id: "hangseng", name: "恒生銀行" }],
  });
  assert.equal(next.some((o) => o.bank_id === "mox"), false);
  assert.equal(next.some((o) => /WhatsApp/.test(o.title)), false);
  assert.equal(next.length, 1);
  assert.equal(next[0].title, "美股必中賞");
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
