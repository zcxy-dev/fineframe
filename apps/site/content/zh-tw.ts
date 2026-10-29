import type { Content } from "../lib/content.ts";
import { DOWNLOADS } from "../lib/site.ts";

const BUYER = "https://www.paddle.com/legal/buyer-terms";
const CONTACT =
  "如有任何問題，請來信 [support@fineframe.app](mailto:support@fineframe.app) 與我們聯繫。";
const UPD = "最後更新：2026 年 10 月 29 日。";
const SELLER = "Fineframe App 與本網站由 Fineframe（以下稱「我們」）開發與提供。";

export const zhTw: Content = {
  languageName: "繁體中文",
  skip: "跳到主要內容",
  nav: {
    home: "Fineframe 首頁",
    examples: "成片範例",
    features: "功能",
    pricing: "價格",
    faq: "常見問題",
    download: "下載",
    account: "帳號",
    signIn: "登入",
    getStarted: "查看方案",
    language: "語言",
  },
  footer: {
    tagline: "你只管拍，剪好的直接發。",
    product: "產品",
    account: "帳號",
    signUp: "建立帳號",
    legal: "法律條款",
    terms: "服務條款",
    privacy: "隱私權政策",
    refund: "退款政策",
    credits: "素材出處",
    rights: "© 2026 Fineframe",
  },
  home: {
    title: "Fineframe｜你只管拍，剪好的直接發",
    description:
      "你只管拍，剪好的直接發。Fineframe 在你的電腦上完成剪接、字幕和配樂，中英夾雜也聽得懂。支援 Mac、Windows 和 Linux。",
    hero: {
      title: ["你只管拍", "剪好的直接發"],
      lede: "素材丟進來，剪接、字幕、配樂一次完成，中英夾雜也聽得懂。",
      plans: "查看方案與價格",
      phone: "到下載頁看電腦版",
      watch: "看一支成片",
      facts: ["Mac（Apple 晶片）・Windows・Linux", "每月 15 美元，或每年 120 美元"],
      post: "22 分鐘的對談剪成 50 秒",
      steps: ["聽寫每一句", "挑出講得最好的段落", "裁成直式", "檢查每個剪接點", "完成・0:50・9:16"],
      credit: "素材：NASA 公有領域影片，不代表 NASA 背書",
      pause: "暫停",
      play: "播放",
    },
    features: {
      title: ["從剪接到配樂", "一次完成"],
      lede: "以下功能現在的 App 都有。",
      cut: {
        title: ["剪掉贅字和停頓", "長度剛剛好"],
        body: "挑出講得最好的段落，長度誤差不超過 5%，每個剪接點都會對照前後的字句檢查。",
        words: [
          ["嗯", true],
          ["那個", true],
          ["今天", false],
          ["想跟大家", false],
          ["聊聊", false],
          ["就是", true],
          ["我最近的", false],
          ["拍片流程", false],
        ],
        sample: "示意",
        target: "目標長度",
        result: "剪完",
      },
      captions: {
        title: ["字幕跟著說話", "一個字一個字出現"],
        body: "中文用台灣繁體，中英夾雜也對得上。",
        credit: "畫面：極客灣Geekerwan，CC BY 3.0，與本產品無關",
      },
      music: {
        title: ["有人說話", "音樂自動變小聲"],
        body: "開口時配樂壓低，停下來再回來。內建曲庫都是 CC0。",
        voice: "人聲",
        music: "音樂",
      },
      more: "另外還有名牌與標題、B-roll、品牌套組、一次剪出多支短影音，也能匯出到 Final Cut Pro、DaVinci Resolve 和 Premiere Pro。",
    },
    formats: {
      title: ["直的給 Reels", "橫的給 YouTube"],
      lede: "同一份素材，選好比例就好。這支是太空人訪談剪成的 59 秒 YouTube 影片。",
      spec: [
        ["長度", "0:59・16:9"],
        ["字幕", "逐字跟上"],
        ["名牌與標題", "自動加上"],
        ["音樂", "內建 CC0 曲庫"],
        ["你要做的", "選長度和比例"],
      ],
      tracks: ["畫面", "字幕", "名牌與標題", "音樂"],
      name: "Christina Koch",
      nameTitle: "Meet Christina Koch",
      credit: "素材：NASA 公有領域影片，不代表 NASA 背書",
    },
    privacy: {
      title: ["在你的電腦上剪", "影片檔不上傳"],
      lede: "分析和輸出都在你的電腦上進行。Claude 用你自己的 Anthropic 金鑰規劃剪輯，收到的主要是這三樣，從不包含影片檔。",
      stays: { title: "留在你的電腦上", items: ["影片檔", "分析結果", "專案和品牌套組"] },
      sent: { title: "送給 Claude", items: ["逐字稿", "每個檔案的基本資訊", "剪接點前後的畫面"] },
      more: "[App 送出的所有資料和去處](/privacy/)",
    },
    pricing: {
      title: ["一個完整的 App", "每月 15 美元"],
      lede: "月繳和年繳是同一個完整的 App，只差在扣款週期。購買前需要先建立免費的 Fineframe 帳號。",
      cost: "Claude 的費用另計，用你自己的 Anthropic API 金鑰：1 分鐘以內的影片約 0.20 到 0.60 美元，5 分鐘約 1 到 1.20 美元。每次剪輯前 App 都會先估算。",
      more: "[完整價格說明](/pricing/)",
    },
    faq: {
      title: "購買前你可能想知道",
      items: [
        {
          q: "開始用需要準備什麼？",
          a: "一台支援的電腦、Fineframe 方案，和你自己的 [Anthropic API 金鑰](https://console.anthropic.com/settings/keys)。第一次打開時，App 會安裝約 2 GB 的分析元件。",
        },
        {
          q: "支援哪些電腦？",
          a: "Apple 晶片的 Mac（M1 或更新）、x64 的 Windows 10 或 11，以及 x86-64 的 Linux。不支援 Intel 處理器的 Mac。",
        },
        {
          q: "電腦記憶體不夠怎麼辦？",
          a: "記憶體少於 12 GB 時，改用你自己的 OpenRouter 金鑰在雲端聽寫語音，每小時素材約 0.03 美元。App 會先告訴你，兩種方式都能選。",
        },
        {
          q: "聽得懂哪些語言？",
          a: "中文、英文，以及中英夾雜。中文字幕是台灣繁體，App 本身有繁體中文和英文介面。",
        },
        {
          q: "剪好的影片還能改嗎？",
          a: "可以。從逐字稿刪掉字句、換字幕樣式，每一版都會留著。也能匯出到 Final Cut Pro、DaVinci Resolve 或 Premiere Pro 接著剪。",
        },
        {
          q: "可以退款嗎？",
          a: "沒有免費試用。方案的首次付款可在 14 天內申請退款，每位客戶限一次；續訂款項不退。請見[退款政策](/refund/)。",
        },
      ],
    },
    close: { title: ["下一支影片", "不用自己剪"] },
  },
  download: {
    title: "下載 Fineframe",
    description: "Apple 晶片 Mac、Windows 和 Linux 的安裝檔，不需要另外安裝其他軟體。",
    lede: "下載安裝檔就能用，不必另外裝 Node、Python 或命令列工具。用有訂閱方案的帳號登入。",
    needs: "需要有效的 Fineframe 方案才能使用。[查看方案](/pricing/)",
    phone: "Fineframe 在電腦上執行。請用電腦打開這一頁，或把連結傳給自己。",
    share: "傳送連結",
    copied: "已複製連結",
    table: { computer: "電腦", installer: "安裝檔", get: "下載" },
    platforms: [
      {
        id: "mac",
        name: "macOS",
        requirement: "需要 Apple 晶片（M1 或更新）",
        file: "Fineframe-mac-arm64.dmg",
        button: "下載 Mac 版",
        steps: [
          "打開 DMG，把 Fineframe 拖進「應用程式」。",
          "App 還沒有 Apple Developer ID 簽署，第一次打開時，macOS 會說無法檢查它是否含有惡意軟體。請選**完成**。",
          "打開**系統設定 → 隱私權與安全性**，捲到「安全性」，在 Fineframe 的訊息旁選**強制打開**，再輸入密碼確認。之後就能直接打開。",
          "不支援 Intel 處理器的 Mac：分析用的函式庫已經不再提供 Intel 版本。",
        ],
        update:
          "App 有新版本時會通知你並附上下載連結，直接安裝覆蓋舊版即可。你的金鑰和下載過的元件都會保留。",
      },
      {
        id: "windows",
        name: "Windows",
        requirement: "Windows 10 或 11（x64）",
        file: "Fineframe-win-x64.exe",
        button: "下載 Windows 版",
        steps: [
          "打開安裝檔。它只裝在你的使用者帳號，不需要系統管理員權限，裝好會自動打開。",
          "安裝檔還沒有簽署，所以 Microsoft Defender SmartScreen 可能顯示「Windows 已保護您的電腦」。請選**其他資訊**，確認 App 是 Fineframe，再選**仍要執行**。",
        ],
        update:
          "App 會自動更新：在背景下載新版本，重新啟動或結束 App 時安裝。你的金鑰和下載過的元件都會保留。",
      },
      {
        id: "linux",
        name: "Linux",
        requirement: "Linux（x86-64）",
        file: "Fineframe-linux-x86_64.AppImage",
        button: "下載 Linux 版",
        steps: [
          "用 `chmod +x Fineframe-*.AppImage` 讓 AppImage 可以執行，再打開它。",
          "AppImage 需要 FUSE 2：Ubuntu 24.04 請執行 `sudo apt install libfuse2t64`。",
        ],
        update:
          "App 會自動更新：在背景下載新版本，重新啟動或結束 App 時安裝。你的金鑰和下載過的元件都會保留。",
      },
    ],
    firstOpenTitle: "第一次打開時",
    firstOpen: [
      "在瀏覽器登入有訂閱方案的 Fineframe 帳號。",
      "貼上你的 [Anthropic API 金鑰](https://console.anthropic.com/settings/keys)，App 會確認它能用。",
      "同時 App 會安裝一次分析元件，約 2 GB 的 Python 和 PyTorch，視窗裡會顯示進度。",
      "第一次剪輯時會下載其餘元件，各有自己的進度條：語音模型、FFmpeg、特效算圖器，以及第一次匯入連結時用的 yt-dlp。",
      "記憶體少於 12 GB 的電腦，會改用 OpenRouter 聽寫語音，用你的 [OpenRouter API 金鑰](https://openrouter.ai/settings/keys)，每小時素材約 0.03 美元。App 會先告訴你，兩種方式都能選。",
    ],
    verifyTitle: "更新與檢查碼",
    update:
      "Windows 和 Linux 版會自動更新：在背景下載新版本，重新啟動或結束 App 時安裝。Mac 版有新版本時會通知你並附上下載連結，直接安裝覆蓋舊版即可。你的金鑰和下載過的元件都會保留。",
    verify: [
      `[SHA256SUMS](${DOWNLOADS}/SHA256SUMS) 列出每個安裝檔的 SHA-256，可以用來核對你下載的檔案。`,
    ],
  },
  pricing: {
    title: "價格",
    heading: ["同一個完整的 App", "兩種付費方式"],
    description: "Fineframe 每月 15 美元或每年 120 美元，兩種方案是同一個完整的 App。",
    lede: "兩種方案的功能完全相同：每月付 15 美元，或每年付一次 120 美元，等於每月 10 美元。",
    plans: [
      { name: "月繳", price: "US$15", period: "/ 月", billing: "每月扣款" },
      {
        name: "年繳",
        price: "US$120",
        period: "/ 年",
        billing: "等於每月 10 美元，每年扣款一次",
        save: "省 60 美元",
      },
    ],
    checkout: "即將開放購買",
    terms: "隨時可取消，首次付款 14 天內可退款。",
    afterTitle: "訂閱之後",
    after: [
      "[下載](/download/)你電腦的 Fineframe。",
      "打開 App，用這個帳號登入。",
      "貼上你的 [Anthropic API 金鑰](https://console.anthropic.com/settings/keys)，開始第一支影片。",
    ],
    includedTitle: "兩種方案都包含",
    included: [
      "Apple 晶片 Mac、Windows 和 Linux 版 Fineframe",
      "15 秒到 1 小時的影片，9:16、1:1 或 16:9",
      "一次剪出多支短影音、品牌套組、動態圖像和 B-roll",
      "分析和輸出都在你的電腦上進行",
    ],
    keyTitle: "Claude 的費用",
    key: [
      "Fineframe 用你自己的 Anthropic API 金鑰，請 Claude 規劃和檢查每支影片，費用由 Anthropic 直接向你收取：1 分鐘以內的影片約 0.20 到 0.60 美元，5 分鐘約 1 到 1.20 美元。這筆錢不經過 Fineframe。",
    ],
    refundTitle: "首次付款 14 天內可退款",
    refund: [
      "沒有免費試用。如果 Fineframe 不適合你，方案的首次付款可以在 14 天內申請退款，每位客戶限一次；續訂款項不退。請見[退款政策](/refund/)。",
    ],
  },
  legal: {
    terms: {
      title: "服務條款",
      description: "使用 Fineframe 與 fineframe.app 的條款。",
      intro: ["本條款適用於 Fineframe App 與本網站。"],
      updated: UPD,
      sections: [
        { heading: "服務提供者", body: [SELLER, CONTACT] },
        {
          heading: "你的授權",
          body: [
            "在訂閱有效期間，你可以在你自己的電腦上安裝與使用 Fineframe。Fineframe 是授權給你使用，而非出售，且授權僅限你個人：你不得複製、轉售或散布 App，也不得反編譯或還原工程，但法律另有允許者除外。",
          ],
        },
        {
          heading: "訂閱與付款",
          body: [
            "兩種方案都提供同樣完整的 App，只有扣款週期與價格不同。方案依[價格頁](/pricing/)上的價格，以美元按月或按年預先收費，並在你取消前自動續訂。取消後不會再續訂，App 可以用到已付費期間結束。",
            `Fineframe 透過 Paddle.com 銷售：Paddle 是我們的線上經銷商，也是每筆訂單的記錄商家（Merchant of Record）。付款、帳單、稅金與發票都由 Paddle 處理，你的購買適用 Paddle 的[買方條款](${BUYER})。`,
            "價格調整從你下一次續訂起適用，我們會事先通知你。",
          ],
        },
        {
          heading: "退款",
          body: [
            "Fineframe 沒有免費方案，也沒有免費試用。方案的首次付款可在 14 天內退款，每位客戶限一次，續訂款項不予退款；申請方式見[退款政策](/refund/)。",
          ],
        },
        {
          heading: "你的 API 金鑰與其他服務",
          body: [
            "Fineframe 使用你自己的 Anthropic API 金鑰規劃與檢查每支影片；若你提供，也會使用你的 OpenRouter、Pexels 或 Pixabay 金鑰。這些服務的費用由你依各自的條款直接支付，不包含在訂閱費中，我們也無法退還。[隱私權政策](/privacy/)說明 App 會送出哪些資料給各個服務。",
          ],
        },
        {
          heading: "你的素材與影片",
          body: [
            "你的素材，以及 Fineframe 用它做出的影片，都屬於你。你必須有權使用你提供給 App 的所有內容：素材、連結的影片、音樂、Logo 與字型。",
          ],
        },
        {
          heading: "開放原始碼元件",
          body: [
            "Fineframe 會下載並執行開放原始碼元件，例如 FFmpeg 以及語音與分析模型，各自依其授權條款提供，App 的授權聲明中有完整列表。",
          ],
        },
        {
          heading: "不提供保證",
          body: ["Fineframe 依現狀提供。自動剪輯可能出錯：發布前請先看過影片。"],
        },
        {
          heading: "責任限制",
          body: [
            "在法律允許的範圍內，我們對你的全部責任，以你在求償前 12 個月內為 Fineframe 支付的金額為上限。",
          ],
        },
        {
          heading: "條款變更",
          body: ["本條款若有新版本，會連同日期公布在此頁。重大變更從你下一次續訂起適用。"],
        },
        {
          heading: "準據法",
          body: ["本條款以中華民國（台灣）法律為準據法。"],
        },
      ],
    },
    privacy: {
      title: "隱私權政策",
      description: "Fineframe App 與 fineframe.app 會送出哪些資料、送給誰、在什麼時候。",
      intro: [
        "Fineframe 在你自己的電腦上剪輯影片。本政策說明 App 與本網站會送出哪些資料、送給誰、在什麼時候。",
      ],
      updated: UPD,
      sections: [
        { heading: "服務提供者", body: [SELLER, CONTACT] },
        {
          heading: "本網站",
          body: [
            "fineframe.app 不使用 Cookie，也不執行任何分析或追蹤。本網站架設在 Cloudflare Pages 上：和所有網站主機一樣，Cloudflare 會收到每個請求本來就帶有的技術資訊，例如你的 IP 位址與瀏覽器，用來提供網頁。",
            "你登入後，網站會把登入狀態存在瀏覽器的本機儲存空間（local storage），而不是 Cookie，直到你登出為止。",
            "安裝檔從 downloads.fineframe.app 下載，範例影片從本網站播放，兩者都由 Cloudflare 提供，情形同上。",
          ],
        },
        {
          heading: "你的帳號",
          body: [
            "你的 Fineframe 帳號保存你的電子郵件地址，以及你密碼的雜湊值；如果你用 Google 登入，則保存 Google 提供的姓名、電子郵件地址與大頭貼。帳號也記錄你註冊與最近登入的時間，登入紀錄會記下每次登入來自的 IP 位址。訂閱後，帳號還會保存 Paddle 傳給我們的訂閱狀態、方案與續訂日期。",
            "帳號由我們的帳號服務供應商 Supabase 保存在東京，適用 [Supabase 的隱私權政策](https://supabase.com/privacy)。App 登入帳號只是為了確認你可以使用 Fineframe；App 不會傳送使用資料、素材或金鑰給我們。",
          ],
        },
        {
          heading: "付款",
          body: [
            `Fineframe 透過 Paddle.com 銷售，Paddle 是每筆訂單的記錄商家（Merchant of Record）。你訂閱時，Paddle 會依它自己的[隱私權聲明](https://www.paddle.com/legal/privacy)收集你的付款與帳單資料，用來收款、計算正確的稅金並開立發票。我們看不到你的信用卡資料。`,
          ],
        },
        {
          heading: "留在你電腦上的資料",
          body: [
            "你的素材與它的分析結果、你的影片、專案與品牌套組都留在你的電腦上，分析與算圖也在那裡進行。不會上傳任何影片檔；除非你使用雲端語音辨識，否則也不會送出任何音訊。",
            "你的 API 金鑰存放在 App 資料夾中、只有你的使用者帳號能讀取的檔案裡。每把金鑰只會送到它自己的服務。",
          ],
        },
        {
          heading: "Anthropic（Claude）",
          body: ["App 會用你的 Anthropic API 金鑰，送給 Anthropic："],
          list: [
            "**規劃影片時：**每個檔案的逐字稿，以及檔名、長度、畫面尺寸、鏡頭切換、停頓、音量高點與聲音事件；你列出的人名；你告訴 Claude 的需求；以及你提供的每首音樂的檔名、長度、速度、各段音量與授權名稱。",
            "**為多支短片找段落時：**每個檔案的上述資料（人名除外），以及你對短片的要求。",
            "**撰寫動態圖像時：**影片的字句與時間點、影片的尺寸與長度、字幕與人臉在畫面中的位置、畫面切換的時間點，以及已有 B-roll 和其他疊加元素的時段；某個圖像沒通過檢查時，附上它畫出來的樣子、它的程式碼、它的問題，以及前後說的字句。",
            "**檢查剪接點時：**每個剪接點前後兩秒的八格畫面與波形圖，以及前後的字句。",
            "**螢幕錄影的標註：**每個預計的標註送出一格畫面，以及當時說的那句話。",
            "**逐字稿校正（需自行開啟）：**逐字稿、影片標題（預設為檔名），以及你的人名與詞彙。",
            "**檢查金鑰時：**查詢規劃模型的資訊，不會產生費用。",
          ],
        },
        {
          heading: "OpenRouter",
          body: [
            "使用你的 OpenRouter API 金鑰，而且只在使用雲端語音辨識時：由你選擇，或在你的電腦記憶體不足以執行本機語音模型時由 App 提議。App 會把語音切成最長 30 秒的音訊片段送出，由模型供應商轉成文字。檢查 OpenRouter 金鑰時，只會讀取金鑰本身的資訊。",
          ],
        },
        {
          heading: "B-roll 補充畫面",
          body: ["豐富模式（預設）的 B-roll 不會送出你影片的任何內容，但會從網路取得資料："],
          list: [
            "**講者提到的網頁：**App 會用無頭 Chrome、每次都用全新的設定檔，打開 Claude 從逐字稿挑出的每個網頁並擷取畫面，所以該網站會看到一次來自你電腦的造訪。它不會填寫表單、登入或接受同意橫幅。",
            "**素材庫影片：**Claude 寫的搜尋字詞會用你自己的金鑰送到 Pexels 或 Pixabay，挑中的影片也從那裡下載。",
          ],
        },
        {
          heading: "你匯入的連結",
          body: [
            "App 會用 yt-dlp 從連結指向的網站取得影片；yt-dlp 從 GitHub 下載並保持最新。不會送出任何你的資料；該網站會看到來自你電腦的請求。",
          ],
        },
        {
          heading: "第一次使用時的下載",
          body: [
            "App 會從各元件的發行者下載它們：Python 與分析用套件、來自 Hugging Face 的語音與分析模型、來自 GitHub 的 FFmpeg、來自 Google 的 Chrome Headless Shell，以及來自 npm 的圖示。這些請求不帶有任何你影片的內容。",
          ],
        },
        {
          heading: "你的資料與權利",
          body: [
            "我們持有的個人資料只有你的帳號。如果想查看或刪除，請用帳號的電子郵件地址寫信到 [support@fineframe.app](mailto:support@fineframe.app)。Anthropic、OpenRouter、Pexels 或 Pixabay 持有的資料，請向它們查詢。關於本政策的問題：[support@fineframe.app](mailto:support@fineframe.app)。",
          ],
        },
        {
          heading: "政策變更",
          body: ["本政策若有新版本，會連同日期公布在此頁。"],
        },
      ],
    },
    refund: {
      title: "退款政策",
      description: "方案的首次付款可在 14 天內透過 Paddle 申請退款，每位客戶限一次。",
      intro: ["Fineframe 沒有免費方案，也沒有免費試用。本政策說明方案的付款在什麼情況下可以退款。"],
      updated: UPD,
      sections: [
        {
          heading: "首次付款 14 天內可退款",
          body: [
            "如果 Fineframe 不適合你，請在首次支付方案費用後 14 天內提出，該筆款項會全額退還，不需要說明原因。",
          ],
        },
        {
          heading: "每位客戶限一次",
          body: ["每位客戶只能退款一次。之後再訂閱任一方案，都不會再次退款。"],
        },
        {
          heading: "如何申請",
          body: [
            "Fineframe 透過 Paddle.com 銷售，Paddle 是每筆訂單的記錄商家（Merchant of Record），所以退款由 Paddle 處理：請到 [paddle.net](https://paddle.net) 找到你的訂單並在那裡申請。款項會退回你原本的付款方式，退款完成時訂閱即終止。",
          ],
        },
        {
          heading: "續訂",
          body: ["續訂的款項不予退款。請在續訂前取消；App 可以用到已付費期間結束。"],
        },
        {
          heading: "其他服務",
          body: [
            "你用自己的金鑰支付給 Anthropic、OpenRouter 或其他服務的費用，屬於你與它們之間的事，我們無法退還。",
          ],
        },
        {
          heading: "你的法定權利",
          body: [
            `Paddle 作為記錄商家，也適用它的[買方條款](${BUYER})；你所在地的消費者保護法同樣適用。兩者都可能給你比本政策更多的權利。`,
          ],
        },
        { heading: "服務提供者", body: [SELLER, CONTACT] },
      ],
    },
    credits: {
      title: "素材出處",
      description: "fineframe.app 上的影片素材出處。",
      intro: [
        "首頁播放的片段，都是 Fineframe 用下面三支影片剪成的成片，各依其授權使用。片中的人物和機構都沒有為 Fineframe 背書。",
      ],
      sections: [
        {
          heading: "Don Pettit 在太空站觀景窗",
          body: [
            "首頁最上方的素材與成片 Reels：NASA〈[NASA Astronaut Don Pettit Talks with the Everyday Astronaut](https://images.nasa.gov/details/iss072m263521849_NASA_Astronaut_Don_Pettit_Talks_with_the_Everyday_Astronaut_241217)〉，2024 年 12 月 17 日，屬公有領域。NASA 並未為 Fineframe 背書。",
          ],
        },
        {
          heading: "Christina Koch 的 Artemis II 訪談",
          body: [
            "YouTube 成片：NASA〈[Christina Koch Artemis II Crew Announcement Resource Reel](https://images.nasa.gov/details/jsc2023m000095_Christina_Koch_Artemis_II_Crew_Announcement_Resource_Reel-social)〉，2023 年 4 月 3 日，屬公有領域。NASA 並未為 Fineframe 背書。",
          ],
        },
        {
          heading: "極客灣Geekerwan 的訪談",
          body: [
            "字幕片段：極客灣Geekerwan〈[采访vivo & MediaTek研发大佬：蓝厂与天玑合作背后的故事](https://www.youtube.com/watch?v=_G4e2p1p-is)〉，2025 年 1 月 4 日，以 [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) 授權（[Wikimedia Commons 上的檔案](https://commons.wikimedia.org/wiki/File:%E9%87%87%E8%AE%BFvivo_%26_MediaTek%E7%A0%94%E5%8F%91%E5%A4%A7%E4%BD%AC%EF%BC%9A%E8%93%9D%E5%8E%82%E4%B8%8E%E5%A4%A9%E7%8E%91%E5%90%88%E4%BD%9C%E8%83%8C%E5%90%8E%E7%9A%84%E6%95%85%E4%BA%8B.webm)）。Fineframe 把它剪成 44 秒的直式影片，加上繁體中文字幕、配樂和圖像。極客灣、vivo 和聯發科都與 Fineframe 無關。",
          ],
        },
      ],
    },
  },
  checkout: {
    subscribe: "訂閱",
    subscribed: "你已經訂閱了。請到[帳號](/account/)管理訂閱。",
    failed: "結帳視窗無法開啟，請稍後再試。",
  },
  auth: {
    email: "電子郵件",
    password: "密碼",
    google: "使用 Google 繼續",
    or: "或",
    working: "請稍候…",
    signIn: {
      title: "登入",
      description: "登入你的 Fineframe 帳號。",
      submit: "登入",
      forgot: "忘記密碼？",
      switchPrompt: "第一次使用 Fineframe？",
      switchLink: "建立帳號",
      forPlan: "登入後，就會打開{plan}的結帳畫面。",
    },
    signUp: {
      title: "建立帳號",
      description: "建立 Fineframe 帳號，就能訂閱並登入 App。",
      submit: "建立帳號",
      passwordHint: "至少 8 個字元。",
      agree: "建立帳號即表示你同意[服務條款](/terms/)與[隱私權政策](/privacy/)。",
      switchPrompt: "已經有帳號了？",
      switchLink: "登入",
      sent: "請查看收件匣：我們已寄信到 {email}，打開信裡的連結確認信箱後就會自動登入。",
      forPlan: "建立帳號並確認信箱後，就會打開{plan}的結帳畫面。",
      sentPlan:
        "請查看收件匣：我們已寄信到 {email}，打開信裡的連結確認信箱後，就會打開{plan}的結帳畫面。",
    },
    reset: {
      title: "重設密碼",
      description: "取得連結，為你的 Fineframe 帳號設定新密碼。",
      lede: "輸入帳號的電子郵件，我們會寄給你一個設定新密碼的連結。",
      submit: "寄送連結",
      sent: "如果有帳號使用 {email}，重設密碼的連結已經寄出。",
      newTitle: "設定新密碼",
      newPassword: "新密碼",
      save: "儲存密碼",
      back: "回到登入",
    },
    errors: {
      invalid: "電子郵件或密碼不正確。",
      unconfirmed: "請先確認你的電子郵件：打開我們寄給你的連結。",
      weak: "請設定更長的密碼，至少 8 個字元。",
      address: "這個電子郵件地址無法使用，請換一個。",
      rate: "嘗試次數太多，請等一分鐘再試。",
      generic: "發生錯誤，請再試一次。",
    },
  },
  account: {
    title: "帳號",
    description: "你的 Fineframe 訂閱、帳單與下載。",
    signedInAs: "目前登入",
    signOut: "登出",
    subscriptionTitle: "訂閱",
    statusTitle: "狀態",
    plans: { monthly: "月繳方案", yearly: "年繳方案" },
    status: {
      none: "尚未訂閱",
      noneNote: "Fineframe 需要有效的方案才能使用。",
      soon: "開放購買後，就能在這裡選擇方案。",
      active: "訂閱中",
      renews: "將於 {date} 續訂。",
      cancelled: "已取消",
      until: "Fineframe 可以使用到 {date}。",
      pastDue: "付款逾期",
      pastDueNote: "上一筆付款沒有成功。請更新付款方式，Fineframe 才能繼續使用。",
      paused: "已暫停",
      ended: "已結束",
      confirming: "已收到付款，正在確認你的訂閱…",
    },
    choose: "選擇方案",
    manage: "管理帳單",
    manageNote: "在 Paddle 的客戶入口變更方案或付款方式、查看發票或取消訂閱。",
    downloadTitle: "下載",
    downloadBody: "安裝 Fineframe，打開後用這個帳號登入。",
    download: "下載 Fineframe",
  },
  authorize: {
    title: "登入 App",
    description: "登入這台電腦上的 Fineframe App。",
    lede: "這台電腦上的 Fineframe App 要求以 {email} 登入。",
    shares: "App 會取得這個帳號的電子郵件地址和方案是否有效，不會取得你的密碼。",
    noPlan: "這個帳號還沒有方案。[選擇方案](/pricing/)後就能使用 Fineframe。",
    allow: "登入 App",
    deny: "取消",
    switch: "使用其他帳號",
    done: "完成了，你可以回到 App。",
    invalid: "這個登入要求已經過期，請從 App 重新開始。",
  },
  notFound: {
    title: "找不到頁面",
    body: "這個網址沒有頁面。",
    home: "回到首頁",
  },
};
