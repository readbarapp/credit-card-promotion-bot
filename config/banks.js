/**
 * 香港銀行與支付平台監測清單（組態驅動）
 * 由 Dashboard「管理監控平台」透過 GitHub Contents API 寫入。
 *
 * 而家先只開恒生、東亞兩間，等分類下拉／tab 邏輯穩咗再加返其他平台。
 */
module.exports = [
  {
    "id": "hangseng",
    "name": "恒生銀行",
    "nameEn": "Hang Seng",
    "url": "https://www.hangseng.com/zh-hk/personal/offers/",
    "allowedHosts": [
      "www.hangseng.com",
      "hangseng.com"
    ],
    "waitMs": 2200,
    "maxAiSections": 40,
    "categoryNav": {
      "enabled": true,
      "tabSelector": "nav[role='tablist'] a[role='tab']",
      "moreSelector": ".rwd-offers-obc-category.active .rwd-offers-obc-category-show-more-button a, .rwd-offers-obc-category-content.show .rwd-offers-obc-category-show-more-button a",
      "cardLinkSelector": ".rwd-promotion-card a[href], .rwd-promotion-card-viewDetails a[href]",
      "waitAfterTabMs": 1800,
      "maxMoreClicks": 10,
      "maxOffers": 40
    },
    "follow": {
      "enabled": true,
      "maxPages": 40,
      "include": ["offer", "promo", "promotion", "優惠", "獎賞"],
      "skip": ["login", "privacy", "/en-hk/", "prime-rates", "whatsapp", "wa.me", "/security"]
    },
    "sourceHint": "web",
    "sourceNote": "優惠總覽有分類 tab（銀行服務、投資、卡類、貸款及按揭、保險及強積金、網上理財）。每個 tab 先顯示最多 9 則，要撳「顯示更多」；詳情喺「了解詳情」。",
    "enabled": true
  },
  {
    "id": "bea",
    "name": "東亞銀行",
    "nameEn": "BEA",
    "url": "https://www.hkbea.com/html/tc/bea-credit-card-hot-promotions.html",
    "waitMs": 1500,
    "maxAiSections": 40,
    "follow": {
      "enabled": true,
      "maxPages": 40,
      "include": ["credit-card", "welcome-offer", "promotion", "優惠"],
      "skip": ["login", "privacy", "mpf", "/en/", "bea-mpf-"]
    },
    "imageOffers": {
      "enabled": true,
      "maxOffers": 40,
      "maxImagesPerOffer": 4
    },
    "sourceHint": "web",
    "sourceNote": "信用卡「火熱優惠」下拉有迎新、餐飲、旅遊、娛樂、購物、獎賞及消費、信用卡套現。爬蟲會每個類型都跟，並讀官網 <img> 做圖轉文，唔會截圖。",
    "enabled": true
  }
];
