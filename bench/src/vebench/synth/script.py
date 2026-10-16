"""What the synthetic corpus says and shows.

Lines are Taiwan Traditional Chinese with English mixed into sentences, as the truth transcript
spells them. `{...}` marks a filler the edit should remove; the braces are not spoken or written.
The same word outside braces ("那個 click 聲", that click) is speech and stays.
"""

import re
from dataclasses import dataclass, field

FILLER = re.compile(r"\{([^{}]+)\}")


@dataclass(frozen=True)
class Line:
    speaker: str
    text: str


@dataclass(frozen=True)
class Pause:
    """A long silence the edit should shorten; its length is drawn from the seed."""

    low: float = 2.0
    high: float = 5.0


@dataclass(frozen=True)
class Retake:
    """Attempts at one line, in order; the edit should keep the last, clean one.

    Each abandoned take holds the words that abandon it ("{嗯}，不對，我重講一次。"). A take
    written as a tuple is spoken as separate phrases with a breath between them.
    """

    speaker: str
    takes: tuple[str | tuple[str, ...], ...]


def phrases(take: str | tuple[str, ...]) -> tuple[str, ...]:
    return (take,) if isinstance(take, str) else take


@dataclass(frozen=True)
class Section:
    """Starts a stretch of the story; `order` is its place in the group's finished edit."""

    order: int
    topic: str


@dataclass(frozen=True)
class Show:
    """Switches the picture just before the next line: a camera or a screen recording."""

    view: str
    dissolve: bool = False
    text: tuple[str, ...] = ()


@dataclass(frozen=True)
class Clip:
    name: str
    group: str
    style: str  # talk: cameras and screens as scripted; multicam: cut to whoever speaks;
    # phone: one handheld shot; screen: screen recording only
    fps: int
    items: tuple
    portrait: bool = False
    speakers: tuple[str, ...] = field(default=("A",))


def parse(text: str) -> tuple[str, list[tuple[int, int]]]:
    """Strip filler marks: the spoken text and each filler's character span in it."""
    plain, spans, last = "", [], 0
    for m in FILLER.finditer(text):
        plain += text[last : m.start()]
        spans.append((len(plain), len(plain) + len(m.group(1))))
        plain += m.group(1)
        last = m.end()
    return plain + text[last:], spans


A, B = "A", "B"

TALK_A1 = Clip("talk-a1", "talk-a", "talk", 25, (
    Section(1, "開場與動機"),
    Show("wide"),
    Line(A, "{嗯}，大家好，歡迎回到我的頻道。"),
    Line(A, "今天這一集，我們要來聊 automatic video editing，也就是自動剪輯。"),
    Line(A, "{那個}，先講一下我為什麼會想做這個主題。"),
    Line(A, "在開始之前，我先介紹一下我自己。"),
    Line(A, "我是一個做教學影片的 YouTuber，平常主要講 programming 跟一些工具。"),
    Line(A, "{嗯}，頻道開了三年，影片大概有一百多支。"),
    Line(A, "老實說，剪片一直是我最不喜歡的部分。"),
    Line(A, "錄影很快，可是剪一支十分鐘的影片，常常要花四五個小時。"),
    Line(A, "所以去年開始，我就想說，能不能讓電腦幫我做這件事。"),
    Line(A, "{um}，一開始我試了很多現成的工具，但每一個都差一點點。"),
    Line(A, "有的不支援中文，有的字幕都是簡體字，還要自己再改一遍。"),
    Show("close"),
    Line(A, "我每個禮拜都要剪三四支影片，光是挑 take 就要花一整個晚上。"),
    Line(A, "而且很多時候，{um}，素材裡面有一堆停頓跟口頭禪。"),
    Pause(),
    Line(A, "像剛剛那樣的停頓，其實觀眾一點都不想看。"),
    Retake(A, (
        ("所以我的目標是，把一個小時的素材，剪成，", "{嗯}，不對，我重講一次。"),
        "所以我的目標是，把一個小時的素材，自動剪成五分鐘的精華。",
    )),
    Show("slide", text=(
        "Why automatic editing?", "Hours of raw footage", "Fillers and long pauses",
        "Retakes everywhere",
    )),
    Line(A, "我們先看一下這張投影片。"),
    Line(A, "第一個問題是素材太長，第二個是 filler words 太多。"),
    Line(A, "第三個，也是最麻煩的，就是 retake。"),
    Line(A, "{uh}，講錯一句話就要整句重來，剪的時候還要自己找哪一個 take 比較好。"),
    Show("close", dissolve=True),
    Line(A, "所以這個 project 想做的事情很單純。"),
    Line(A, "你把 footage 丟進去，選一個長度跟比例，它就幫你剪好。"),
    Line(A, "包含字幕，而且字幕是台灣的繁體中文，英文也會保留下來。"),
    Line(A, "{嗯}，因為我的觀眾大部分在台灣，簡體字幕他們看了會不習慣。"),
    Line(A, "還有很多專有名詞，像是 API 或 GPU，我希望它保持英文。"),
    Line(A, "{那個}，我自己最在意的是，剪出來要像真的人剪的。"),
    Show("wide"),
    Line(A, "不能每一刀都切在字的中間，也不能有奇怪的雜音。"),
    Line(A, "這兩件事聽起來很簡單，可是做起來其實很難。"),
    Line(A, "我們等一下會看到為什麼。"),
    Pause(),
    Line(A, "{嗯}，好，那我們下一段來實際操作看看。"),
))  # fmt: skip

TALK_A2 = Clip("talk-a2", "talk-a", "talk", 25, (
    Section(2, "匯入與分析"),
    Show("close"),
    Line(A, "OK，我們現在進入第二部分，實際操作。"),
    Show("terminal"),
    Line(A, "首先打開 terminal，進到專案的資料夾。"),
    Line(A, "我們把所有的 footage 放在同一個資料夾裡面，不用先整理。"),
    Line(A, "{那個}，檔名也不用改，系統會自己讀 metadata。"),
    Retake(A, (
        ("接下來執行 analyze 的指令，它會先做 shot detection，然後，", "啊，等一下，順序講錯了。"),
        "接下來執行 analyze 的指令，它會先讀檔案資訊，再做 shot detection。",
    )),
    Line(A, "然後是語音辨識，把每一句話都轉成文字。"),
    Line(A, "這一步在 CPU 上會比較慢，如果有 GPU 會快很多。"),
    Line(A, "{嗯}，我自己是用筆電跑，十分鐘的影片大概要等十幾分鐘。"),
    Pause(),
    Show("editor"),
    Line(A, "跑完之後，我們打開這個 JSON 檔案看一下。"),
    Line(A, "每一個字都有開始跟結束的時間，單位是秒。"),
    Line(A, "{um}，你可以看到中文是一個字一個字，英文是一個 word 一個 word。"),
    Line(A, "我們往下捲一點，可以看到每個字的 start 跟 end。"),
    Line(A, "時間準的話，字幕才不會比聲音早出來。"),
    Line(A, "這樣做字幕的時候，才能一個字一個字地亮起來。"),
    Show("close", dissolve=True),
    Line(A, "這裡有一個小地方要注意。"),
    Line(A, "如果你的影片是用手機直拍的，系統會自動判斷方向。"),
    Line(A, "{嗯}，所以不用自己先轉成橫的。"),
    Section(3, "規劃剪輯"),
    Show("wide"),
    Line(A, "分析做完以後，下一步就是規劃要怎麼剪。"),
    Line(A, "這一步是交給 Claude 來決定的。"),
    Line(A, "它會讀整份逐字稿，把重複的 take 挑出最好的一個。"),
    Line(A, "比如說我剛剛有一句講錯重講，它就會留下第二次講的版本。"),
    Line(A, "{那個}，如果兩次都講得不好，它會挑比較完整的那一個。"),
    Line(A, "{uh}，也會把太長的停頓縮短，把口頭禪拿掉。"),
    Line(A, "這些決定最後都會寫進一個 project 檔案裡面。"),
    Line(A, "{um}，這個檔案其實就是一個剪輯的清單。"),
    Line(A, "每一段要用哪個檔案、從幾秒到幾秒，都寫在裡面。"),
    Pause(),
    Show("close"),
    Line(A, "我自己測試的時候，最驚訝的是它很會抓重點。"),
    Line(A, "就算我講話很跳，它還是能排出一個合理的順序。"),
    Line(A, "像我常常講到一半，突然想到另一件事。"),
    Line(A, "它會把這些段落搬到比較適合的位置。"),
    Line(A, "{那個}，當然它也會犯錯，所以最後還是要自己看一遍。"),
))  # fmt: skip

TALK_A3 = Clip("talk-a3", "talk-a", "talk", 25, (
    Section(4, "輸出與字幕"),
    Show("close"),
    Line(A, "好，最後一個部分是輸出。"),
    Show("slide", text=(
        "Export settings", "16:9 for YouTube", "9:16 for Shorts", "Captions burned in",
    )),
    Line(A, "你可以選十六比九，也可以選九比十六。"),
    Line(A, "如果是要上傳 YouTube，我會建議十六比九，五分鐘左右。"),
    Line(A, "如果是 Shorts 或 Reels，就選九比十六，六十秒以內。"),
    Line(A, "{嗯}，九比十六的時候，畫面會自動跟著說話的人。"),
    Line(A, "所以就算你原本是橫著拍的，人也不會被切掉。"),
    Retake(A, (
        ("字幕的部分，預設會用黃色的字，", "{嗯}，不是黃色，我記錯了，重來。"),
        "字幕的部分，預設會用白色的字，加上黑色的外框。",
    )),
    Line(A, "說話的那個字會跳出來，看起來比較有節奏。"),
    Line(A, "字幕的大小也可以調整，預設是畫面寬度的百分之六。"),
    Line(A, "英文單字不會被拆開，一定是一整個 word 一起出現。"),
    Line(A, "{那個}，字幕的位置也會自動避開畫面上的人。"),
    Line(A, "如果畫面下方有字，字幕就會往上移一點。"),
    Show("close", dissolve=True),
    Line(A, "{那個}，還有一點，音量也會自動調整。"),
    Line(A, "不會這一段很大聲，下一段又突然變很小聲。"),
    Line(A, "{嗯}，這個在手機上看的時候特別重要。"),
    Line(A, "因為很多人是在捷運上，用很小的音量在看。"),
    Line(A, "背景音樂也會在講話的時候自動變小。"),
    Line(A, "{uh}，音樂的節拍也會對到剪接點，看起來會比較順。"),
    Line(A, "這個功能我覺得很有趣，下一集再詳細介紹。"),
    Line(A, "最後輸出的檔案會放在同一個資料夾，旁邊還有一個 SRT 字幕檔。"),
    Line(A, "輸出的時間大概是影片長度的一半左右。"),
    Pause(),
    Section(5, "結尾"),
    Show("wide"),
    Line(A, "好，以上就是今天的內容。"),
    Line(A, "{um}，如果你覺得這個 project 有幫助，記得按讚跟訂閱。"),
    Line(A, "如果你有想看的主題，也可以留言告訴我。"),
    Line(A, "{嗯}，我會挑大家最想看的先做。"),
    Line(A, "我們下一集見，bye bye。"),
    Pause(3.0, 5.0),
    # Recorded after the outro, as a hook that opens the finished video.
    Section(0, "開場"),
    Show("close"),
    Line(A, "一個小時的素材，五分鐘自動剪完，而且字幕還是繁體中文。"),
    Line(A, "你沒聽錯，今天就來教你怎麼做到。"),
))  # fmt: skip

CHAT_B1 = Clip("chat-b1", "chat-b", "multicam", 30, (
    Section(1, "開場與介紹"),
    Line(A, "{嗯}，好，我們開始錄了嗎？"),
    Line(B, "開始了，已經在錄了。"),
    Line(A, "OK，大家好，歡迎收聽這一集的 podcast。"),
    Line(A, "今天我請到了我的好朋友阿哲，他是一位 freelance 的剪輯師。"),
    Line(B, "哈囉大家好，我是阿哲。"),
    Line(B, "{那個}，我做剪輯大概七八年了，主要是接 YouTuber 的案子。"),
    Line(A, "七八年，那你應該看過很多很可怕的素材吧。"),
    Line(B, "對，{um}，最可怕的是一次給我三個小時，然後說要剪成十分鐘。"),
    Line(A, "三個小時剪成十分鐘，那你通常怎麼開始？"),
    Line(B, "我會先整個看過一遍，把能用的段落標起來。"),
    Line(B, "{嗯}，這一步其實最花時間。"),
    Pause(),
    Line(A, "那你覺得，哪一種素材最難剪？"),
    Retake(B, (
        ("最難剪的應該是兩個人的訪談，因為，", "{uh}，sorry，我換個說法。"),
        "最難剪的是多機的訪談，因為你要一直決定現在要切到哪一台。",
    )),
    Line(A, "對，像我們現在就有三台 camera。"),
    Line(B, "沒錯，一台拍你，一台拍我，還有一台是全景。"),
    Line(A, "那你會怎麼決定要切哪一台？"),
    Line(B, "基本上誰在講話就切誰，但是不能切得太快。"),
    Line(B, "如果每一句都切，觀眾會覺得很暈。"),
    Line(A, "那你剪一支訪談，通常要花多久？"),
    Line(B, "{嗯}，一個小時的訪談，我大概要剪兩天。"),
    Line(B, "第一天挑段落，第二天處理字幕跟音樂。"),
    Line(A, "兩天，比我想像的還要久。"),
    Line(B, "對，而且客戶常常會改，{um}，改個三四次是很正常的。"),
    Line(A, "那改的時候最常改什麼？"),
    Line(B, "最常改的是順序，他們會說這一段想放到前面。"),
    Line(A, "{那個}，這種我覺得最痛苦。"),
    Line(B, "還好，如果一開始段落有標好，換順序其實很快。"),
    Line(A, "那你標段落的時候，會用什麼工具？"),
    Line(B, "{um}，我就用一個很簡單的 spreadsheet。"),
    Line(B, "每一段寫開始時間、結束時間，還有一句話的重點。"),
    Line(A, "聽起來很像我們這個 project 要自動做的事。"),
    Line(B, "對啊，如果電腦可以幫我標，我會很開心。"),
), speakers=(A, B))  # fmt: skip

CHAT_B2 = Clip("chat-b2", "chat-b", "multicam", 30, (
    Section(2, "AI 工具"),
    Line(A, "那我們來聊聊 AI 工具好了。"),
    Line(A, "你現在工作的時候，會用 AI 幫忙嗎？"),
    Line(B, "會，{那個}，最常用的是自動上字幕。"),
    Line(B, "以前打字幕要打一整天，現在大概十分鐘就有一個初稿。"),
    Line(A, "但是初稿的錯字多嗎？"),
    Line(B, "看情況，如果中英文夾雜，錯字就會比較多。"),
    Line(B, "像我剛剛講的 freelance，有時候會被聽成別的字。"),
    Line(A, "{嗯}，這個我懂，我的名字也常常被打錯。"),
    Pause(),
    Line(A, "那剪輯本身呢？AI 可以幫你決定怎麼剪嗎？"),
    Line(B, "{um}，目前我還是自己剪，但我有試過一些工具。"),
    Retake(B, (
        ("有一個工具可以自動把停頓拿掉，可是它會把，", "{嗯}，等一下，我想一下怎麼講。"),
        "有一個工具可以自動把停頓拿掉，可是有時候會切到一個字的中間。",
    )),
    Line(A, "切到字的中間，聽起來就會很奇怪。"),
    Line(B, "對，而且接起來的地方會有一個很小的 click 聲。"),
    Line(A, "那個 click 聲我也聽過，戴耳機的時候特別明顯。"),
    Line(B, "所以我覺得，好的工具一定要先把這些基本的東西做好。"),
    Line(A, "{uh}，那字幕的時間呢？會不會對不上？"),
    Line(B, "會，特別是英文單字，常常字幕先出來，聲音才到。"),
    Line(A, "那你有遇過聲音跟畫面對不上的問題嗎？"),
    Line(B, "有，{嗯}，特別是用手機錄的影片，越到後面差越多。"),
    Line(B, "一開始只差一點點，到最後可能差了半秒。"),
    Line(A, "半秒其實很明顯，嘴巴跟聲音會對不起來。"),
    Line(B, "沒錯，所以我現在輸出前都會從頭到尾檢查一次。"),
    Pause(),
    Line(A, "{uh}，這樣聽起來，好的工具真的可以幫很多忙。"),
    Line(B, "對啊，只要它不要亂剪就好。"),
    Line(A, "你說的亂剪，是指什麼樣的情況？"),
    Line(B, "{嗯}，比如說把一句話的後半段剪掉，意思就完全變了。"),
    Line(B, "或者是把笑點前面的停頓拿掉，笑點就不好笑了。"),
    Line(A, "{那個}，停頓有時候其實是故意的。"),
    Line(B, "沒錯，所以不是每個停頓都要刪。"),
), speakers=(A, B))  # fmt: skip

CHAT_B3 = Clip("chat-b3", "chat-b", "multicam", 30, (
    Section(3, "建議與結尾"),
    Line(A, "最後一個問題，你會給剛開始學剪輯的人什麼建議？"),
    Line(B, "{嗯}，我會說，先學會看素材。"),
    Line(B, "知道哪一段要留，哪一段要丟，比會用軟體重要很多。"),
    Line(A, "這個建議很實在。"),
    Line(B, "{uh}，還有就是，不要怕刪東西。"),
    Line(B, "很多新手捨不得刪，結果影片拖得很長。"),
    Pause(),
    Line(A, "那工具的部分呢？有推薦的嗎？"),
    Line(B, "工具其實沒有那麼重要，免費的軟體也可以剪得很好。"),
    Line(B, "{那個}，重點是你要剪很多，剪久了就會有自己的節奏。"),
    Line(A, "我同意，我自己也是剪了很多爛片才慢慢進步的。"),
    Line(B, "哈哈，每個人都是這樣開始的。"),
    Line(A, "那你覺得未來剪輯師會被 AI 取代嗎？"),
    Line(B, "{嗯}，我覺得簡單的工作會被取代。"),
    Line(B, "像是上字幕、剪掉停頓這種，AI 已經做得很好了。"),
    Line(B, "但是決定故事要怎麼說，還是需要人。"),
    Line(A, "所以剪輯師要做的是更有創意的部分。"),
    Line(B, "對，{那個}，我反而覺得這是好事，可以把時間花在重要的地方。"),
    Line(A, "我也這麼覺得。"),
    Line(B, "{uh}，不過我也有點擔心，大家剪出來的影片會越來越像。"),
    Line(A, "怎麼說？"),
    Line(B, "因為大家用一樣的工具，節奏跟字幕的樣子都差不多。"),
    Line(A, "{嗯}，所以還是要有自己的風格。"),
    Line(B, "對，工具可以幫你省時間，但風格要自己找。"),
    Line(A, "那你自己的風格是什麼？"),
    Line(B, "{嗯}，我喜歡節奏快一點，但是重要的地方會留白。"),
    Line(B, "讓觀眾有時間消化剛剛聽到的東西。"),
    Line(A, "這個我學到了，下次剪片可以試試看。"),
    Line(B, "{uh}，你一定可以的。"),
    Retake(A, (
        ("好，那今天就聊到這邊，謝謝阿哲，我們下，", "{嗯}，不好意思，口誤，重來一次。"),
        "好，那今天就聊到這邊，謝謝阿哲來上節目。",
    )),
    Line(B, "謝謝你邀請我，大家掰掰。"),
    Line(A, "{um}，我們下一集見，bye。"),
    Pause(),
), speakers=(A, B))  # fmt: skip

PHONE_C = Clip("phone-c", "phone-c", "phone", 30, (
    Section(1, "台南散步"),
    Line(B, "{嗯}，好，現在是早上九點，我在台南。"),
    Line(B, "今天天氣超好，所以我決定走路去吃早餐。"),
    Line(B, "{um}，早上的台南很安靜，路上的人還不多。"),
    Line(B, "{那個}，我後面這條街，就是很有名的老街。"),
    Line(B, "等一下我們會經過一間 coffee shop，我很想去試試看。"),
    Pause(),
    Line(B, "OK，我們到了，就是這一家。"),
    Line(B, "{那個}，門口排了好多人，我們先排隊。"),
    Line(B, "這一家的裝潢很簡單，可是感覺很舒服。"),
    Retake(B, (
        "他們的招牌是手沖的，{uh}，不對不對。",
        "他們的招牌是冷萃咖啡，聽說一天只賣五十杯。",
    )),
    Line(B, "{um}，我先點一杯，等一下跟大家分享味道。"),
    Line(B, "好，拿到了，我喝一口。"),
    Pause(2.0, 3.0),
    Line(B, "{嗯}，很順，而且不會太酸，我很喜歡。"),
    Line(B, "冰塊很少，所以味道不會被稀釋。"),
    Line(B, "{uh}，價格是一百二十塊，以台南來說不算便宜。"),
    Line(B, "如果你來台南，真的可以來試試看。"),
    Line(B, "等一下我要去吃牛肉湯，晚一點再拍給大家看。"),
    Line(B, "好，那今天的 vlog 就先到這裡，see you。"),
), portrait=True, speakers=(B,))  # fmt: skip

SCREEN_D = Clip("screen-d", "screen-d", "screen", 60, (
    Section(1, "設定 API key"),
    Show("settings"),
    Line(A, "這支影片示範怎麼設定 API key。"),
    Line(A, "{嗯}，首先打開設定頁面，找到 API 的欄位。"),
    Line(A, "模型的部分，用預設的就可以了，不用特別改。"),
    Line(A, "輸出的資料夾可以自己選，{嗯}，我這邊放在 videos 底下。"),
    Line(A, "把你的 key 貼上去，然後按儲存。"),
    Line(A, "{那個}，記得 key 不要放到 GitHub 上面。"),
    Show("terminal"),
    Line(A, "接著回到 terminal，輸入 edit 的指令。"),
    Retake(A, (
        "後面加上影片的資料夾，還有長度，比如說三十秒，{uh}，不對。",
        "後面加上影片的資料夾，還有長度，比如說六十秒。",
    )),
    Line(A, "按下 enter 之後，就會開始分析。"),
    Line(A, "畫面上會一直顯示目前跑到哪一步。"),
    Pause(),
    Line(A, "{um}，分析的時間大概是影片長度的一到兩倍。"),
    Show("editor", dissolve=True),
    Line(A, "跑完之後，資料夾裡面會多一個影片檔跟一個字幕檔。"),
    Line(A, "字幕檔是 SRT 格式，可以直接丟進 YouTube。"),
    Line(A, "打開字幕檔，可以看到每一句都有時間碼。"),
    Line(A, "{那個}，如果有錯字，直接在這裡改就好。"),
    Show("slide", text=("Done", "video + captions", "Questions? Leave a comment")),
    Line(A, "好，示範就到這邊，有問題可以在下面留言。"),
))  # fmt: skip

CLIPS = (TALK_A1, TALK_A2, TALK_A3, CHAT_B1, CHAT_B2, CHAT_B3, PHONE_C, SCREEN_D)
