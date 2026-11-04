/**
 * 香港銀行與支付平台監測清單（組態驅動）
 * 由 Dashboard「管理監控平台」透過 GitHub Contents API 寫入。
 */
module.exports = [
  {
    "id": "hsbc",
    "name": "滙豐銀行",
    "nameEn": "HSBC",
    "url": "https://www.redhotoffers.hsbc.com.hk/tc/home/",
    "sourceHint": "web",
    "enabled": true
  },
  {
    "id": "hangseng",
    "name": "恒生銀行",
    "nameEn": "Hang Seng",
    "url": "https://www.hangseng.com/zh-hk/personal/cards/spending-privileges/offers-of-the-month-all/month-creditcard/",
    "sourceHint": "web",
    "enabled": true
  },
  {
    "id": "boc",
    "name": "中銀香港",
    "nameEn": "BOCHK",
    "url": "https://www.bochk.com/tc/creditcard/promotions/offers.html",
    "sourceHint": "web",
    "enabled": true
  },
  {
    "id": "sc",
    "name": "渣打銀行",
    "nameEn": "Standard Chartered",
    "url": "https://www.sc.com/hk/zh/credit-cards/offers/",
    "sourceHint": "web",
    "enabled": true
  },
  {
    "id": "mox",
    "name": "Mox Bank",
    "nameEn": "Mox",
    "url": "https://mox.com/zh/promotions/",
    "sourceHint": "app",
    "sourceNote": "Mox Earn 商戶優惠主要在 App 內；網站只公開部分推廣頁，爬蟲會跟進網站上的子頁，但無法進入 App。",
    "enabled": true
  },
  {
    "id": "bea",
    "name": "東亞銀行",
    "nameEn": "BEA",
    "url": "https://www.hkbea.com/html/tc/bea-credit-card-hot-promotions.html",
    "sourceHint": "web",
    "enabled": true
  },
  {
    "id": "alipayhk",
    "name": "AlipayHK",
    "nameEn": "AlipayHK",
    "url": "https://www.alipayhk.com/zh/promotion/",
    "sourceHint": "app",
    "sourceNote": "AlipayHK 即減券、快閃優惠多數只在 App 領取；官網優惠專區資訊有限，無法代替打開 App。",
    "enabled": true
  }
];
