/* Issue #196: Interactive Knowledge Map (#knowledge-map / #tab-map) & Obsidian 285 Motion Design Spotlight.
   Exposes window.OphKnowledgeMap for mounting, node selection, filtering, specialty-safe rendering, and Markdown export. */
(function (g) {
  'use strict';
  if (g.OphKnowledgeMap) return;

  const VALID_SPECIALTIES = new Set(['oph', 'ent', 'rad', 'nm', 'neuro']);
  const DEFAULT_NODE_ID = 'obsidian-motion-285';

  const CATEGORIES = Object.freeze([
    Object.freeze({ id: 'all', label: '全部節點' }),
    Object.freeze({ id: 'motion', label: '動態簡報外掛 (285)' }),
    Object.freeze({ id: 'study', label: '閱讀與題庫' }),
    Object.freeze({ id: 'interview', label: '面試與敘事' })
  ]);

  const OBSIDIAN_PLUGINS = Object.freeze([
    Object.freeze({
      nodeId: 'obsidian-slides-30',
      key: 'slides',
      count: 30,
      countLabel: '30 款',
      title: 'Slides 動態變形投影片（30 款）',
      shortTitle: 'Slides 變形簡報',
      badge: '30 款外掛',
      description: '像 Keynote Magic Move 平滑變形過場（適合甄選自我介紹、研究前後對照）',
      url: 'https://obsidian.md/plugins?search=slides',
      cta: '瀏覽 Slides 外掛目錄（30 款）↗'
    }),
    Object.freeze({
      nodeId: 'obsidian-canvas-222',
      key: 'canvas',
      count: 222,
      countLabel: '222 款',
      title: 'Canvas 無邊際畫布・鏡頭巡航・流程圖（222 款）',
      shortTitle: 'Canvas 畫布巡航',
      badge: '222 款外掛',
      description: '鏡頭飛越畫布、決策流程圖與分鏡故事板（適合 PBL 鑑別診斷樹、臨床流程與論文架構導覽）',
      url: 'https://obsidian.md/plugins?search=canvas',
      cta: '瀏覽 Canvas 外掛目錄（222 款）↗'
    }),
    Object.freeze({
      nodeId: 'obsidian-excalidraw-33',
      key: 'excalidraw',
      count: 33,
      countLabel: '33 款 · 900 萬+ 下載',
      downloads: '900 萬+（9M+）下載',
      title: 'Excalidraw 手繪草圖轉動畫場景（33 款 · 900 萬+ 下載）',
      shortTitle: 'Excalidraw 手繪動畫',
      badge: '33 款 · 9M+ 下載',
      description: '手繪草圖轉為逐步動畫場景（適合解剖／機轉拆解、Case Presentation 視覺化）',
      url: 'https://obsidian.md/plugins?search=excalidraw',
      cta: '瀏覽 Excalidraw 外掛目錄（33 款）↗'
    })
  ]);

  const SPECIALTY_COPY = Object.freeze({
    oph: {
      label: '眼科',
      hubTitle: '眼科甄選知識與動態簡報中樞',
      hubShort: '眼科知識中樞',
      hubSub: '11 節點全站串聯',
      hubSummary: '把眼科共筆講義、AAO BCSC S01–S13 原文書、視覺圖譜、間隔重複 SRS、口試演練與 Obsidian 285 款免費動態簡報外掛整合成一張可互動導覽圖。',
      hubHighlights: [
        '左側聚焦 Obsidian 285 款免費動態設計外掛（Slides 30・Canvas 222・Excalidraw 33），$0 打造高記憶點甄選簡報',
        '右上串聯 14 章眼科共筆、BCSC S01–S13 原文書、視覺圖譜、SRS 題庫與手寫問答題',
        '下方串聯計時口試、PBL 三幕臨床情境、急症流程、故事證據工作坊與甄試訓練日誌'
      ],
      readingTitle: '核心教材與記憶錨點（眼科共筆・BCSC S01–S13・視覺圖譜）',
      readingShort: '核心教材與圖譜',
      readingSub: '共筆・BCSC・圖譜',
      readingSummary: '串聯 14 章眼科共筆與考古整合講義、AAO BCSC S01–S13 原文書精讀與原創視覺圖譜，建立高鑑別度的解剖與病生理記憶錨點。',
      readingHighlights: [
        '14 章整合共筆：速讀記憶骨架、常混淆鑑別表與主動遮答回想',
        'AAO BCSC S01–S13 各卷重點推演、臨床更新對照與原創視覺圖譜',
        '考前衝刺高頻數字卡與跨章節臨床病例串連'
      ],
      readingHasTextbook: true,
      srsTitle: '間隔重複 SRS 與多層題庫演練',
      srsShort: 'SRS 與題庫演練',
      srsSub: '今日到期・多層題庫',
      srsSummary: '整合眼科共筆與考古題、BCSC S01–S13（540 題）、Hard 多步臨床推理（144 題）與自編陌生病例（120 題），依台北時間自動排程到期弱項。',
      srsHighlights: [
        '今日到期複習自動彙整跨題庫錯題、微卡題、視覺圖譜卡與手寫問答',
        '四選項逐一解析「為什麼不選」與條件反轉（When True）',
        '支援單題深練與 12 題／18 分鐘 Hard 限時盲測模考'
      ],
      writtenTitle: '筆試簡答與申論架構（含手寫板）',
      writtenShort: '筆試簡答與申論',
      writtenSub: '手寫板・得分要點',
      writtenSummary: '涵蓋全章節必考簡答、BCSC S01–S13 機轉推導與 Hard 臨床申論；支援 Apple Pencil／觸控手寫板與文字作答，逐點核對得分 Checklist。',
      writtenHighlights: [
        '先默寫答題骨架再展開標準答案，訓練筆試考場限時條列輸出',
        '每題附必寫得分要點自評，完成後直接排入 SRS 間隔複習',
        '可將申論鑑別架構轉繪為 Obsidian Canvas／Excalidraw 動態複習圖'
      ],
      interviewTitle: '面試演練・PBL 三幕情境・臨床流程',
      interviewShort: '面試・PBL・流程',
      interviewSub: '計時口試・急症排序',
      interviewSummary: '結合通用動機與眼科臨床口試計時、PBL 逐幕揭露病例討論及急症處置排序練習，強化「接下來你會怎麼做？」的結構化表達。',
      interviewHighlights: [
        '計時口試附 30 秒骨架、完整口述示範、追問應對與個人化改寫提示',
        'PBL 三幕情境演練整理「關鍵事實・合理假說・待查資訊」與醫療倫理溝通',
        '臨床急症與當日轉介流程支援閱讀、遮答回想、打亂重排與 SBAR 交班'
      ],
      workshopTitle: '故事與證據工作坊',
      workshopShort: '故事與證據工作坊',
      workshopSub: '個人經歷・研究證據',
      workshopSummary: '整理個人臨床觀察、顯微操作體會與研究證據，將抽象熱忱轉化為具體細節、數據與可驗證成果的面試故事庫。',
      workshopHighlights: [
        '以背景、行動、結果與訓練反思整理代表性臨床故事',
        '盤點論文、海報、個案報告與見習觀察證據，對應考官追問',
        '直接輸出結構化素材至 Obsidian Slides 製作 3 分鐘研究亮點變形簡報'
      ],
      logTitle: '甄試訓練日誌與考試時程',
      logShort: '訓練日誌與時程',
      logSub: '打卡連續・各院倒數',
      logSummary: '追蹤每日複習打卡、口試計時紀錄與各院甄試報名截止／筆面試倒數，把值班與一般日時間接成穩定備考節奏。',
      logHighlights: [
        '整合每日學習任務、限時小關紀錄與口試演練統計',
        '一覽各院報名截止、報到與筆試／面試日期倒數',
        '支援一般日與值班日彈性分鐘數規劃及跨裝置進度同步'
      ],
      logHasProject: true,
      recipeExamples: [
        '眼科實戰範例：把「臨床問題意識 → 研究方法與收案 → OCT／臨床指標前後對照圖表」做成 3 頁平滑變形投影片。',
        '眼科實戰範例：在 Canvas 鋪開「急性紅眼或突發視力變化 → 紅旗徵象分流 → 必做檢查與緊急處置升級」鏡頭巡航圖。',
        '眼科實戰範例：用 Excalidraw 分層手繪「解剖構造、病生理機轉或手術關鍵步驟」，報告時依序逐步揭露。'
      ]
    },
    ent: {
      label: '耳鼻喉科',
      hubTitle: '耳鼻喉科甄選知識與動態簡報中樞',
      hubShort: '耳鼻喉知識中樞',
      hubSub: '11 節點全站串聯',
      hubSummary: '把耳鼻喉科核心章節教材、主動回想、間隔重複 SRS、筆試手寫申論、PBL 臨床流程與 Obsidian 285 款免費動態簡報外掛整合成一張互動導覽圖。',
      hubHighlights: [
        '左側聚焦 Obsidian 285 款免費動態設計外掛（Slides 30・Canvas 222・Excalidraw 33），$0 打造甄選自我介紹與個案簡報',
        '右上串聯耳科、鼻竇內視鏡、頭頸外科章節重點、SRS 到期複習與筆試手寫問答',
        '下方串聯計時口試、PBL 三幕情境、上呼吸道急症處置流程與個人故事證據工作坊'
      ],
      readingTitle: '核心教材與記憶錨點（耳鼻喉頭頸章節・主動回想）',
      readingShort: '核心教材與錨點',
      readingSub: '章節講義・衝刺卡',
      readingSummary: '串聯耳科聽力平衡、鼻科內視鏡解剖、咽喉音聲與頭頸腫瘤分期整合教材，搭配速讀骨架、常混淆比較表與考前衝刺卡建立記憶錨點。',
      readingHighlights: [
        '整合章節講義支援全展開閱讀、速讀記憶骨架與主動遮答回想',
        '常混淆鑑別表整理聽力圖判讀、眩暈鑑別與頭頸分期關鍵陷阱',
        '考前衝刺卡濃縮高頻數值與解剖標記，適合值班空檔快速複習'
      ],
      readingHasTextbook: false,
      srsTitle: '間隔重複 SRS 與筆試題庫演練',
      srsShort: 'SRS 與題庫演練',
      srsSub: '今日到期・單選題庫',
      srsSummary: '結合耳鼻喉科核心單選題庫、錯題重練與台北時間 SRS 間隔重複排程，優先清理今日到期題與不確定弱項。',
      srsHighlights: [
        '今日頁面即時統計現在到期、今日稍後與弱項題數',
        '作答後依熟悉度評分自動計算下次複習間隔',
        '支援依章節主題、錯題與不確定題精準篩選演練'
      ],
      writtenTitle: '筆試簡答與申論架構（含手寫板）',
      writtenShort: '筆試簡答與申論',
      writtenSub: '手寫板・得分要點',
      writtenSummary: '針對耳鼻喉頭頸必考簡答與臨床處置申論，支援 Apple Pencil／觸控手寫板與文字作答，逐點核對標準答案與得分要點。',
      writtenHighlights: [
        '先默寫解剖與處置條列骨架，再展開標準答案比對遺漏點',
        '每題附得分 Checklist 自評並納入 SRS 到期追蹤',
        '可搭配 Obsidian Canvas／Excalidraw 將手術解剖與分期流程視覺化'
      ],
      interviewTitle: '面試演練・PBL 三幕情境・臨床流程',
      interviewShort: '面試・PBL・流程',
      interviewSub: '計時口試・急症排序',
      interviewSummary: '整合耳鼻喉科甄選動機口試、PBL 三幕臨床討論與上呼吸道／頭頸急症處置流程排序，訓練高壓口試下的清晰結構。',
      interviewHighlights: [
        '計時口試提供 30 秒摘要骨架、完整口述範例與追問應對方向',
        'PBL 逐幕整理臨床事實、鑑別假說、待查檢查與醫病溝通重點',
        '急症處置流程支援閱讀、遮住細節回想與打亂步驟重排練習'
      ],
      workshopTitle: '故事與證據工作坊',
      workshopShort: '故事與證據工作坊',
      workshopSub: '個人經歷・研究證據',
      workshopSummary: '盤點耳鼻喉科見習實作、門診內視鏡與手術室觀察及研究經歷，轉化為有具體細節與反思深度的甄選敘事素材。',
      workshopHighlights: [
        '結構化整理臨床代表個案與團隊合作經驗，強化真實說服力',
        '對齊個人研究成果與耳鼻喉科專科訓練連結',
        '直接結合 Obsidian Slides 打造流暢的 3 分鐘自我介紹動態簡報'
      ],
      logTitle: '甄選讀書計畫與學習進度',
      logShort: '讀書計畫與進度',
      logSub: '每日目標・章節掌握',
      logSummary: '規劃一般日與值班日彈性練習時數，追蹤各章節閱讀、單選題、手寫問答與口試演練完成度，並支援雲端同步備份。',
      logHighlights: [
        '依一般日與值班日設定可持續的每日練習分鐘數目標',
        '章節進度表一覽各主題答題正確率與複習狀態',
        '支援匯出 JSON 備份或連結私人 GitHub 儲存庫跨裝置同步'
      ],
      logHasProject: false,
      recipeExamples: [
        '耳鼻喉科實戰範例：把「臨床問題 → 研究設計 → 聽力學或內視鏡預後圖表」做成 3 頁 Slides 平滑變形過場。',
        '耳鼻喉科實戰範例：在 Canvas 鋪開「急性喘鳴／深頸部感染 → 呼吸道安全評估 → 影像與處置升級」決策巡航圖。',
        '耳鼻喉科實戰範例：用 Excalidraw 手繪「顳骨中耳構造、鼻竇引流通道或頸部淋巴區解剖」，逐層動畫講解。'
      ]
    },
    rad: {
      label: '放射診斷科',
      hubTitle: '放射診斷科甄選知識與動態簡報中樞',
      hubShort: '放診知識中樞',
      hubSub: '11 節點全站串聯',
      hubSummary: '把放射診斷科系統章節教材、影像判讀重點、間隔重複 SRS、筆試手寫申論、PBL 臨床流程與 Obsidian 285 款免費動態簡報外掛整合成一張互動導覽圖。',
      hubHighlights: [
        '左側聚焦 Obsidian 285 款免費動態設計外掛（Slides 30・Canvas 222・Excalidraw 33），$0 打造影像個案與研究動態簡報',
        '右上串聯各系統影像徵象講義、檢查協定選擇、SRS 到期複習與手寫問答題',
        '下方串聯計時口試、PBL 三幕情境、顯影劑安全與危急值通報流程及故事工作坊'
      ],
      readingTitle: '核心教材與記憶錨點（影像徵象章節・主動回想）',
      readingShort: '核心教材與錨點',
      readingSub: '章節講義・衝刺卡',
      readingSummary: '串聯胸腹、神經、骨骼肌肉與急診影像判讀章節教材，搭配常混淆影像徵象比較表與考前衝刺重點建立結構化判讀錨點。',
      readingHighlights: [
        '支援全展開閱讀、速讀記憶骨架與遮答主動回想三種複習模式',
        '常混淆比較表釐清 CT／MRI 序列選擇與典型影像鑑別陷阱',
        '考前衝刺卡整理輻射劑量、顯影劑腎病變與反應分級高頻考點'
      ],
      readingHasTextbook: false,
      srsTitle: '間隔重複 SRS 與筆試題庫演練',
      srsShort: 'SRS 與題庫演練',
      srsSub: '今日到期・單選題庫',
      srsSummary: '整合放射診斷科核心單選題、錯題重練與台北時間 SRS 排程，針對易混淆影像鑑別與物理安全考點持續強化記憶。',
      srsHighlights: [
        '今日面板即時呈現現在到期、今日稍後與弱項題數',
        '答題後自評熟悉度，自動安排最佳複習間距',
        '支援分章節、錯題與不確定題快速抽題演練'
      ],
      writtenTitle: '筆試簡答與申論架構（含手寫板）',
      writtenShort: '筆試簡答與申論',
      writtenSub: '手寫板・得分要點',
      writtenSummary: '針對影像鑑別診斷清單、檢查協定理由與結構化報告申論，支援 Apple Pencil／觸控手寫板與文字作答並附標準得分要點。',
      writtenHighlights: [
        '訓練系統性列舉「主要發現 → 鑑別診斷 → 建議下一步檢查」',
        '逐點勾選得分 Checklist 並自動連動 SRS 複習排程',
        '適合搭配 Obsidian Canvas 整理多模態影像鑑別決策樹'
      ],
      interviewTitle: '面試演練・PBL 三幕情境・臨床流程',
      interviewShort: '面試・PBL・流程',
      interviewSub: '計時口試・危急值流程',
      interviewSummary: '結合專科動機口試、PBL 逐幕臨床影像整合討論與顯影劑過敏／危急值通報流程排序，展現嚴謹的臨床溝通與安全意識。',
      interviewHighlights: [
        '計時口試提供結構化答題大綱、完整參考講稿與考官追問解析',
        'PBL 情境練習結合臨床病史、實驗室數據與影像檢查選擇推理',
        '臨床安全流程支援遮答回想、步驟重排與跨科 SBAR 溝通演練'
      ],
      workshopTitle: '故事與證據工作坊',
      workshopShort: '故事與證據工作坊',
      workshopSub: '個人經歷・研究證據',
      workshopSummary: '整理影像科見習閱片體會、跨科討論會觀察與影像／AI 研究經歷，打造有具體證據支撐的面試敘事素材。',
      workshopHighlights: [
        '將閱片推理與臨床回饋經驗整理為高辨識度個人故事',
        '連結研究數據、學會發表與未來放射診斷訓練目標',
        '搭配 Obsidian Slides 製作序列對照與研究亮點動態變形簡報'
      ],
      logTitle: '甄選讀書計畫與學習進度',
      logShort: '讀書計畫與進度',
      logSub: '每日目標・章節掌握',
      logSummary: '彈性安排一般日與值班日練習時間，追蹤各系統章節閱讀、題庫作答與口試練習進度，支援多裝置雲端同步。',
      logHighlights: [
        '提供一般日與值班日最低維持量建議，避免備考中斷',
        '清楚檢視各章節完成率與待補強錯題分佈',
        '一鍵匯出進度 JSON 或設定私人 GitHub 同步'
      ],
      logHasProject: false,
      recipeExamples: [
        '放診科實戰範例：把「臨床假說 → 影像序列設計 → 定量指標與代表性切面結論」做成 Slides 平滑變形對照。',
        '放診科實戰範例：在 Canvas 鋪開「急診主訴 → 首選影像協定與禁忌症 → 危急徵象分流與通報」鏡頭導覽。',
        '放診科實戰範例：用 Excalidraw 手繪「解剖間隙連通關係或血流動力學時相變化」，逐步動畫拆解機轉。'
      ]
    },
    nm: {
      label: '核子醫學科',
      hubTitle: '核子醫學科甄選知識與動態簡報中樞',
      hubShort: '核醫知識中樞',
      hubSub: '11 節點全站串聯',
      hubSummary: '把核子醫學科分子影像教材、示蹤劑機轉、間隔重複 SRS、筆試手寫申論、PBL 輻射安全流程與 Obsidian 285 款免費動態簡報外掛整合成一張互動導覽圖。',
      hubHighlights: [
        '左側聚焦 Obsidian 285 款免費動態設計外掛（Slides 30・Canvas 222・Excalidraw 33），$0 打造精準醫療與研究動態簡報',
        '右上串聯 PET／SPECT 示蹤劑生理機轉、核醫治療章節、SRS 到期複習與手寫問答題',
        '下方串聯計時口試、PBL 三幕情境、給藥與輻射安全流程及故事證據工作坊'
      ],
      readingTitle: '核心教材與記憶錨點（分子影像・核醫治療・主動回想）',
      readingShort: '核心教材與錨點',
      readingSub: '章節講義・衝刺卡',
      readingSummary: '串聯甲狀腺、心肌灌注、骨骼、腎臟動態掃描、腫瘤 PET 與核醫標靶治療章節講義，搭配比較表與衝刺卡鞏固示蹤劑機轉錨點。',
      readingHighlights: [
        '支援全展開精讀、速讀記憶骨架與遮住答案主動回想',
        '常混淆比較表整理不同放射性藥物攝取機轉、半衰期與偽陽性／偽陰性成因',
        '考前衝刺卡彙整病患準備規範、停藥時程與輻射防護核心數值'
      ],
      readingHasTextbook: false,
      srsTitle: '間隔重複 SRS 與筆試題庫演練',
      srsShort: 'SRS 與題庫演練',
      srsSub: '今日到期・單選題庫',
      srsSummary: '結合核子醫學科單選題庫、錯題重練與台北時間 SRS 間隔排程，穩固物理計量、品質管制與臨床判讀考點。',
      srsHighlights: [
        '今日頁面即時追蹤現在到期、今日稍後與弱項題目數量',
        '依答題正誤與主觀熟悉度自動調整複習週期',
        '可針對特定系統章節或待補強錯題集中演練'
      ],
      writtenTitle: '筆試簡答與申論架構（含手寫板）',
      writtenShort: '筆試簡答與申論',
      writtenSub: '手寫板・得分要點',
      writtenSummary: '涵蓋核醫檢查原理推導、Theranostics 治療適應症與輻射安全申論，支援手寫板與文字作答並附標準得分要點核對。',
      writtenHighlights: [
        '訓練條列「示蹤劑機轉 → 影像判讀準則 → 臨床處置建議」標準答法',
        '完成後逐點自評得分要點並排入 SRS 追蹤',
        '可搭配 Obsidian Excalidraw／Canvas 繪製代謝路徑與治療流程圖'
      ],
      interviewTitle: '面試演練・PBL 三幕情境・臨床流程',
      interviewShort: '面試・PBL・流程',
      interviewSub: '計時口試・輻防流程',
      interviewSummary: '整合核醫專科動機口試、PBL 三幕臨床病例與放射性藥物給藥安全／輻射溝通流程排序，強化邏輯與同理溝通。',
      interviewHighlights: [
        '計時口試配備 30 秒摘要、完整參考說法與考官追問應對',
        'PBL 逐幕演練整合生化指標、結構影像與功能性核醫檢查判讀',
        '臨床作業與輻射防護流程支援遮答回想與步驟順序檢核'
      ],
      workshopTitle: '故事與證據工作坊',
      workshopShort: '故事與證據工作坊',
      workshopSub: '個人經歷・研究證據',
      workshopSummary: '盤點核醫見習、分子影像跨科討論與定量研究經歷，轉化為具說服力與具體證據的面試個人故事。',
      workshopHighlights: [
        '聚焦功能性影像如何改變臨床決策的真實觀察與反思',
        '整理研究方法、定量分析與核醫專科發展願景的連結',
        '結合 Obsidian Slides 製作清晰的 3 分鐘研究前後對照動態簡報'
      ],
      logTitle: '甄選讀書計畫與學習進度',
      logShort: '讀書計畫與進度',
      logSub: '每日目標・章節掌握',
      logSummary: '規劃一般日與值班日備考節奏，完整記錄章節複習、題庫作答與口試練習進度，支援備份匯出與雲端同步。',
      logHighlights: [
        '彈性設定每日練習分鐘數，穩定累積長線記憶',
        '章節進度總覽清楚掌握各主題熟練度',
        '支援本機匯出與私人 GitHub 跨裝置自動同步'
      ],
      logHasProject: false,
      recipeExamples: [
        '核醫科實戰範例：把「臨床分期難題 → 示蹤劑選擇與 SUV 定量方法 → 治療反應評估結論」做成 Slides 變形簡報。',
        '核醫科實戰範例：在 Canvas 鋪開「生化復發或內分泌異常 → 功能性掃描選擇 → 標靶核種治療評估」決策巡航圖。',
        '核醫科實戰範例：用 Excalidraw 手繪「受體結合與細胞內滯留機轉或動態腎圖曲線變化」，逐步動畫呈現。'
      ]
    },
    neuro: {
      label: '神經內科',
      hubTitle: '神經內科甄選知識與動態簡報中樞',
      hubShort: '神內知識中樞',
      hubSub: '11 節點全站串聯',
      hubSummary: '把神經內科解剖定位教材、急性處置時效、間隔重複 SRS、筆試手寫申論、PBL 臨床流程與 Obsidian 285 款免費動態簡報外掛整合成一張互動導覽圖。',
      hubHighlights: [
        '左側聚焦 Obsidian 285 款免費動態設計外掛（Slides 30・Canvas 222・Excalidraw 33），$0 打造病灶定位與研究動態簡報',
        '右上串聯神經解剖定位、腦血管與神經免疫章節、SRS 到期複習與手寫問答題',
        '下方串聯計時口試、PBL 三幕情境、急性中風／癲癇重積處置流程與故事工作坊'
      ],
      readingTitle: '核心教材與記憶錨點（神經定位・急重症章節・主動回想）',
      readingShort: '核心教材與錨點',
      readingSub: '章節講義・衝刺卡',
      readingSummary: '串聯大腦皮質、腦幹、脊髓與周邊神經肌肉定位、腦中風、癲癇、動作障礙與失智症整合教材，建立嚴密的定位與病因推論錨點。',
      readingHighlights: [
        '支援全展開閱讀、速讀記憶骨架與遮答主動回想',
        '常混淆比較表釐清中樞與周邊病灶、血管流域症候群與電生理特徵',
        '考前衝刺卡濃縮血栓溶解／取栓時間窗、藥物劑量與禁忌症紅旗'
      ],
      readingHasTextbook: false,
      srsTitle: '間隔重複 SRS 與筆試題庫演練',
      srsShort: 'SRS 與題庫演練',
      srsSub: '今日到期・單選題庫',
      srsSummary: '結合神經內科核心單選題、錯題重練與台北時間 SRS 間隔排程，持續鞏固病灶定位與最新治療指引考點。',
      srsHighlights: [
        '今日頁面即時呈現現在到期、今日稍後與弱項題數',
        '作答後依熟悉度回饋自動排定下次複習時間',
        '支援依章節、錯題與不確定題快速聚焦演練'
      ],
      writtenTitle: '筆試簡答與申論架構（含手寫板）',
      writtenShort: '筆試簡答與申論',
      writtenSub: '手寫板・得分要點',
      writtenSummary: '針對「Anatomic Localization → Etiology → Workup & Management」經典申論架構，支援手寫板與文字作答並附標準得分要點。',
      writtenHighlights: [
        '先寫下定位推論與鑑別診斷樹，再展開標準答案逐點核對',
        '每題附必寫得分 Checklist 並自動連動 SRS 排程',
        '可搭配 Obsidian Excalidraw／Canvas 繪製神經傳導路徑與急症時間軸'
      ],
      interviewTitle: '面試演練・PBL 三幕情境・臨床流程',
      interviewShort: '面試・PBL・流程',
      interviewSub: '計時口試・急症排序',
      interviewSummary: '整合神經內科專科動機口試、PBL 三幕臨床推理與急性腦中風／癲癇重積狀態處置流程排序，訓練分秒必爭的臨床決策表達。',
      interviewHighlights: [
        '計時口試附 30 秒重點骨架、完整參考答法與追問解析',
        'PBL 逐幕整理神經學理學檢查線索、定位假說、影像電生理檢查與家庭照護倫理',
        '急症臨床流程支援遮答回想、打亂步驟重排與團隊 SBAR 交班'
      ],
      workshopTitle: '故事與證據工作坊',
      workshopShort: '故事與證據工作坊',
      workshopSub: '個人經歷・研究證據',
      workshopSummary: '整理床邊神經學檢查定位體會、急診照會觀察與神經科學研究經歷，打造兼具邏輯深度與人文關懷的面試故事庫。',
      workshopHighlights: [
        '具體呈現從病史與理學檢查抽絲剝繭定位病灶的臨床推理故事',
        '連結個人研究成果、個案報告與神經內科專科訓練目標',
        '搭配 Obsidian Slides 將研究圖表與病程時間軸做成流暢變形簡報'
      ],
      logTitle: '甄選讀書計畫與學習進度',
      logShort: '讀書計畫與進度',
      logSub: '每日目標・章節掌握',
      logSummary: '彈性配置一般日與值班日備考時數，追蹤各章節閱讀、單選題、手寫問答與口試完成度，並支援雲端同步。',
      logHighlights: [
        '提供一般日與值班日彈性練習指標，維持穩定複習連續性',
        '各章節答題與閱讀進度一目了然，快速鎖定待加強主題',
        '支援匯出 JSON 進度檔與私人 GitHub 跨裝置同步'
      ],
      logHasProject: false,
      recipeExamples: [
        '神內科實戰範例：把「臨床定位問題 → 收案與神經影像／電生理指標 → 預後分析結論」做成 Slides 平滑變形投影片。',
        '神內科實戰範例：在 Canvas 鋪開「急性神經學缺損 → 時間窗與禁忌症檢核 → 再灌流治療與加護監測」鏡頭導覽。',
        '神內科實戰範例：用 Excalidraw 手繪「腦幹橫切面神經核團與長徑路病灶定位」，報告時逐層動畫亮起。'
      ]
    }
  });

  const FOUR_STEPS = Object.freeze([
    {
      step: 1,
      title: '開啟 Obsidian → Settings → Community plugins',
      detail: '首次啟用社群外掛時，先點擊 Turn on community plugins（關閉 Restricted mode 安全限制）。'
    },
    {
      step: 2,
      title: '點擊 Browse 並搜尋外掛名稱（或直接開啟上方三大分類目錄）',
      detail: '輸入 slides、canvas 或 excalidraw，即可從合計 285 款免費動態設計與簡報外掛中挑選所需工具。'
    },
    {
      step: 3,
      title: '點擊 Install 安裝並 Enable 啟用',
      detail: '全程 $0 免費安裝（無訂閱費、離線本機儲存），對標商業動態簡報軟體或模板行情 $1,500–$4,800。'
    },
    {
      step: 4,
      title: '開啟新筆記建立第一個動態場景（實戰起手式）',
      detail: '實戰起手式：先選一個你面試最常解釋的核心概念——如研究架構圖、臨床決策樹或代表性個案——今天先做出第 1 個動態場景。'
    }
  ]);

  const INTERVIEW_RECIPES = Object.freeze([
    {
      id: 'recipe-slides',
      pluginKey: 'slides',
      badge: 'Slides 30 款',
      title: '自我介紹 3 分鐘研究亮點 Slides 變形',
      body: '利用 Markdown 分頁與同名元素自動補間，做出媲美 Keynote Magic Move 的平滑過場，將「臨床痛點 → 研究設計 → 核心結果圖表」濃縮在 3 分鐘內俐落呈現。'
    },
    {
      id: 'recipe-canvas',
      pluginKey: 'canvas',
      badge: 'Canvas 222 款',
      title: 'PBL／臨床決策樹 Canvas 鏡頭導覽',
      body: '在無邊際畫布展開「主訴與紅旗徵象 → 鑑別診斷分支 → 關鍵檢查與處置升級」，口試回答時沿節點推進鏡頭巡航，讓考官一眼看清你的決策全貌。'
    },
    {
      id: 'recipe-excalidraw',
      pluginKey: 'excalidraw',
      badge: 'Excalidraw 33 款 · 900 萬+ 下載',
      title: '手術／病生理機轉 Excalidraw 手繪動畫',
      body: '把手繪解剖構造、病生理因果鏈或代表性 Case Presentation 拆成向量圖層與分鏡，逐步揭露關鍵步驟，大幅提升複雜機轉的視覺記憶度。'
    }
  ]);

  const EDGES = Object.freeze([
    ['hub', 'obsidian-motion-285', 'motion'],
    ['obsidian-motion-285', 'obsidian-slides-30', 'motion'],
    ['obsidian-motion-285', 'obsidian-canvas-222', 'motion'],
    ['obsidian-motion-285', 'obsidian-excalidraw-33', 'motion'],
    ['hub', 'reading-core', 'study'],
    ['hub', 'srs-banks', 'study'],
    ['hub', 'written-qa', 'study'],
    ['reading-core', 'srs-banks', 'study'],
    ['srs-banks', 'written-qa', 'study'],
    ['hub', 'interview-flow', 'interview'],
    ['hub', 'story-workshop', 'interview'],
    ['hub', 'training-log', 'interview'],
    ['obsidian-motion-285', 'story-workshop', 'motion'],
    ['story-workshop', 'interview-flow', 'interview']
  ]);

  function esc(val) {
    return String(val ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  function resolveSpecialty(state) {
    const candidates = [
      state && state.specialty,
      g.OphSpecialty && g.OphSpecialty.id,
      g.window && g.window.OphSpecialty && g.window.OphSpecialty.id,
      g.OPH_SPECIALTY,
      g.window && g.window.OPH_SPECIALTY,
      g.document && g.document.documentElement && g.document.documentElement.dataset && g.document.documentElement.dataset.specialty
    ];
    for (const c of candidates) {
      if (typeof c === 'string' && VALID_SPECIALTIES.has(c.trim())) return c.trim();
    }
    try {
      const search = (g.window && g.window.location && g.window.location.search) || (g.location && g.location.search) || '';
      const s = new URLSearchParams(search).get('s');
      if (s && VALID_SPECIALTIES.has(s)) return s;
    } catch (_) {}
    return 'oph';
  }

  function hasWrittenSupport(specId, state) {
    if (state && typeof state.hasWritten === 'boolean') return state.hasWritten;
    const w = g.window || g;
    if (w.OphQuizBank && typeof w.OphQuizBank.setWritten === 'function') return true;
    if (w.OphWritten) return true;
    return VALID_SPECIALTIES.has(specId);
  }

  function buildNodes(specId, state) {
    const sid = VALID_SPECIALTIES.has(specId) ? specId : 'oph';
    const copy = SPECIALTY_COPY[sid] || SPECIALTY_COPY.oph;
    const writtenEnabled = hasWrittenSupport(sid, state);

    const readingActions = [
      { label: '進入主動複習講義', hash: '#tab-learn', primary: true }
    ];
    if (copy.readingHasTextbook) {
      readingActions.push({ label: '開啟原文書進階（BCSC S01–S13）', hash: '#tab-textbook' });
    }
    readingActions.push(
      { label: '章節教材總覽', hash: '#tab-notebook' },
      { label: sid === 'oph' ? '共筆考前衝刺' : '考前衝刺重點', hash: '#tab-cram' }
    );

    const srsActions = [
      { label: '今日到期複習（#today）', hash: '#today', primary: true },
      { label: '筆試題庫演練（#tab-exam）', hash: '#tab-exam' },
      { label: 'SRS 今日複習清單', hash: '#tab-study' }
    ];

    const writtenActions = writtenEnabled
      ? [
          { label: '開啟手寫問答題庫（#written）', hash: '#written', primary: true },
          { label: '筆試題庫練習（#tab-exam）', hash: '#tab-exam' }
        ]
      : [
          { label: '開啟筆試題庫練習（#tab-exam）', hash: '#tab-exam', primary: true }
        ];

    const logActions = copy.logHasProject
      ? [
          { label: '開啟甄試訓練日誌', hash: '#tab-project', primary: true },
          { label: '查看考試時程', hash: '#tab-schedule' },
          { label: '每日計畫', hash: '#tab-plan' }
        ]
      : [
          { label: '開啟每日計畫', hash: '#tab-plan', primary: true },
          { label: '檢視學習進度', hash: '#tab-progress' },
          { label: '保存與雲端同步', hash: '#tab-sync' }
        ];

    return [
      {
        id: 'hub',
        category: 'hub',
        x: 506,
        y: 210,
        w: 176,
        h: 54,
        title: copy.hubTitle,
        shortLabel: copy.hubShort,
        subLabel: copy.hubSub,
        badge: copy.label + '甄選全站導覽',
        summary: copy.hubSummary,
        highlights: copy.hubHighlights,
        tags: ['中樞', '知識地圖', '導覽', copy.label],
        actions: [
          { label: '聚焦 Obsidian 285 外掛亮點', selectNode: 'obsidian-motion-285', primary: true },
          { label: '回到今日總覽', hash: '#today' },
          { label: '進入面試演練', hash: '#tab-interview' }
        ]
      },
      {
        id: 'obsidian-motion-285',
        category: 'motion',
        spotlight: true,
        x: 308,
        y: 196,
        w: 184,
        h: 56,
        title: 'Obsidian 285 款免費動態設計與簡報外掛地圖（Slides · Canvas · Excalidraw）',
        shortLabel: 'Obsidian 285 動態外掛',
        subLabel: '$0 免費 · 對標 $1,500–$4,800',
        badge: '$0 免費 · 共 285 款外掛',
        summary: '$0 免費取得全部 285 款 Obsidian 社群動態設計與簡報外掛（Slides 30 款 + Canvas 222 款 + Excalidraw 33 款，對標商業動態簡報行情 $1,500–$4,800），把筆記直接變成高記憶點甄選面試簡報與臨床決策動畫。',
        highlights: [
          'Slides（30 款）：像 Keynote Magic Move 平滑變形過場，適合 3 分鐘自我介紹與研究前後對照',
          'Canvas（222 款）：無邊際畫布鏡頭巡航、決策流程圖與分鏡故事板，適合 PBL 鑑別診斷樹與論文架構導覽',
          'Excalidraw（33 款 · 900 萬+ 下載）：手繪草圖轉為逐步動畫場景，適合解剖／病生理機轉拆解與 Case Presentation 視覺化'
        ],
        tags: ['obsidian', 'motion', 'slides', 'canvas', 'excalidraw', '285', '30', '222', '33', '900萬', '9M', '$0', '$1,500', '$4,800', '簡報', '動畫', '免費'],
        actions: [
          { label: '搭配故事與證據工作坊', hash: '#tab-workshop', primary: true },
          { label: '進入面試計時演練', hash: '#tab-interview' },
          { label: '開啟 PBL 情境討論', hash: '#pbl' }
        ]
      },
      {
        id: 'obsidian-slides-30',
        category: 'motion',
        pluginKey: 'slides',
        x: 102,
        y: 76,
        w: 176,
        h: 50,
        title: 'Slides 動態變形投影片（30 款）',
        shortLabel: 'Slides 變形簡報 (30)',
        subLabel: 'Keynote Magic Move 過場',
        badge: 'Slides · 30 款免費外掛',
        summary: '像 Keynote Magic Move 平滑變形過場（適合甄選自我介紹、研究前後對照），用純 Markdown 語法即可建立高質感學術與甄選簡報，免去反覆微調排版的時間。',
        highlights: [
          '支援跨頁同名區塊與圖表自動平滑補間動畫（Magic Move 效果）',
          '3 分鐘自我介紹可一氣呵成串聯「臨床動機 → 研究設計 → 核心成果數據」',
          '講稿備忘錄與投影片同源維護，考前修改一處即同步更新'
        ],
        externalUrl: 'https://obsidian.md/plugins?search=slides',
        externalLabel: '開啟 Obsidian Slides 外掛目錄（30 款）↗',
        tags: ['obsidian', 'slides', '30', 'keynote', 'magic move', '投影片', '簡報', '自我介紹', '研究前後對照'],
        actions: [
          { label: '前往故事與證據工作坊備料', hash: '#tab-workshop', primary: true },
          { label: '返回 285 外掛總覽', selectNode: 'obsidian-motion-285' }
        ]
      },
      {
        id: 'obsidian-canvas-222',
        category: 'motion',
        pluginKey: 'canvas',
        x: 102,
        y: 210,
        w: 178,
        h: 50,
        title: 'Canvas 無邊際畫布・鏡頭巡航・流程圖（222 款）',
        shortLabel: 'Canvas 畫布巡航 (222)',
        subLabel: '鏡頭飛越・決策流程圖',
        badge: 'Canvas · 222 款免費外掛',
        summary: '鏡頭飛越畫布、決策流程圖與分鏡故事板（適合 PBL 鑑別診斷樹、臨床流程與論文架構導覽），在單一無邊際空間同時呈現全局架構與局部證據細節。',
        highlights: [
          '222 款擴充外掛涵蓋鏡頭路徑巡航（Canvas Presentation）、自動佈局與樣式強化',
          '適合鋪開 PBL 三幕「主訴紅旗 → 鑑別分支 → 關鍵檢查與升級處置」決策樹',
          '口試追問時可隨時縮放至對應文獻卡片或流程節點，展現結構化思維'
        ],
        externalUrl: 'https://obsidian.md/plugins?search=canvas',
        externalLabel: '開啟 Obsidian Canvas 外掛目錄（222 款）↗',
        tags: ['obsidian', 'canvas', '222', '畫布', '流程圖', '鏡頭巡航', '故事板', 'PBL', '鑑別診斷樹', '論文架構'],
        actions: [
          { label: '演練 PBL 情境討論', hash: '#pbl', primary: true },
          { label: '演練臨床流程排序', hash: '#workflow' },
          { label: '返回 285 外掛總覽', selectNode: 'obsidian-motion-285' }
        ]
      },
      {
        id: 'obsidian-excalidraw-33',
        category: 'motion',
        pluginKey: 'excalidraw',
        x: 106,
        y: 348,
        w: 188,
        h: 52,
        title: 'Excalidraw 手繪草圖轉動畫場景（33 款 · 900 萬+ 下載）',
        shortLabel: 'Excalidraw 動畫 (33)',
        subLabel: '900 萬+ 下載 · 手繪轉動畫',
        badge: 'Excalidraw · 33 款 · 900 萬+ 下載',
        summary: '手繪草圖轉為逐步動畫場景（適合解剖／機轉拆解、Case Presentation 視覺化）；旗艦外掛累積突破 900 萬+（9M+）下載，支援手寫筆跡、向量圖層與幻燈片分鏡播放。',
        highlights: [
          '支援 iPad Apple Pencil／觸控板手繪解剖與病生理機轉，轉為逐格動畫揭露',
          '雙向連結筆記段落與圖像元素，點擊圖上標記即可跳回對應臨床重點',
          '極適合 Case Presentation 拆解手術步驟、解剖空間關係與因果機轉'
        ],
        externalUrl: 'https://obsidian.md/plugins?search=excalidraw',
        externalLabel: '開啟 Obsidian Excalidraw 外掛目錄（33 款）↗',
        tags: ['obsidian', 'excalidraw', '33', '900萬', '900 萬+', '9M', '手繪', '草圖', '動畫', '解剖', '機轉', 'case presentation'],
        actions: [
          { label: '前往主動複習講義搭配繪圖', hash: '#tab-learn', primary: true },
          { label: '前往手寫問答題庫', hash: writtenEnabled ? '#written' : '#tab-exam' },
          { label: '返回 285 外掛總覽', selectNode: 'obsidian-motion-285' }
        ]
      },
      {
        id: 'reading-core',
        category: 'study',
        x: 654,
        y: 70,
        w: 184,
        h: 50,
        title: copy.readingTitle,
        shortLabel: copy.readingShort,
        subLabel: copy.readingSub,
        badge: '閱讀與記憶錨點',
        summary: copy.readingSummary,
        highlights: copy.readingHighlights,
        tags: ['閱讀', '教材', '主動複習', '記憶錨點', '衝刺', copy.readingSub],
        actions: readingActions
      },
      {
        id: 'srs-banks',
        category: 'study',
        x: 854,
        y: 132,
        w: 180,
        h: 50,
        title: copy.srsTitle,
        shortLabel: copy.srsShort,
        subLabel: copy.srsSub,
        badge: 'SRS 間隔重複 · 題庫',
        summary: copy.srsSummary,
        highlights: copy.srsHighlights,
        tags: ['SRS', '間隔重複', '題庫', '筆試', '到期複習', '錯題'],
        actions: srsActions
      },
      {
        id: 'written-qa',
        category: 'study',
        x: 852,
        y: 248,
        w: 182,
        h: 50,
        title: copy.writtenTitle,
        shortLabel: copy.writtenShort,
        subLabel: copy.writtenSub,
        badge: '筆試簡答 · 申論架構',
        summary: copy.writtenSummary,
        highlights: copy.writtenHighlights,
        tags: ['手寫', '問答', '簡答', '申論', 'written', '手寫板', '得分要點'],
        actions: writtenActions
      },
      {
        id: 'interview-flow',
        category: 'interview',
        x: 754,
        y: 362,
        w: 188,
        h: 50,
        title: copy.interviewTitle,
        shortLabel: copy.interviewShort,
        subLabel: copy.interviewSub,
        badge: '口試 · PBL · 臨床流程',
        summary: copy.interviewSummary,
        highlights: copy.interviewHighlights,
        tags: ['面試', '口試', 'PBL', '臨床流程', 'SBAR', '計時'],
        actions: [
          { label: '進入面試計時演練（#tab-interview）', hash: '#tab-interview', primary: true },
          { label: 'PBL 情境討論（#pbl）', hash: '#pbl' },
          { label: '臨床流程排序（#workflow）', hash: '#workflow' }
        ]
      },
      {
        id: 'story-workshop',
        category: 'interview',
        x: 532,
        y: 376,
        w: 182,
        h: 50,
        title: copy.workshopTitle,
        shortLabel: copy.workshopShort,
        subLabel: copy.workshopSub,
        badge: '個人敘事 · 研究證據',
        summary: copy.workshopSummary,
        highlights: copy.workshopHighlights,
        tags: ['故事', '證據', '工作坊', 'workshop', '自傳', '動機', '敘事'],
        actions: [
          { label: '開啟故事與證據工作坊（#tab-workshop）', hash: '#tab-workshop', primary: true },
          { label: '搭配 Slides 30 款變形簡報', selectNode: 'obsidian-slides-30' },
          { label: '管理我的連結', hash: '#links' }
        ]
      },
      {
        id: 'training-log',
        category: 'interview',
        x: 324,
        y: 366,
        w: 178,
        h: 50,
        title: copy.logTitle,
        shortLabel: copy.logShort,
        subLabel: copy.logSub,
        badge: copy.logHasProject ? '訓練日誌 · 考試時程' : '每日計畫 · 學習進度',
        summary: copy.logSummary,
        highlights: copy.logHighlights,
        tags: ['訓練日誌', '計畫', '時程', '進度', 'project', 'schedule'],
        actions: logActions
      }
    ];
  }

  const STUDIO_MODES = Object.freeze([
    Object.freeze({
      id: 'flythrough',
      label: '🎥 知識星圖・鏡頭巡航',
      sub: 'Canvas 60fps 飛越導覽 · 222 款概念',
      shortLabel: '知識星圖・鏡頭巡航',
      nodeId: 'obsidian-canvas-222'
    }),
    Object.freeze({
      id: 'slides',
      label: '🎞️ Keynote 變形簡報劇場',
      sub: 'FLIP 同名元素平滑補間 · 30 款概念',
      shortLabel: 'Keynote 變形簡報劇場',
      nodeId: 'obsidian-slides-30'
    }),
    Object.freeze({
      id: 'sketch',
      label: '✏️ 手繪機轉動畫分鏡',
      sub: 'Excalidraw 筆跡逐步繪製 · 33 款概念',
      shortLabel: '手繪機轉動畫分鏡',
      nodeId: 'obsidian-excalidraw-33'
    })
  ]);
  const VALID_STUDIO_MODES = new Set(STUDIO_MODES.map(m => m.id));
  const STUDIO_BY_ID = new Map(STUDIO_MODES.map(m => [m.id, m]));
  const PLUGIN_TO_STUDIO = Object.freeze({ canvas: 'flythrough', slides: 'slides', excalidraw: 'sketch' });

  const CANONICAL_NODES = Object.freeze(buildNodes('oph').map(n => Object.freeze({ ...n })));
  const VALID_NODE_IDS = new Set(CANONICAL_NODES.map(n => n.id));

  let activeContainer = null;
  let activeState = {};
  let activeSpecialty = 'oph';
  let selectedNodeId = DEFAULT_NODE_ID;
  let activeStudioMode = 'flythrough';
  let userMotionOverride = null;
  let cameraBox = [0, 0, 960, 440];
  let cameraTargetBox = [0, 0, 960, 440];
  let tourActive = false;
  let tourStepIndex = 0;
  let tourCaptionText = '';
  let tourStepTag = '';
  let slideState = { deckId: '', slideIndex: 0, autoplay: false };
  let sketchState = { sceneId: '', step: 1, playing: false, speed: 1 };
  let cancelCameraRaf = null;
  let cancelFlipRaf = null;
  let pendingFlightDone = null;
  let tourTimerId = null;
  let slideAutoplayId = null;
  let sketchPlayId = null;
  const pendingTimeouts = new Set();

  let activeCategory = 'all';
  let searchQuery = '';
  let statusNote = '';
  let isComposing = false;
  const boundContainers = new WeakSet();

  function motion() {
    const m = g.OphKnowledgeMotion || (g.window && g.window.OphKnowledgeMotion);
    if (m) return m;
    if (typeof require === 'function') {
      try { return require('./knowledge-map-motion.js'); } catch (_) {}
    }
    return null;
  }

  function hostEnv() {
    return g.window || g;
  }

  function isReducedMotion() {
    if (userMotionOverride === 'reduced') return true;
    if (userMotionOverride === 'forced-on') return false;
    const env = hostEnv();
    try {
      if (env && typeof env.matchMedia === 'function') {
        return Boolean(env.matchMedia('(prefers-reduced-motion: reduce)').matches);
      }
    } catch (_) {}
    return false;
  }

  function syncMotionAttribute(container) {
    const target = container || activeContainer;
    if (!target || typeof target.setAttribute !== 'function') return;
    const modeVal = userMotionOverride === 'forced-on' ? 'forced-on' : (isReducedMotion() ? 'reduced' : 'auto');
    target.setAttribute('data-km-motion', modeVal);
    if (target.dataset) target.dataset.kmMotion = modeVal;
  }

  function isContainerMounted(el) {
    if (!el) return false;
    if (typeof el.hasAttribute === 'function') return el.hasAttribute('data-km-mounted');
    if (typeof el.getAttribute === 'function') return el.getAttribute('data-km-mounted') === '1';
    return Boolean(el.dataset && el.dataset.kmMounted === '1');
  }

  function isContainerDetached(el) {
    if (!el || el !== activeContainer) return true;
    if (el.isConnected === false) return true;
    const doc = g.document || (g.window && g.window.document);
    if (doc && typeof doc.getElementById === 'function' && el.id === 'knowledge-map-root') {
      const found = doc.getElementById('knowledge-map-root');
      if (found === null) return true;
    }
    return false;
  }

  function isContainerInteractive(container) {
    if (!container || isContainerDetached(container) || container.hidden || !isContainerMounted(container)) {
      return false;
    }
    if (container.style && container.style.display === 'none') return false;
    if (typeof container.closest === 'function') {
      const panel = container.closest('.tab-panel');
      if (panel) {
        if (panel.hidden || (panel.style && panel.style.display === 'none')) return false;
        if (panel.classList && typeof panel.classList.contains === 'function' && !panel.classList.contains('active')) {
          return false;
        }
      }
    }
    return true;
  }

  function registerManagedTimeout(fn, delayMs) {
    if (!activeContainer || isContainerDetached(activeContainer) || !isContainerMounted(activeContainer)) {
      return null;
    }
    const env = hostEnv();
    const setT = (env && typeof env.setTimeout === 'function' ? env.setTimeout : setTimeout).bind(env);
    const id = setT(() => {
      pendingTimeouts.delete(id);
      if (!isContainerDetached(activeContainer) && isContainerMounted(activeContainer)) fn();
    }, delayMs);
    if (id !== undefined && id !== null) pendingTimeouts.add(id);
    return id;
  }

  function clearAllTimers() {
    const env = hostEnv();
    const clrT = (env && typeof env.clearTimeout === 'function' ? env.clearTimeout : clearTimeout).bind(env);
    const clrI = (env && typeof env.clearInterval === 'function' ? env.clearInterval : clearInterval).bind(env);
    pendingFlightDone = null;
    if (typeof cancelCameraRaf === 'function') {
      cancelCameraRaf();
      cancelCameraRaf = null;
    }
    if (typeof cancelFlipRaf === 'function') {
      cancelFlipRaf();
      cancelFlipRaf = null;
    }
    if (tourTimerId !== null) {
      clrT(tourTimerId);
      tourTimerId = null;
    }
    if (slideAutoplayId !== null) {
      clrI(slideAutoplayId);
      slideAutoplayId = null;
    }
    if (sketchPlayId !== null) {
      clrI(sketchPlayId);
      sketchPlayId = null;
    }
    for (const id of pendingTimeouts) clrT(id);
    pendingTimeouts.clear();
    tourActive = false;
    slideState.autoplay = false;
    sketchState.playing = false;
  }

  function switchStudioModeInternal(nextMode) {
    const normalized = VALID_STUDIO_MODES.has(nextMode) ? nextMode : 'flythrough';
    if (activeStudioMode !== normalized) {
      clearAllTimers();
      activeStudioMode = normalized;
    }
    return activeStudioMode;
  }

  function getActiveTimerCount() {
    return (cancelCameraRaf ? 1 : 0) +
      (cancelFlipRaf ? 1 : 0) +
      (tourTimerId !== null ? 1 : 0) +
      (slideAutoplayId !== null ? 1 : 0) +
      (sketchPlayId !== null ? 1 : 0) +
      pendingTimeouts.size;
  }

  function isValidNodeId(nodeId) {
    return typeof nodeId === 'string' && VALID_NODE_IDS.has(nodeId);
  }

  function isValidRouteId(routeId) {
    return isValidNodeId(routeId) || (typeof routeId === 'string' && VALID_STUDIO_MODES.has(routeId));
  }

  function parseRouteFromHash(hashStr) {
    const raw = String(hashStr ?? '').trim();
    const m = raw.match(/^#knowledge-map-([a-z0-9-]+)$/);
    return m && isValidRouteId(m[1]) ? m[1] : null;
  }

  function ensureSpecialtyDefaults(specId) {
    const m = motion();
    if (!m) return;
    const decks = m.getDecks(specId);
    if (decks.length && !decks.some(d => d.id === slideState.deckId)) {
      slideState = { deckId: decks[0].id, slideIndex: 0, autoplay: false };
    }
    const scenes = m.getSketchScenes(specId);
    if (scenes.length && !scenes.some(s => s.id === sketchState.sceneId)) {
      sketchState = { sceneId: scenes[0].id, step: 1, playing: false, speed: sketchState.speed || 1 };
    }
  }

  function nodeMatchesFilter(node, category, query) {
    const exactCatOk = category === 'all' || node.category === category;
    if (!query) return exactCatOk;
    const tokens = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const hay = [
      node.id,
      node.title,
      node.shortLabel,
      node.subLabel,
      node.badge,
      node.summary,
      ...(node.highlights || []),
      ...(node.tags || []),
      node.externalUrl || ''
    ].join(' ').toLocaleLowerCase();
    return exactCatOk && tokens.every(t => hay.includes(t));
  }

  function curvePath(a, b) {
    const m = motion();
    if (m && typeof m.cubicSynapsePath === 'function') return m.cubicSynapsePath(a, b);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const c1x = Math.round(a.x + dx * 0.42);
    const c1y = Math.round(a.y + dy * 0.1);
    const c2x = Math.round(b.x - dx * 0.42);
    const c2y = Math.round(b.y - dy * 0.1);
    return `M ${a.x} ${a.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${b.x} ${b.y}`;
  }

  function renderObsidianSpotlight(selectedNode, specId) {
    const copy = SPECIALTY_COPY[specId] || SPECIALTY_COPY.oph;
    const focusedKey = selectedNode.pluginKey || '';
    const studioBtnLabels = {
      slides: '啟動內建變形簡報劇場',
      canvas: '啟動內建畫布鏡頭巡航',
      excalidraw: '啟動內建手繪動畫分鏡'
    };
    const pluginCards = OBSIDIAN_PLUGINS.map(p => {
      const isFocused = focusedKey === p.key;
      const targetStudio = PLUGIN_TO_STUDIO[p.key] || 'flythrough';
      return `<article class="km-plugin-item${isFocused ? ' is-focused' : ''}" data-km-plugin="${esc(p.key)}">` +
        `<div class="km-plugin-head"><h3>${esc(p.title)}</h3><span class="km-plugin-count">${esc(p.countLabel)}</span></div>` +
        `<p>${esc(p.description)}</p>` +
        `<div class="km-route-actions">` +
        `<a class="km-plugin-link" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.cta)}</a>` +
        `<button type="button" class="btn small" data-km-action="studio-mode" data-km-value="${esc(targetStudio)}">${esc(studioBtnLabels[p.key] || '開啟內建引擎')}</button>` +
        (selectedNode.id !== p.nodeId ? `<button type="button" class="btn small subtle" data-km-action="select" data-km-value="${esc(p.nodeId)}">聚焦此分類節點</button>` : '') +
        `</div></article>`;
    }).join('');

    const stepsHtml = FOUR_STEPS.map(s =>
      `<li><strong>步驟 ${s.step}｜${esc(s.title)}</strong>：${esc(s.detail)}</li>`
    ).join('');

    const recipesHtml = INTERVIEW_RECIPES.map((r, idx) =>
      `<div class="km-recipe" data-km-recipe="${esc(r.id)}">` +
      `<strong>配方 0${idx + 1}（${esc(r.badge)}）｜${esc(r.title)}</strong>` +
      `<p>${esc(r.body)}${copy.recipeExamples[idx] ? ' ' + esc(copy.recipeExamples[idx]) : ''}</p>` +
      `</div>`
    ).join('');

    return `<section class="km-plugin-grid" aria-label="Obsidian 285 款外掛三大分類目錄">${pluginCards}</section>` +
      `<section class="km-section-box" aria-labelledby="km-quickstart-title">` +
      `<h3 id="km-quickstart-title">四步快速安裝啟用（$0 免費 · 免訂閱）</h3>` +
      `<ol class="km-steps">${stepsHtml}</ol>` +
      `</section>` +
      `<section class="km-section-box" aria-labelledby="km-recipes-title">` +
      `<h3 id="km-recipes-title">${esc(copy.label)}甄選面試三大動態簡報配方</h3>` +
      `<div class="km-recipes">${recipesHtml}</div>` +
      `</section>` +
      `<div class="km-export-bar" aria-label="匯出 Obsidian 筆記">` +
      `<button type="button" class="btn primary small" data-km-action="download-md">下載 Obsidian 筆記 (.md)</button>` +
      `<button type="button" class="btn small" data-km-action="copy-md">複製 Markdown</button>` +
      `<p class="km-export-status" role="status" aria-live="polite">${esc(statusNote)}</p>` +
      `</div>`;
  }

  function renderDetailCard(nodes, selectedNode, specId) {
    const isMotion = selectedNode.category === 'motion';
    const actionsHtml = (selectedNode.actions || []).map(act => {
      const cls = 'btn small' + (act.primary ? ' primary' : '');
      if (act.selectNode) {
        return `<button type="button" class="${cls}" data-km-action="select" data-km-value="${esc(act.selectNode)}">${esc(act.label)}</button>`;
      }
      return `<button type="button" class="${cls}" data-km-action="route" data-km-value="${esc(act.hash)}">${esc(act.label)}</button>`;
    }).join('');

    const singleExternal = selectedNode.externalUrl
      ? `<a class="km-plugin-link" href="${esc(selectedNode.externalUrl)}" target="_blank" rel="noopener noreferrer">${esc(selectedNode.externalLabel || selectedNode.externalUrl)}</a>`
      : '';

    const badges = isMotion
      ? `<span class="km-badge is-free">$0 免費取得全部 285 款外掛</span><span class="km-badge is-value">對標商業動態簡報行情 $1,500–$4,800</span><span class="km-badge">${esc(selectedNode.badge)}</span>`
      : `<span class="km-badge">${esc(selectedNode.badge)}</span>`;

    return `<article class="km-detail-card${isMotion ? ' is-motion-spotlight' : ''}" data-km-detail="${esc(selectedNode.id)}" aria-live="polite">` +
      `<div class="km-detail-badges">${badges}</div>` +
      `<h2>${esc(selectedNode.title)}</h2>` +
      `<p class="km-detail-lead">${esc(selectedNode.summary)}</p>` +
      (singleExternal ? `<div class="km-route-actions">${singleExternal}</div>` : '') +
      `<ul class="km-highlights">${(selectedNode.highlights || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` +
      (actionsHtml ? `<div class="km-route-actions" aria-label="站內快速跳轉">${actionsHtml}</div>` : '') +
      (isMotion ? renderObsidianSpotlight(selectedNode, specId) : `<div class="km-export-bar"><button type="button" class="btn small subtle" data-km-action="select" data-km-value="obsidian-motion-285">查看 Obsidian 285 款免費動態簡報外掛指南</button></div>`) +
      `</article>`;
  }

  function renderFlythroughStage(nodes, nodeById, selectedNode, matchedIds, qTrim, copy, reduced) {
    const m = motion();
    const vbStr = m ? m.formatViewBox(cameraBox) : '0 0 960 440';
    const zoomRatio = (960 / (cameraBox[2] || 960)).toFixed(2);
    const totalStops = m ? m.TOUR_STOPS.length : 8;
    const pct = Math.min(100, Math.round(((tourStepIndex + 1) / totalStops) * 100));

    const svgEdges = EDGES.map(([fromId, toId, kind], idx) => {
      const a = nodeById.get(fromId);
      const b = nodeById.get(toId);
      if (!a || !b) return '';
      const isSelectedEdge = selectedNode.id === fromId || selectedNode.id === toId;
      const isDimmed = (activeCategory !== 'all' || qTrim) && !(matchedIds.has(fromId) && matchedIds.has(toId)) && !isSelectedEdge;
      const d = curvePath(a, b);
      const cls = ['km-edge', kind === 'motion' ? 'is-motion' : '', isSelectedEdge ? 'is-active' : '', isDimmed ? 'is-dimmed' : ''].filter(Boolean).join(' ');
      let extra = '';
      if (isSelectedEdge) {
        if (!reduced) {
          extra = `<path class="km-edge-stream${kind === 'motion' ? ' is-motion' : ''}" pathLength="100" d="${d}"/>` +
            `<circle class="km-pulse-orb${kind === 'motion' ? ' is-motion' : ''}" r="3.6">` +
            `<animateMotion dur="${(2.1 + (idx % 3) * 0.35).toFixed(2)}s" repeatCount="indefinite" path="${d}"/>` +
            `</circle>`;
        } else {
          const mx = Math.round((a.x + b.x) / 2);
          const my = Math.round((a.y + b.y) / 2);
          extra = `<circle class="km-pulse-orb${kind === 'motion' ? ' is-motion' : ''}" cx="${mx}" cy="${my}" r="3.4"/>`;
        }
      }
      return `<path class="${cls}" d="${d}"/>` + extra;
    }).join('');

    const svgNodes = nodes.map(n => {
      const rx = Math.round(n.x - n.w / 2);
      const ry = Math.round(n.y - n.h / 2);
      const isSel = n.id === selectedNode.id;
      const isDim = !matchedIds.has(n.id) && !isSel;
      const cls = [
        'km-node',
        'is-cat-' + n.category,
        n.spotlight ? 'is-spotlight' : '',
        isSel ? 'is-selected' : '',
        isDim ? 'is-dimmed' : ''
      ].filter(Boolean).join(' ');
      const halo = isSel || n.spotlight
        ? `<rect class="km-node-halo" x="${rx - 4}" y="${ry - 4}" width="${n.w + 8}" height="${n.h + 8}" rx="16" ry="16"/>`
        : '';
      return `<g class="${cls}" role="button" tabindex="0" aria-pressed="${isSel}" aria-label="${esc(n.title)}" data-km-action="select" data-km-value="${esc(n.id)}">` +
        halo +
        `<rect class="km-node-rect" x="${rx}" y="${ry}" width="${n.w}" height="${n.h}" rx="13" ry="13"/>` +
        `<text class="km-node-title" x="${n.x}" y="${n.y - 5}" text-anchor="middle">${esc(n.shortLabel)}</text>` +
        `<text class="km-node-sub" x="${n.x}" y="${n.y + 13}" text-anchor="middle">${esc(n.subLabel)}</text>` +
        `</g>`;
    }).join('');

    const captionHtml = tourActive || tourCaptionText
      ? `<div class="km-tour-caption" role="status" aria-live="polite">` +
        `<div class="km-tour-caption-top">` +
        `<span class="km-tour-step-badge">${tourActive ? `🎬 鏡頭巡航 0${tourStepIndex + 1} / 0${totalStops}` : '🎯 鏡頭定位旁白'}</span>` +
        `<span class="km-tour-node-tag">${esc(tourStepTag || selectedNode.shortLabel)}</span>` +
        `</div>` +
        `<p>${esc(tourCaptionText || selectedNode.summary)}</p>` +
        `<div class="km-tour-bar"><span style="width:${tourActive ? pct : 100}%"></span></div>` +
        `</div>`
      : '';

    return `<div class="km-camera-hud" role="toolbar" aria-label="星圖鏡頭控制列">` +
      `<div class="km-hud-group">` +
      `<button type="button" class="km-hud-btn ${tourActive ? 'is-active' : 'is-primary'}" data-km-action="${tourActive ? 'tour-stop' : 'tour-start'}" aria-pressed="${tourActive}">${tourActive ? '⏹ 停止巡航' : '▶ 7 站電影級巡航'}</button>` +
      `<button type="button" class="km-hud-btn" data-km-action="fly-selected">🎯 聚焦節點</button>` +
      `</div>` +
      `<div class="km-hud-group">` +
      `<button type="button" class="km-hud-btn" data-km-action="zoom-in" aria-label="放大鏡頭">＋ 放大</button>` +
      `<button type="button" class="km-hud-btn" data-km-action="zoom-out" aria-label="縮小鏡頭">－ 縮小</button>` +
      `<button type="button" class="km-hud-btn" data-km-action="camera-reset">↺ 全景重設</button>` +
      `<span class="km-hud-readout" data-km-zoom-readout>視角 ${zoomRatio}×</span>` +
      `</div></div>` +
      captionHtml +
      `<div class="km-graph-stage" data-km-engine="flythrough">` +
      `<svg id="km-main-svg" class="km-svg" viewBox="${vbStr}" role="group" aria-label="${esc(copy.label)}甄選互動知識地圖">` +
      `<defs>` +
      `<pattern id="km-grid-pattern" width="32" height="32" patternUnits="userSpaceOnUse">` +
      `<path d="M 32 0 L 0 0 0 32" fill="none" stroke="#1e2f52" stroke-width="0.7" opacity="0.55"/>` +
      `</pattern>` +
      `</defs>` +
      `<rect class="km-stage-grid-rect" x="0" y="0" width="960" height="440" fill="url(#km-grid-pattern)"/>` +
      `<g class="km-edges">${svgEdges}</g>` +
      `<g class="km-nodes">${svgNodes}</g>` +
      `</svg></div>`;
  }

  function buildMarkup() {
    ensureSpecialtyDefaults(activeSpecialty);
    const nodes = buildNodes(activeSpecialty, activeState);
    const copy = SPECIALTY_COPY[activeSpecialty] || SPECIALTY_COPY.oph;
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const selectedNode = nodeById.get(selectedNodeId) || nodeById.get(DEFAULT_NODE_ID) || nodes[0];
    const qTrim = searchQuery.trim();
    const matchedIds = new Set(nodes.filter(n => nodeMatchesFilter(n, activeCategory, qTrim)).map(n => n.id));
    const filteredList = nodes.filter(n => matchedIds.has(n.id));
    const reduced = isReducedMotion();
    const m = motion();

    const studioTabs = STUDIO_MODES.map(mode => {
      const on = activeStudioMode === mode.id;
      return `<button type="button" role="tab" class="km-studio-tab${on ? ' is-active' : ''}" aria-selected="${on}" data-km-action="studio-mode" data-km-value="${esc(mode.id)}">` +
        `<strong>${esc(mode.label)}</strong><span>${esc(mode.sub)}</span>` +
        `</button>`;
    }).join('');

    const filterPills = CATEGORIES.map(cat => {
      const on = activeCategory === cat.id;
      return `<button type="button" class="km-filter-pill${on ? ' is-active' : ''}" data-km-action="filter" data-km-value="${esc(cat.id)}" aria-pressed="${on}">${esc(cat.label)}</button>`;
    }).join('');

    let stageBody = '';
    let stageHeading = '互動知識網路圖（點選任一節點查看詳情與快速跳轉）';
    if (activeStudioMode === 'slides' && m) {
      stageHeading = `${copy.label}甄選 Keynote Magic-Move 變形簡報劇場`;
      stageBody = m.renderSlidesTheater(activeSpecialty, slideState, esc);
    } else if (activeStudioMode === 'sketch' && m) {
      stageHeading = `${copy.label}甄選 Excalidraw 手繪機轉動畫分鏡`;
      stageBody = m.renderSketchPlayer(activeSpecialty, sketchState, reduced, esc);
    } else {
      stageBody = renderFlythroughStage(nodes, nodeById, selectedNode, matchedIds, qTrim, copy, reduced);
    }

    const catLabelMap = { hub: '核心中樞', motion: '動態外掛', study: '閱讀題庫', interview: '面試敘事' };
    const chipsHtml = filteredList.length
      ? `<div class="km-node-grid" role="list" aria-label="知識地圖節點清單">${filteredList.map(n => {
          const isSel = n.id === selectedNode.id;
          return `<button type="button" role="listitem" class="km-node-chip${isSel ? ' is-selected' : ''}" data-km-action="select" data-km-value="${esc(n.id)}" aria-pressed="${isSel}">` +
            `<span class="km-node-chip-top"><span>${esc(catLabelMap[n.category] || '節點')}</span><span>${isSel ? '● 目前檢視' : '點選聚焦'}</span></span>` +
            `<strong>${esc(n.shortLabel)} · ${esc(n.subLabel)}</strong>` +
            `</button>`;
        }).join('')}</div>`
      : `<p class="km-empty-filter">找不到符合「${esc(qTrim)}」的節點。<button type="button" class="btn small subtle km-search-clear" data-km-action="clear-filter">重設篩選條件</button></p>`;

    return `<header class="km-header">` +
      `<div><p class="km-eyebrow">KNOWLEDGE MAP · ${esc(copy.label)}甄選導覽與動態簡報工具箱</p>` +
      `<h1>知識地圖與 Obsidian 285 免費動態簡報外掛</h1>` +
      `<p class="km-subtitle">一圖串聯站內「閱讀記憶・SRS 題庫・口試敘事」學習閉環，並整合內建 $0 動態工作台與 Obsidian 社群 285 款免費動態設計外掛（Slides 30・Canvas 222・Excalidraw 33）。</p></div>` +
      `<div class="km-stat-strip" aria-label="動態外掛關鍵統計">` +
      `<div class="km-stat-pill is-accent"><span>免費動態外掛總數</span><strong>285 款 ($0)</strong></div>` +
      `<div class="km-stat-pill"><span>Slides / Canvas / Excalidraw</span><strong>30 / 222 / 33</strong></div>` +
      `<div class="km-stat-pill"><span>對標商業簡報行情</span><strong>$1,500–$4,800</strong></div>` +
      `</div></header>` +
      `<section class="km-studio-bar" aria-label="Motion Studio 內建動態簡報工作台">` +
      `<div class="km-studio-top">` +
      `<div class="km-studio-brand">` +
      `<span class="km-studio-kicker"><i class="km-studio-dot" aria-hidden="true"></i>MOTION STUDIO · 內建 $0 實況劇場</span>` +
      `<p class="km-studio-tagline">免安裝即可在瀏覽器直接體驗「星圖 60fps 鏡頭巡航・Keynote FLIP 變形投影片・Excalidraw 手繪機轉分鏡」三大引擎。</p>` +
      `</div>` +
      `<button type="button" class="km-motion-toggle${reduced ? ' is-reduced' : ''}" data-km-action="toggle-motion" aria-pressed="${!reduced}">✨ 動態特效：${reduced ? '精簡' : '開啟'}</button>` +
      `</div>` +
      `<div class="km-studio-tabs" role="tablist" aria-label="動態引擎模式切換">${studioTabs}</div>` +
      `</section>` +
      `<div class="km-toolbar" role="region" aria-label="知識地圖分類篩選與搜尋">` +
      `<div class="km-filters" role="group" aria-label="節點分類">${filterPills}</div>` +
      `<div class="km-search-box">` +
      `<label class="vh" for="km-search">搜尋知識地圖節點或外掛</label>` +
      `<input id="km-search" class="km-search-input" type="search" value="${esc(searchQuery)}" placeholder="搜尋節點或外掛（如 Canvas、Excalidraw、PBL、SRS）…" autocomplete="off" data-km-search>` +
      (qTrim || activeCategory !== 'all' ? `<button type="button" class="btn subtle small km-search-clear" data-km-action="clear-filter">重設</button>` : '') +
      `</div></div>` +
      `<div class="km-workspace">` +
      `<section class="km-graph-card" aria-labelledby="km-graph-title">` +
      `<div class="km-graph-head"><h2 id="km-graph-title">${esc(stageHeading)}</h2>` +
      `<div class="km-legend" aria-hidden="true">` +
      `<span class="km-legend-item"><i class="km-legend-dot is-hub"></i>中樞</span>` +
      `<span class="km-legend-item"><i class="km-legend-dot is-motion"></i>動態外掛 (285)</span>` +
      `<span class="km-legend-item"><i class="km-legend-dot is-study"></i>閱讀與題庫</span>` +
      `<span class="km-legend-item"><i class="km-legend-dot is-interview"></i>面試與敘事</span>` +
      `</div></div>` +
      stageBody +
      chipsHtml +
      `</section>` +
      `<div class="km-detail-col">${renderDetailCard(nodes, selectedNode, activeSpecialty)}</div>` +
      `</div>`;
  }

  function renderIntoActive(preserveSearchFocus, renderOpts) {
    if (!activeContainer) return '';
    const opts = renderOpts || {};
    const m = motion();
    const shouldFlip = Boolean(opts.withFlip && activeStudioMode === 'slides' && m && !isReducedMotion());
    const firstRects = shouldFlip ? m.captureFlipRects(activeContainer) : null;
    if (typeof cancelFlipRaf === 'function') {
      cancelFlipRaf();
      cancelFlipRaf = null;
    }

    const doc = g.document || (g.window && g.window.document);
    let shouldRestoreSlideStageFocus = false;
    if (doc && doc.activeElement && activeContainer) {
      try {
        const ae = doc.activeElement;
        const inside = ae === activeContainer || (typeof activeContainer.contains === 'function' && activeContainer.contains(ae));
        if (inside) {
          if ((typeof ae.matches === 'function' && ae.matches('.km-slides-stage, [data-km-slides-stage]')) ||
              (typeof ae.closest === 'function' && ae.closest('.km-slides-stage, [data-km-slides-stage]')) ||
              (ae.classList && typeof ae.classList.contains === 'function' && ae.classList.contains('km-slides-stage'))) {
            shouldRestoreSlideStageFocus = true;
          }
        }
      } catch (_) {}
    }

    let selStart = null;
    let selEnd = null;
    if (preserveSearchFocus && doc && typeof doc.getElementById === 'function') {
      const prev = doc.getElementById('km-search');
      if (prev && typeof prev.selectionStart === 'number') {
        selStart = prev.selectionStart;
        selEnd = typeof prev.selectionEnd === 'number' ? prev.selectionEnd : selStart;
      }
    }
    syncMotionAttribute(activeContainer);
    const html = buildMarkup();
    activeContainer.innerHTML = html;
    if (shouldFlip && firstRects && firstRects.size) {
      m.playFlipTransition(
        activeContainer,
        firstRects,
        isReducedMotion(),
        registerManagedTimeout,
        hostEnv(),
        fn => { cancelFlipRaf = typeof fn === 'function' ? fn : null; }
      );
    }
    if (preserveSearchFocus && doc && typeof doc.getElementById === 'function') {
      const next = doc.getElementById('km-search');
      if (next) {
        try { next.focus({ preventScroll: true }); } catch (_) { try { next.focus(); } catch (__) {} }
        if (selStart !== null) {
          try { next.setSelectionRange(selStart, selEnd); } catch (_) {}
          next.selectionStart = selStart;
          next.selectionEnd = selEnd;
        }
      }
    }
    if (shouldRestoreSlideStageFocus && activeContainer && typeof activeContainer.querySelector === 'function') {
      const nextStage = activeContainer.querySelector('.km-slides-stage, [data-km-slides-stage]');
      if (nextStage && typeof nextStage.focus === 'function') {
        try { nextStage.focus({ preventScroll: true }); } catch (_) { try { nextStage.focus(); } catch (__) {} }
      }
    }
    return html;
  }

  function navigateInternalRoute(hash) {
    const target = String(hash || '').trim();
    if (!target.startsWith('#')) return false;
    if (activeState && typeof activeState.openRoute === 'function') {
      if (activeState.openRoute(target, true)) return true;
    }
    const w = g.window || g;
    if (w.OphWrittenBridge && typeof w.OphWrittenBridge.openRoute === 'function') {
      if (w.OphWrittenBridge.openRoute(target, true)) return true;
    }
    if (w.location) {
      w.location.hash = target;
      return true;
    }
    return false;
  }

  function buildObsidianMarkdown(specOverride) {
    const sid = specOverride && VALID_SPECIALTIES.has(specOverride) ? specOverride : activeSpecialty;
    const copy = SPECIALTY_COPY[sid] || SPECIALTY_COPY.oph;
    const lines = [
      '---',
      'title: "' + copy.label + '甄選知識地圖與 Obsidian 285 款免費動態簡報外掛指南"',
      'tags:',
      '  - residency-interview',
      '  - obsidian-motion-design',
      '  - knowledge-map',
      '---',
      '',
      '# ' + copy.label + '甄選知識地圖 · Obsidian 285 款免費動態設計與簡報外掛',
      '',
      '> **成本與價值對照**：以 **\\$0** 免費取得全部 **285** 款社群動態簡報外掛（對標商業動態簡報軟體／模板行情 **\\$1,500–\\$4,800**），本機離線保存、零訂閱費。',
      '',
      '## 一、三大動態設計外掛分類目錄（30 + 222 + 33 = 285 款）',
      '',
      '| 分類 | 外掛數量 | 核心特色與甄選面試定位 | 官方外掛目錄連結 |',
      '| --- | --- | --- | --- |',
      '| **Slides 動態變形投影片** | **30 款** | 像 Keynote Magic Move 平滑變形過場（適合甄選自我介紹、研究前後對照） | [開啟 Slides 目錄](https://obsidian.md/plugins?search=slides) |',
      '| **Canvas 無邊際畫布・鏡頭巡航** | **222 款** | 鏡頭飛越畫布、決策流程圖與分鏡故事板（適合 PBL 鑑別診斷樹、臨床流程與論文架構導覽） | [開啟 Canvas 目錄](https://obsidian.md/plugins?search=canvas) |',
      '| **Excalidraw 手繪草圖轉動畫** | **33 款（900 萬+ 下載）** | 手繪草圖轉為逐步動畫場景（適合解剖／機轉拆解、Case Presentation 視覺化） | [開啟 Excalidraw 目錄](https://obsidian.md/plugins?search=excalidraw) |',
      '',
      '## 二、四步快速安裝啟用',
      '',
      '1. 開啟 `Obsidian → Settings → Community plugins`（首次使用先關閉 Restricted mode 安全限制）。',
      '2. 點擊 `Browse` 並搜尋外掛名稱（或直接開啟上方三大分類目錄：`slides`、`canvas`、`excalidraw`）。',
      '3. 點擊 `Install` 安裝並 `Enable` 啟用（全程 **\\$0** 免費）。',
      '4. 開啟新筆記建立第一個動態場景——**實戰起手式**：先選一個你面試最常解釋的核心概念（如研究架構圖、臨床決策樹或代表性個案），今天先做出第 1 個動態場景。',
      '',
      '## 三、' + copy.label + '甄選面試三大實戰配方',
      '',
      '1. **自我介紹 3 分鐘研究亮點 Slides 變形**：' + INTERVIEW_RECIPES[0].body + ' ' + copy.recipeExamples[0],
      '2. **PBL／臨床決策樹 Canvas 鏡頭導覽**：' + INTERVIEW_RECIPES[1].body + ' ' + copy.recipeExamples[1],
      '3. **手術／病生理機轉 Excalidraw 手繪動畫**：' + INTERVIEW_RECIPES[2].body + ' ' + copy.recipeExamples[2],
      ''
    ];
    return lines.join('\n');
  }

  function triggerDownloadMarkdown() {
    const md = buildObsidianMarkdown(activeSpecialty);
    const copy = SPECIALTY_COPY[activeSpecialty] || SPECIALTY_COPY.oph;
    const filename = 'Obsidian-285-動態簡報外掛-' + copy.label + '甄選指南.md';
    try {
      const BlobCtor = (g.window && g.window.Blob) || g.Blob;
      const URLCtor = (g.window && g.window.URL) || g.URL;
      const doc = g.document || (g.window && g.window.document);
      if (BlobCtor && URLCtor && typeof URLCtor.createObjectURL === 'function' && doc && typeof doc.createElement === 'function') {
        const blob = new BlobCtor([md], { type: 'text/markdown;charset=utf-8' });
        const href = URLCtor.createObjectURL(blob);
        const a = doc.createElement('a');
        a.href = href;
        a.download = filename;
        if (typeof a.setAttribute === 'function') {
          a.setAttribute('href', href);
          a.setAttribute('download', filename);
        }
        if (typeof a.click === 'function') a.click();
        if (typeof URLCtor.revokeObjectURL === 'function') URLCtor.revokeObjectURL(href);
        statusNote = '已下載 Markdown 筆記：' + filename;
        renderIntoActive(false);
        return md;
      }
    } catch (_) {}
    statusNote = '已產生 Markdown 內容，請使用複製按鈕貼入 Obsidian。';
    renderIntoActive(false);
    return md;
  }

  async function triggerCopyMarkdown() {
    const md = buildObsidianMarkdown(activeSpecialty);
    const nav = (g.window && g.window.navigator) || g.navigator;
    try {
      if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
        await nav.clipboard.writeText(md);
        statusNote = '已複製 Obsidian Markdown（含 MathJax 安全跳脫 \\$0 與 \\$1,500–\\$4,800）！';
        renderIntoActive(false);
        return true;
      }
    } catch (_) {}
    statusNote = '已備妥 Obsidian Markdown 內容。';
    renderIntoActive(false);
    return false;
  }

  function syncRouteHash(routeId, silent) {
    if (silent) return;
    if (activeState && typeof activeState.onSelectNode === 'function') {
      activeState.onSelectNode(routeId);
      return;
    }
    const w = hostEnv();
    const hash = routeId ? '#knowledge-map-' + routeId : '#knowledge-map';
    if (w.history && typeof w.history.replaceState === 'function') {
      w.history.replaceState(null, '', hash);
    } else if (w.location) {
      w.location.hash = hash;
    }
  }

  function findSvgElement() {
    if (activeContainer && typeof activeContainer.querySelector === 'function') {
      const found = activeContainer.querySelector('#km-main-svg') || activeContainer.querySelector('.km-svg');
      if (found) return found;
    }
    const doc = g.document || (g.window && g.window.document);
    if (doc && typeof doc.getElementById === 'function') {
      return doc.getElementById('km-main-svg');
    }
    return null;
  }

  function animateCameraTo(targetBox, durationMs, onComplete) {
    const m = motion();
    if (!m) return cameraBox.slice();
    pendingFlightDone = null;
    if (typeof cancelCameraRaf === 'function') {
      cancelCameraRaf();
      cancelCameraRaf = null;
    }
    const fromBox = cameraBox.slice();
    const clampedTarget = m.clampViewBox(targetBox);
    cameraTargetBox = clampedTarget.slice();
    const reduced = isReducedMotion();
    const env = hostEnv();
    const hasRaf = Boolean(env && typeof env.requestAnimationFrame === 'function');

    if (reduced || !durationMs || !hasRaf) {
      cameraBox = clampedTarget.slice();
      renderIntoActive(false);
      if (typeof onComplete === 'function') onComplete(cameraBox.slice());
      return cameraBox.slice();
    }

    const svgEl = findSvgElement();
    pendingFlightDone = typeof onComplete === 'function' ? onComplete : null;
    cancelCameraRaf = m.flyToViewBox(
      svgEl,
      fromBox,
      clampedTarget,
      durationMs,
      false,
      box => {
        cameraBox = box.slice();
      },
      finalBox => {
        const doneCb = pendingFlightDone;
        pendingFlightDone = null;
        cameraBox = finalBox.slice();
        cancelCameraRaf = null;
        if (!isContainerDetached(activeContainer)) {
          renderIntoActive(false);
          if (typeof doneCb === 'function') doneCb(cameraBox.slice());
        }
      },
      env
    );
    return cameraTargetBox.slice();
  }

  function setStudioMode(modeId, options) {
    const opts = options || {};
    const nextMode = switchStudioModeInternal(modeId);
    ensureSpecialtyDefaults(activeSpecialty);
    if (opts.syncSpotlight !== false) {
      const meta = STUDIO_BY_ID.get(nextMode);
      if (meta && isValidNodeId(meta.nodeId)) selectedNodeId = meta.nodeId;
    }
    statusNote = '';
    syncRouteHash(nextMode, Boolean(opts.silent));
    renderIntoActive(false);
    return activeStudioMode;
  }

  function toggleMotion(forceReduced) {
    const nextReduced = typeof forceReduced === 'boolean' ? forceReduced : !isReducedMotion();
    userMotionOverride = nextReduced ? 'reduced' : 'forced-on';
    let resumeFlightDone = null;
    if (nextReduced && typeof cancelCameraRaf === 'function') {
      resumeFlightDone = pendingFlightDone;
      pendingFlightDone = null;
      cancelCameraRaf();
      cancelCameraRaf = null;
      cameraBox = cameraTargetBox.slice();
    }
    syncMotionAttribute(activeContainer);
    renderIntoActive(false);
    if (typeof resumeFlightDone === 'function' && !isContainerDetached(activeContainer)) {
      resumeFlightDone(cameraBox.slice());
    }
    return !nextReduced;
  }

  function flyToNode(nodeId, options) {
    const opts = options || {};
    const m = motion();
    if (!opts.fromTour && tourActive) stopTour({ silent: true });
    switchStudioModeInternal('flythrough');
    const targetId = isValidNodeId(nodeId) ? nodeId : selectedNodeId;
    selectedNodeId = isValidNodeId(targetId) ? targetId : DEFAULT_NODE_ID;
    const nodes = buildNodes(activeSpecialty, activeState);
    const node = nodes.find(n => n.id === selectedNodeId) || nodes[0];
    if (m) {
      tourStepTag = node.shortLabel;
      tourCaptionText = m.getTourCaption(activeSpecialty, node.id);
    }
    if (!opts.fromTour && !opts.silent) {
      syncRouteHash(selectedNodeId, false);
    }
    renderIntoActive(false);
    const toBox = m ? m.nodeTargetViewBox(node, opts.zoom || 2.15) : [0, 0, 960, 440];
    return animateCameraTo(toBox, opts.instant ? 0 : (opts.durationMs ?? 560), opts.onDone);
  }

  function zoomCamera(deltaOrFactor, options) {
    const opts = options || {};
    const m = motion();
    if (!m) return cameraBox.slice();
    if (tourActive) stopTour({ silent: true });
    switchStudioModeInternal('flythrough');
    const num = Number(deltaOrFactor);
    const factor = num === 1 ? 1.35 : num === -1 ? (1 / 1.35) : (num > 0 ? num : 1.35);
    const toBox = m.zoomViewBox(cameraBox, factor);
    return animateCameraTo(toBox, opts.instant ? 0 : 340);
  }

  function resetCamera(options) {
    const opts = options || {};
    if (tourActive) stopTour({ silent: true });
    switchStudioModeInternal('flythrough');
    tourCaptionText = '';
    tourStepTag = '';
    return animateCameraTo([0, 0, 960, 440], opts.instant ? 0 : 420);
  }

  function stopTour(options) {
    const opts = options || {};
    const env = hostEnv();
    const clrT = (env && typeof env.clearTimeout === 'function' ? env.clearTimeout : clearTimeout).bind(env);
    pendingFlightDone = null;
    if (tourTimerId !== null) {
      clrT(tourTimerId);
      tourTimerId = null;
    }
    if (typeof cancelCameraRaf === 'function') {
      cancelCameraRaf();
      cancelCameraRaf = null;
    }
    tourActive = false;
    tourCaptionText = '';
    tourStepTag = '';
    if (!opts.silent) renderIntoActive(false);
    return false;
  }

  function startTour(options) {
    const opts = options || {};
    const m = motion();
    if (!m) return false;
    clearAllTimers();
    switchStudioModeInternal('flythrough');
    tourActive = true;
    tourStepIndex = 0;

    const stepDelay = Math.max(120, Number(opts.stepHoldMs) || 1450);
    const flyDur = opts.instant ? 0 : (Number(opts.flyDurationMs) || 540);
    const env = hostEnv();
    const setT = (env && typeof env.setTimeout === 'function' ? env.setTimeout : setTimeout).bind(env);

    const runStop = idx => {
      if (!tourActive || activeStudioMode !== 'flythrough' || isContainerDetached(activeContainer)) {
        stopTour({ silent: true });
        return;
      }
      const stops = m.TOUR_STOPS;
      if (idx >= stops.length) {
        tourActive = false;
        renderIntoActive(false);
        return;
      }
      tourStepIndex = idx;
      const stopId = stops[idx];
      tourCaptionText = m.getTourCaption(activeSpecialty, stopId);
      if (stopId === 'overview') {
        selectedNodeId = DEFAULT_NODE_ID;
        tourStepTag = '全景歸位 Overview';
        renderIntoActive(false);
        animateCameraTo(m.OVERVIEW_BOX, flyDur, () => {
          if (!tourActive || activeStudioMode !== 'flythrough' || isContainerDetached(activeContainer)) {
            stopTour({ silent: true });
            return;
          }
          tourTimerId = setT(() => {
            tourTimerId = null;
            tourActive = false;
            if (!isContainerDetached(activeContainer)) renderIntoActive(false);
          }, stepDelay);
        });
        return;
      }

      const nodes = buildNodes(activeSpecialty, activeState);
      const node = nodes.find(n => n.id === stopId) || nodes[0];
      selectedNodeId = node.id;
      tourStepTag = node.shortLabel;
      renderIntoActive(false);
      const targetBox = m.nodeTargetViewBox(node, stopId === 'hub' ? 1.85 : 2.18);
      animateCameraTo(targetBox, flyDur, () => {
        if (!tourActive || activeStudioMode !== 'flythrough' || isContainerDetached(activeContainer)) {
          stopTour({ silent: true });
          return;
        }
        tourTimerId = setT(() => {
          tourTimerId = null;
          runStop(idx + 1);
        }, stepDelay);
      });
    };

    runStop(0);
    return true;
  }

  function setDeck(deckId) {
    const m = motion();
    if (!m) return '';
    const decks = m.getDecks(activeSpecialty);
    const found = decks.find(d => d.id === deckId) || decks[0];
    if (!found) return '';
    switchStudioModeInternal('slides');
    slideState.deckId = found.id;
    slideState.slideIndex = 0;
    renderIntoActive(false, { withFlip: true });
    return slideState.deckId;
  }

  function setSlide(index) {
    const m = motion();
    if (!m) return 0;
    ensureSpecialtyDefaults(activeSpecialty);
    const decks = m.getDecks(activeSpecialty);
    const deck = decks.find(d => d.id === slideState.deckId) || decks[0];
    const total = deck ? deck.slides.length : 4;
    const raw = Number(index);
    const nextIdx = Number.isFinite(raw) ? ((Math.trunc(raw) % total) + total) % total : 0;
    switchStudioModeInternal('slides');
    slideState.slideIndex = nextIdx;
    renderIntoActive(false, { withFlip: true });
    return slideState.slideIndex;
  }

  function toggleSlideAutoplay(force) {
    const env = hostEnv();
    const setI = (env && typeof env.setInterval === 'function' ? env.setInterval : setInterval).bind(env);
    const clrI = (env && typeof env.clearInterval === 'function' ? env.clearInterval : clearInterval).bind(env);
    const next = typeof force === 'boolean' ? force : !slideState.autoplay;
    if (slideAutoplayId !== null) {
      clrI(slideAutoplayId);
      slideAutoplayId = null;
    }
    if (next) {
      switchStudioModeInternal('slides');
      ensureSpecialtyDefaults(activeSpecialty);
      slideState.autoplay = true;
      slideAutoplayId = setI(() => {
        if (isContainerDetached(activeContainer) || activeStudioMode !== 'slides') {
          toggleSlideAutoplay(false);
          return;
        }
        setSlide(slideState.slideIndex + 1);
      }, 3400);
    } else {
      slideState.autoplay = false;
    }
    renderIntoActive(false);
    return slideState.autoplay;
  }

  function setSketchScene(sceneId) {
    const m = motion();
    if (!m) return '';
    const scenes = m.getSketchScenes(activeSpecialty);
    const found = scenes.find(s => s.id === sceneId) || scenes[0];
    if (!found) return '';
    if (sketchState.playing) toggleSketchPlay(false);
    switchStudioModeInternal('sketch');
    sketchState.sceneId = found.id;
    sketchState.step = 1;
    renderIntoActive(false);
    return sketchState.sceneId;
  }

  function updateSketchStepDOM(stepNum) {
    if (!activeContainer || activeStudioMode !== 'sketch') return false;
    const m = motion();
    if (!m || typeof m.updateSketchPlayerStep !== 'function') return false;
    ensureSpecialtyDefaults(activeSpecialty);
    const sceneId = sketchState.sceneId;
    const playerEl = activeContainer.querySelector ? (
      activeContainer.querySelector('.km-sketch-player[data-sketch-id="' + sceneId + '"]') ||
      activeContainer.querySelector('.km-sketch-shell[data-km-scene="' + sceneId + '"]') ||
      activeContainer.querySelector('.km-sketch-player') ||
      activeContainer.querySelector('.km-sketch-shell')
    ) : null;
    if (!playerEl) return false;
    const curScene = (playerEl.getAttribute && (playerEl.getAttribute('data-sketch-id') || playerEl.getAttribute('data-km-scene'))) || null;
    if (curScene && curScene !== sceneId) return false;

    sketchState.step = Math.max(1, Math.min(4, Math.trunc(Number(stepNum) || 1)));
    const updated = m.updateSketchPlayerStep(playerEl, activeSpecialty, sketchState, isReducedMotion(), esc);
    return Boolean(updated);
  }

  function setSketchStep(stepNum) {
    ensureSpecialtyDefaults(activeSpecialty);
    const clamped = Math.max(1, Math.min(4, Math.trunc(Number(stepNum) || 1)));
    switchStudioModeInternal('sketch');
    sketchState.step = clamped;
    if (!updateSketchStepDOM(clamped)) {
      renderIntoActive(false);
    }
    return sketchState.step;
  }

  function scheduleSketchInterval() {
    const env = hostEnv();
    const setI = (env && typeof env.setInterval === 'function' ? env.setInterval : setInterval).bind(env);
    const clrI = (env && typeof env.clearInterval === 'function' ? env.clearInterval : clearInterval).bind(env);
    if (sketchPlayId !== null) {
      clrI(sketchPlayId);
      sketchPlayId = null;
    }
    const intervalMs = Math.round(1650 / (sketchState.speed || 1));
    sketchPlayId = setI(() => {
      if (isContainerDetached(activeContainer) || activeStudioMode !== 'sketch') {
        toggleSketchPlay(false);
        return;
      }
      if (sketchState.step < 4) {
        sketchState.step += 1;
        if (!updateSketchStepDOM(sketchState.step)) {
          renderIntoActive(false);
        }
      } else {
        toggleSketchPlay(false);
      }
    }, intervalMs);
  }

  function toggleSketchPlay(force) {
    const env = hostEnv();
    const clrI = (env && typeof env.clearInterval === 'function' ? env.clearInterval : clearInterval).bind(env);
    const next = typeof force === 'boolean' ? force : !sketchState.playing;
    if (sketchPlayId !== null) {
      clrI(sketchPlayId);
      sketchPlayId = null;
    }
    if (next) {
      switchStudioModeInternal('sketch');
      ensureSpecialtyDefaults(activeSpecialty);
      sketchState.playing = true;
      if (sketchState.step >= 4) sketchState.step = 1;
      scheduleSketchInterval();
    } else {
      sketchState.playing = false;
    }
    if (!updateSketchStepDOM(sketchState.step)) {
      renderIntoActive(false);
    }
    return sketchState.playing;
  }

  function setSketchSpeed(speedVal) {
    const nextSpeed = Number(speedVal) === 1.75 ? 1.75 : (sketchState.speed === 1 ? 1.75 : 1);
    sketchState.speed = nextSpeed;
    if (sketchState.playing) scheduleSketchInterval();
    if (!updateSketchStepDOM(sketchState.step)) {
      renderIntoActive(false);
    }
    return sketchState.speed;
  }

  function unmount() {
    clearAllTimers();
    if (activeContainer) {
      if (typeof activeContainer.removeAttribute === 'function') {
        activeContainer.removeAttribute('data-km-mounted');
      }
      if (activeContainer.dataset) {
        delete activeContainer.dataset.kmMounted;
      }
    }
    activeContainer = null;
    return true;
  }

  function selectNode(nodeId, options) {
    const opts = options || {};
    if (VALID_STUDIO_MODES.has(nodeId)) {
      setStudioMode(nodeId, opts);
      return selectedNodeId;
    }
    if (!opts.fromTour && tourActive) {
      stopTour({ silent: true });
    }
    if (!opts.fromTour) {
      tourCaptionText = '';
      tourStepTag = '';
    }
    if (!opts.keepStudioMode) {
      switchStudioModeInternal('flythrough');
    }
    const nextId = isValidNodeId(nodeId) ? nodeId : DEFAULT_NODE_ID;
    selectedNodeId = nextId;
    statusNote = '';
    syncRouteHash(nextId, Boolean(opts.silent));
    renderIntoActive(false);
    return selectedNodeId;
  }

  function setCategory(categoryId) {
    const valid = CATEGORIES.some(c => c.id === categoryId) ? categoryId : 'all';
    activeCategory = valid;
    renderIntoActive(false);
    return activeCategory;
  }

  function setSearch(query, preserveFocus) {
    searchQuery = String(query ?? '');
    if (!isComposing) renderIntoActive(Boolean(preserveFocus));
    return searchQuery;
  }

  function handleAction(actionName, value) {
    if (actionName === 'studio-mode' || actionName === 'km-studio-mode') {
      setStudioMode(value);
      return true;
    }
    if (actionName === 'toggle-motion' || actionName === 'km-toggle-motion') {
      toggleMotion();
      return true;
    }
    if (actionName === 'tour-start') {
      startTour();
      return true;
    }
    if (actionName === 'tour-stop') {
      stopTour();
      return true;
    }
    if (actionName === 'fly-selected') {
      flyToNode(selectedNodeId, { silent: true });
      return true;
    }
    if (actionName === 'zoom-in') {
      zoomCamera(1);
      return true;
    }
    if (actionName === 'zoom-out') {
      zoomCamera(-1);
      return true;
    }
    if (actionName === 'camera-reset') {
      resetCamera();
      return true;
    }
    if (actionName === 'set-deck') {
      setDeck(value);
      return true;
    }
    if (actionName === 'set-slide') {
      setSlide(Number(value));
      return true;
    }
    if (actionName === 'slide-prev') {
      setSlide(slideState.slideIndex - 1);
      return true;
    }
    if (actionName === 'slide-next') {
      setSlide(slideState.slideIndex + 1);
      return true;
    }
    if (actionName === 'toggle-slide-autoplay') {
      toggleSlideAutoplay();
      return true;
    }
    if (actionName === 'set-sketch-scene') {
      setSketchScene(value);
      return true;
    }
    if (actionName === 'set-sketch-step') {
      setSketchStep(Number(value));
      return true;
    }
    if (actionName === 'toggle-sketch-play') {
      toggleSketchPlay();
      return true;
    }
    if (actionName === 'sketch-replay') {
      toggleSketchPlay(false);
      setSketchStep(1);
      toggleSketchPlay(true);
      return true;
    }
    if (actionName === 'toggle-sketch-speed') {
      setSketchSpeed();
      return true;
    }
    if (actionName === 'select' || actionName === 'km-select') {
      selectNode(value);
      return true;
    }
    if (actionName === 'filter' || actionName === 'km-filter') {
      setCategory(value);
      return true;
    }
    if (actionName === 'clear-filter' || actionName === 'km-clear-filter') {
      activeCategory = 'all';
      searchQuery = '';
      renderIntoActive(false);
      return true;
    }
    if (actionName === 'route' || actionName === 'km-route') {
      return navigateInternalRoute(value);
    }
    if (actionName === 'download-md' || actionName === 'km-download-md') {
      triggerDownloadMarkdown();
      return true;
    }
    if (actionName === 'copy-md' || actionName === 'km-copy-md') {
      triggerCopyMarkdown();
      return true;
    }
    return false;
  }

  function bindContainerEvents(container) {
    if (!container || typeof container.addEventListener !== 'function' || boundContainers.has(container)) return;
    boundContainers.add(container);

    container.addEventListener('click', e => {
      if (!isContainerInteractive(container)) return;
      const target = e && e.target;
      if (!target || typeof target.closest !== 'function') return;
      if (target.closest('a[href]')) return;
      const el = target.closest('[data-km-action]');
      if (!el) return;
      const act = el.getAttribute ? el.getAttribute('data-km-action') : (el.dataset && el.dataset.kmAction);
      const val = (el.getAttribute ? el.getAttribute('data-km-value') : (el.dataset && el.dataset.kmValue)) || '';
      if (act && handleAction(act, val)) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
      }
    });

    container.addEventListener('keydown', e => {
      if (!e || !isContainerInteractive(container)) return;
      const target = e.target;
      const isSearchInput = target && (target.id === 'km-search' || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (!isSearchInput && activeStudioMode === 'slides' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        setSlide(slideState.slideIndex + (e.key === 'ArrowRight' ? 1 : -1));
        return;
      }
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (!target || typeof target.closest !== 'function') return;
      const nodeEl = target.closest('g.km-node[data-km-action="select"]');
      if (!nodeEl) return;
      if (typeof e.preventDefault === 'function') e.preventDefault();
      const val = (nodeEl.getAttribute ? nodeEl.getAttribute('data-km-value') : (nodeEl.dataset && nodeEl.dataset.kmValue)) || '';
      if (val) selectNode(val);
    });

    container.addEventListener('compositionstart', e => {
      if (e && e.target && e.target.id === 'km-search') isComposing = true;
    });
    container.addEventListener('compositionend', e => {
      if (!e || !e.target || e.target.id !== 'km-search') return;
      isComposing = false;
      setSearch(e.target.value, true);
    });
    container.addEventListener('input', e => {
      if (!isContainerInteractive(container)) return;
      const el = e && e.target;
      if (!el || el.id !== 'km-search') return;
      if (e.isComposing || isComposing) {
        searchQuery = String(el.value ?? '');
        return;
      }
      setSearch(el.value, true);
    });
  }

  function mount(container, state) {
    if (!container) return null;
    if (activeContainer && activeContainer !== container) {
      clearAllTimers();
    }
    const nextSpec = resolveSpecialty(state);
    if (nextSpec !== activeSpecialty) {
      clearAllTimers();
      activeCategory = 'all';
      searchQuery = '';
      statusNote = '';
      cameraBox = [0, 0, 960, 440];
      cameraTargetBox = [0, 0, 960, 440];
      tourCaptionText = '';
      tourStepTag = '';
      slideState = { deckId: '', slideIndex: 0, autoplay: false };
      sketchState = { sceneId: '', step: 1, playing: false, speed: 1 };
    }
    activeContainer = container;
    activeState = state || {};
    activeSpecialty = nextSpec;
    ensureSpecialtyDefaults(nextSpec);

    const rawStateRoute = state && typeof state.selectedNodeId === 'string'
      ? state.selectedNodeId
      : (state && typeof state.nodeId === 'string' ? state.nodeId : '');
    const stateRoute = rawStateRoute && isValidRouteId(rawStateRoute) ? rawStateRoute : '';
    const explicitGenericReset = Boolean(state && state.explicitRoute && !stateRoute);
    const hashStr = (g.window && g.window.location && g.window.location.hash) || (g.location && g.location.hash) || '';
    const hashRoute = explicitGenericReset ? null : parseRouteFromHash(hashStr);
    const chosenRoute = stateRoute || hashRoute || '';

    if (explicitGenericReset) {
      switchStudioModeInternal('flythrough');
      selectedNodeId = DEFAULT_NODE_ID;
      cameraBox = [0, 0, 960, 440];
      cameraTargetBox = [0, 0, 960, 440];
      tourCaptionText = '';
      tourStepTag = '';
    } else if (VALID_STUDIO_MODES.has(chosenRoute)) {
      switchStudioModeInternal(chosenRoute);
      const meta = STUDIO_BY_ID.get(chosenRoute);
      if (meta && isValidNodeId(meta.nodeId)) selectedNodeId = meta.nodeId;
    } else if (isValidNodeId(chosenRoute)) {
      switchStudioModeInternal('flythrough');
      selectedNodeId = chosenRoute;
    } else if (hashStr === '#knowledge-map' || hashStr === '#tab-map' || !isValidNodeId(selectedNodeId) || (state && rawStateRoute === '' && !hashRoute)) {
      switchStudioModeInternal('flythrough');
      selectedNodeId = DEFAULT_NODE_ID;
      cameraBox = [0, 0, 960, 440];
      cameraTargetBox = [0, 0, 960, 440];
      tourCaptionText = '';
      tourStepTag = '';
    }

    if (typeof container.setAttribute === 'function') {
      container.setAttribute('data-km-mounted', '1');
    }
    if (container.dataset) {
      container.dataset.kmMounted = '1';
    }
    bindContainerEvents(container);
    renderIntoActive(false);
    return api;
  }

  function routeLabel(routeId, specOverride) {
    const sid = specOverride && VALID_SPECIALTIES.has(specOverride) ? specOverride : activeSpecialty;
    if (!routeId) return '知識地圖';
    if (VALID_STUDIO_MODES.has(routeId)) {
      return STUDIO_BY_ID.get(routeId).shortLabel;
    }
    if (!isValidNodeId(routeId)) return '知識地圖';
    const found = buildNodes(sid).find(n => n.id === routeId);
    return found ? found.title : '知識地圖';
  }

  function input(el) {
    if (!el || el.id !== 'km-search') return false;
    setSearch(el.value, true);
    return true;
  }

  function _onMotionReady() {
    ensureSpecialtyDefaults(activeSpecialty);
    if (activeContainer && !isContainerDetached(activeContainer)) {
      renderIntoActive(false);
    }
  }

  const api = Object.freeze({
    NODES: CANONICAL_NODES,
    STUDIO_MODES,
    CATEGORIES,
    OBSIDIAN_PLUGINS,
    FOUR_STEPS,
    INTERVIEW_RECIPES,
    DEFAULT_NODE_ID,
    mount,
    unmount,
    selectNode,
    setStudioMode,
    getStudioMode: () => activeStudioMode,
    toggleMotion,
    isReducedMotion,
    flyToNode,
    zoomCamera,
    resetCamera,
    getCameraBox: () => cameraBox.slice(),
    getTargetCameraBox: () => cameraTargetBox.slice(),
    startTour,
    stopTour,
    isTourActive: () => tourActive,
    setDeck,
    setSlide,
    toggleSlideAutoplay,
    getSlideState: () => ({ ...slideState }),
    setSketchScene,
    setSketchStep,
    toggleSketchPlay,
    setSketchSpeed,
    getSketchState: () => ({ ...sketchState }),
    getActiveTimerCount,
    setCategory,
    setSearch,
    action: handleAction,
    input,
    getNodes: (specId, state) => buildNodes(specId || activeSpecialty, state || activeState),
    getSelectedNodeId: () => selectedNodeId,
    getCategory: () => activeCategory,
    getSearch: () => searchQuery,
    isValidNodeId,
    isValidRouteId,
    routeLabel,
    buildObsidianMarkdown,
    _onMotionReady
  });

  g.OphKnowledgeMap = api;
  if (g.window && g.window !== g) g.window.OphKnowledgeMap = api;
  var initialDoc = g.document || (g.window && g.window.document);
  var initialRoot = initialDoc && typeof initialDoc.getElementById === 'function' ? initialDoc.getElementById('knowledge-map-root') : null;
  if (initialRoot && (!initialRoot.getAttribute || !initialRoot.getAttribute('data-km-mounted'))) {
    mount(initialRoot);
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
