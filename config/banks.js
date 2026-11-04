/**
 * 香港銀行與支付平台監測清單（組態驅動）
 *
 * - 由 Dashboard「⚙️ 管理監控平台」透過 GitHub Contents API 寫入，或直接在 GitHub 編輯本檔。
 * - url 必須是該平台公開的優惠總覽頁（官方網域），爬蟲只造訪此頁並擷取頁面上真實 <a href>。
 * - enabled: false 可暫時停用而不刪除。
 */
module.exports = [
  {
    "id": "hsbc",
    "name": "滙豐銀行",
    "nameEn": "HSBC",
    "url": "https://www.hsbc.com.hk/zh-hk/credit-cards/",
    "enabled": true
  },
  {
    "id": "hangseng",
    "name": "恒生銀行",
    "nameEn": "Hang Seng",
    "url": "https://www.hangseng.com/zh-hk/personal/cards/spending-privileges/offers-of-the-month-all/month-creditcard/",
    "enabled": true
  },
  {
    "id": "boc",
    "name": "中銀香港",
    "nameEn": "BOCHK",
    "url": "https://www.bochk.com/tc/creditcard/promotions/offers.html",
    "enabled": true
  },
  {
    "id": "sc",
    "name": "渣打銀行",
    "nameEn": "Standard Chartered",
    "url": "https://www.sc.com/hk/zh/credit-cards/offers/",
    "enabled": true
  },
  {
    "id": "mox",
    "name": "Mox Bank",
    "nameEn": "Mox",
    "url": "https://mox.com/zh/promotions/",
    "enabled": true
  },
  {
    "id": "bea",
    "name": "東亞銀行",
    "nameEn": "BEA",
    "url": "https://www.hkbea.com/html/tc/bea-credit-card-hot-promotions.html",
    "enabled": true
  },
  {
    "id": "alipayhk",
    "name": "AlipayHK",
    "nameEn": "AlipayHK",
    "url": "https://www.alipayhk.com/zh/promotion/",
    "enabled": true
  }
];
