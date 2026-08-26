/* ============================================================
   AIバトルコーチ フロントエンド
   - ユーザーごとの表示モード（kids / junior）で語彙・装飾を切替
   - 保護者設定は PIN 認証（サーバ側でトークン検証）
   ============================================================ */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const root = document.documentElement;

  // ソフトキーボード端末（スマホ・タブレット）。Shift + Enter が押せないため
  // Enter は改行として扱い、送信は送信ボタンのみとする
  const isSoftKeyboard = window.matchMedia("(hover: none) and (pointer: coarse)").matches;

  /* ---------- 語彙テーブル ---------- */
  const L = {
    kids: {
      appName: "AIバトルコーチ",
      tagline: "つよくなる さくせんを おしえるよ！",
      newChat: "あたらしい おはなし",
      history: "これまでの おはなし",
      emptyTitle: "なにを しらべる？",
      emptyDesc: "したの ボタンを おすか、じぶんで かいてみてね",
      placeholder: "しつもんを かいてね",
      hint: "Enter でおくる / Shift + Enter で かいぎょう",
      hintTouch: "→ ボタンで おくる / Enter で かいぎょう",
      thinking: "ロトムが しらべているよ！",
      stop: "やめる",
      stopped: "とちゅうで やめたよ",
      // ツールの種別ごとの待機文言。サーバーは種別と対象名だけを送る
      progress: {
        lookup: (x) => (x ? x + " を しらべているよ" : "ずかんを みているよ"),
        search: (x) => (x ? x + " の なかまを さがしているよ" : "ポケモンを さがしているよ"),
        calculate: (x) => (x ? x + " の つよさを けいさんしているよ" : "けいさん しているよ"),
        analyze: (x) => (x ? x + " を くらべているよ" : "さくせんを かんがえているよ"),
        party: () => "パーティを みているよ",
        match: () => "たたかいの きろくを みているよ",
        theory: () => "そだてかたを よみこんでいるよ",
        ranking: (x) => (x ? x + " の じゅんいを しらべているよ" : "じゅんいひょうを みているよ"),
      },
      // 3択クイズ（ADR-0011）。正誤判定はここで完結し、AI には問い合わせない
      quiz: {
        count: (i, n) => i + "もんめ / ぜんぶで " + n + "もん",
        correct: "せいかい！",
        wrong: "ざんねん…",
        answerWas: (s) => "こたえは 「" + s + "」 だよ",
        next: "つぎの もんだい",
        again: "もういちど やる",
        finish: "おしまい",
        result: (c, n) => n + "もんちゅう " + c + "もん せいかい！",
        scoreIntro: (c, n) => "クイズ おわり！ " + n + "もんちゅう " + c + "もん せいかい だったよ。",
        scoreLine: (i, q, picked, ok, answer) =>
          i + ". 「" + q + "」→ 「" + picked + "」 を えらんだよ（" +
          (ok ? "せいかい" : "ちがった。こたえは 「" + answer + "」") + "）",
        scoreAgain: "ほめて、まちがえた ところを おしえてね。そのあと つぎの 5もんを だして！",
        scoreEnd: "ほめて、まちがえた ところを かんたんに おしえてね。",
      },
      sec: (n) => n + "びょう",
      copy: "コピー",
      copyCode: "コードを コピー",
      rename: "なまえを かえる", del: "けす",
      renameTitle: "なまえを かえる",
      delTitle: "この おはなしを けす？",
      delWarn: "けすと もとに もどせません。",
      noName: "(なまえなし)", noSessions: "まだ おはなしが ないよ",
      whoUses: "だれが つかう？",
      addUser: "＋ あたらしい人",
      addUserTitle: "あたらしい人を つくる",
      add: "つくる",
      avatarTitle: "アイコンを えらぶ",
      changeMyIcon: "じぶんの アイコンを かえる",
      delUserTitle: "この人を けす？",
      delUserWarn: "この人の おはなしも ぜんぶ きえます。もとに もどせません。",
      fontSize: "もじの おおきさ", fsNormal: "ふつう", fsLarge: "おおきい",
      close: "とじる", cancel: "やめる", save: "ほぞん", change: "かえる",
      parentSettings: "おうちの人の せってい",
      pinNote: "4けたの あんしょうばんごう を いれてください",
      modeLabel: "つかう人の モード",
      promptLabel: "AI の せいかく（システムプロンプト）",
      promptUser: "だれの ぶん？",
      promptNote: "この せいかくは えらんだ人だけに つかわれます。からっぽ にすると みんな共通の さいしょの せってい に もどります。",
      appearance: "みため", thAuto: "じどう", thLight: "あかるい", thDark: "くらい",
      pinChange: "あんしょうばんごうを かえる",
      errTitle: "うまく つながらなかったよ", retry: "もういちど",
      switched: (n) => n + " に きりかえたよ",
      copied: "コピーしたよ", renamed: "なまえを かえたよ",
      deleted: "けしたよ", saved: "ほぞん したよ", pinNg: "ばんごうが ちがうよ",
      loadFailed: "よみこみに しっぱいしたよ",
      aiName: "ロトム",
      thinkingImg: "pikachu-dance",
      suggestions: [
        "3たくクイズを だして！",
        "リザードンの しゅぞくち は？",
        "ピカチュウの そだてかた を おしえて",
        "みずタイプに つよい ポケモンは？",
        "カビゴンの とくせい は なに？",
      ],
    },
    junior: {
      appName: "AIバトルコーチ",
      tagline: "ポケモンチャンピオンズ 対戦アドバイザー",
      newChat: "新しいチャット",
      history: "履歴",
      emptyTitle: "何を調べる？",
      emptyDesc: "下の例を選ぶか、自由に質問してください",
      placeholder: "ポケモンや対戦について質問する",
      hint: "Enter で送信 / Shift + Enter で改行",
      hintTouch: "→ ボタンで送信 / Enter で改行",
      thinking: "ロトムが調べています",
      stop: "中止",
      stopped: "送信を中止しました",
      progress: {
        lookup: (x) => (x ? x + " のデータを取得中" : "データを取得中"),
        search: (x) => (x ? x + " から候補を検索中" : "候補を検索中"),
        calculate: (x) => (x ? x + " のダメージを計算中" : "ダメージを計算中"),
        analyze: (x) => (x ? x + " の対面を分析中" : "対面を分析中"),
        party: () => "パーティを読み書き中",
        match: () => "対戦記録を参照中",
        theory: () => "育成論を取り込んでいます",
        ranking: (x) => (x ? x + " の順位を調べています" : "順位表を参照中"),
      },
      quiz: {
        count: (i, n) => i + " 問目 / 全 " + n + " 問",
        correct: "正解！",
        wrong: "不正解",
        answerWas: (s) => "正解は「" + s + "」",
        next: "次の問題",
        again: "もう一度",
        finish: "終了",
        result: (c, n) => n + " 問中 " + c + " 問正解",
        scoreIntro: (c, n) => "クイズ終了。" + n + " 問中 " + c + " 問正解でした。",
        scoreLine: (i, q, picked, ok, answer) =>
          i + ". 「" + q + "」→ 「" + picked + "」を選択（" +
          (ok ? "正解" : "不正解。正解は「" + answer + "」") + "）",
        scoreAgain: "簡単に振り返ってから、次の 5 問を出してください。",
        scoreEnd: "間違えた問題だけ簡単に解説してください。",
      },
      sec: (n) => n + "秒",
      copy: "コピー",
      copyCode: "コードをコピー",
      rename: "名前を変更", del: "削除",
      renameTitle: "名前を変更",
      delTitle: "このチャットを削除しますか？",
      delWarn: "削除すると元に戻せません。",
      noName: "(無題)", noSessions: "履歴はまだありません",
      whoUses: "ユーザーを選択",
      addUser: "＋ 新規ユーザー",
      addUserTitle: "新しいユーザーを作成",
      add: "作成",
      avatarTitle: "アイコンを選択",
      changeMyIcon: "自分のアイコンを変更",
      delUserTitle: "このユーザーを削除しますか？",
      delUserWarn: "このユーザーのチャット履歴もすべて削除されます。元に戻せません。",
      fontSize: "文字サイズ", fsNormal: "標準", fsLarge: "大きい",
      close: "閉じる", cancel: "キャンセル", save: "保存", change: "変更",
      parentSettings: "設定（保護者向け）",
      pinNote: "4桁の暗証番号を入力してください",
      modeLabel: "ユーザーごとの表示モード",
      promptLabel: "AI の性格（システムプロンプト）",
      promptUser: "対象ユーザー",
      promptNote: "この性格は選択したユーザーにのみ適用されます。空欄にすると全員共通の初期設定に戻ります。",
      appearance: "外観", thAuto: "自動", thLight: "ライト", thDark: "ダーク",
      pinChange: "暗証番号を変更",
      errTitle: "接続に失敗しました", retry: "再送信",
      switched: (n) => n + " に切り替えました",
      copied: "コピーしました", renamed: "名前を変更しました",
      deleted: "削除しました", saved: "保存しました", pinNg: "暗証番号が違います",
      loadFailed: "読み込みに失敗しました",
      aiName: "ロトム",
      thinkingImg: "ball",
      suggestions: [
        "3択クイズを出して",
        "リザードンの種族値は？",
        "カメックスのSP調整を教えて",
        "水タイプに強いポケモンは？",
        "ピカチュウの育成論",
      ],
    },
  };

  /* 選べるアバター（public/img/avatars/*.png と対応） */
  const AVATARS = [
    "pikachu-face", "pikachu", "eevee", "squirtle", "charmander", "bulbasaur",
    "sobble", "scorbunny", "grookey", "psyduck", "jigglypuff", "snorlax",
    "ditto", "lapras", "rowlet", "pikachu-face-happy",
  ];
  const avatarUrl = (key) => "/public/img/avatars/" + (key || "pikachu-face") + ".png";

  /* ---------- 状態 ---------- */
  const els = {
    sidebar: $("#sidebar"), scrim: $("#scrim"),
    list: $("#session-list"),
    inner: $("#messages-inner"), scroll: $("#messages"),
    thinking: $("#thinking"), elapsed: $("#elapsed"),
    thinkingLabel: $("#thinking-label"), stop: $("#stop-btn"),
    input: $("#input"), send: $("#send-btn"),
  };

  let users = [];
  let currentUser = null;
  let sessions = [];
  let currentSessionId = null;
  let sending = false;
  let parentToken = null;
  let timer = null;
  /** 送信中の AbortController。中止ボタンが使う */
  let currentAbort = null;
  /**
   * 進行中の 3 択クイズ（ADR-0011）。
   * { questions, index, results } を持つ。サーバーは状態を持たないため、
   * リロードすればクイズは終わる。
   */
  let quiz = null;

  const t = () => L[currentUser ? currentUser.mode : "kids"];

  /* ---------- ユーティリティ ---------- */
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el._h);
    el._h = setTimeout(() => el.classList.remove("show"), 2000);
  }

  async function api(path, options) {
    const opts = Object.assign({ headers: {} }, options);
    if (opts.body) opts.headers["Content-Type"] = "application/json";
    if (parentToken) opts.headers["X-Parent-Token"] = parentToken;

    const res = await fetch(path, opts);
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      throw new Error((data && data.error) || "HTTP " + res.status);
    }
    return data;
  }

  function relTime(ts) {
    if (!ts) return "";
    const kids = currentUser && currentUser.mode === "kids";
    const m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1) return "たった今";
    if (m < 60) return m + "分前";
    const d = new Date(ts);
    const hm = ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
    const today = new Date();
    if (today.toDateString() === d.toDateString()) return (kids ? "きょう " : "今日 ") + hm;
    const y = new Date(Date.now() - 86400000);
    if (y.toDateString() === d.toDateString()) return (kids ? "きのう " : "昨日 ") + hm;
    return (d.getMonth() + 1) + "月" + d.getDate() + "日";
  }

  function closeDrawer() {
    els.sidebar.classList.remove("open");
    els.scrim.classList.remove("show");
  }

  /**
   * Markdown を HTML に変換する。
   * marked は生 HTML をそのまま通すため、変換前に < > を実体参照へ置換して
   * AI 応答やツール結果由来の HTML が実行されないようにする。
   */
  function renderMarkdown(src) {
    const safe = String(src || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = window.marked ? window.marked.parse(safe) : safe;
    // 表は横スクロール用のラッパで包む
    return html.replace(/<table>/g, '<div class="tablewrap"><table>')
               .replace(/<\/table>/g, "</table></div>");
  }

  /**
   * コードブロックに「コピー」ボタンを付ける。
   * スマホでは長いコードの範囲選択が難しく、ワンタップで全文をコピーできるようにする。
   * marked の出力は <pre><code> なので、ラッパ + ヘッダを挟んでボタンを置く。
   */
  function enhanceCodeBlocks(rootEl, d) {
    rootEl.querySelectorAll("pre").forEach((pre) => {
      if (pre.closest(".codeblock")) return;

      const code = pre.querySelector("code");
      const lang = code && (code.className.match(/language-(\S+)/) || [])[1];

      const wrap = document.createElement("div");
      wrap.className = "codeblock";

      const head = document.createElement("div");
      head.className = "codeblock-head";
      if (lang) {
        const label = document.createElement("span");
        label.className = "codeblock-lang";
        label.textContent = lang;
        head.appendChild(label);
      }

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "codeblock-copy";
      btn.textContent = d.copyCode;
      btn.addEventListener("click", () => {
        if (navigator.clipboard) {
          // marked はコード末尾に改行を 1 つ付けるため、コピー時は落とす
          navigator.clipboard.writeText(pre.textContent.replace(/\n$/, "")).then(() => toast(t().copied));
        }
      });
      head.appendChild(btn);

      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(head);
      wrap.appendChild(pre);
    });
  }

  /* ---------- モード適用 ---------- */
  function applyMode() {
    const d = t();
    root.setAttribute("data-mode", currentUser ? currentUser.mode : "kids");
    document.querySelectorAll("[data-l]").forEach((el) => {
      const v = d[el.dataset.l];
      if (typeof v === "string") el.textContent = v;
    });
    const hintEl = $('[data-l="hint"]');
    if (hintEl && isSoftKeyboard) hintEl.textContent = d.hintTouch;
    els.input.placeholder = d.placeholder;
    $("#thinking-img").src = avatarUrl(d.thinkingImg);
    document.title = d.appName;
  }

  /* ---------- ユーザー ---------- */
  function storedUserId() {
    try { return localStorage.getItem("ai-rotom-user"); } catch (e) { return null; }
  }
  function storeUserId(id) {
    try { localStorage.setItem("ai-rotom-user", id); } catch (e) { /* ignore */ }
  }

  function renderUserChip() {
    if (!currentUser) return;
    $("#user-chip-img").src = avatarUrl(currentUser.avatar);
    $("#user-chip-name").textContent = currentUser.display_name;
  }

  function renderUserGrid() {
    const d = t();
    const g = $("#user-grid");
    g.innerHTML = "";

    users.forEach((u) => {
      const c = document.createElement("button");
      c.type = "button";
      c.className = "userCard" + (currentUser && u.user_id === currentUser.user_id ? " sel" : "");
      c.innerHTML = '<img alt=""><span class="n"></span><span class="m"></span>';
      c.querySelector("img").src = avatarUrl(u.avatar);
      c.querySelector(".n").textContent = u.display_name;
      c.querySelector(".m").textContent = u.mode === "kids" ? "キッズ" : "ジュニア";
      c.addEventListener("click", () => switchUser(u));
      g.appendChild(c);
    });

    const add = document.createElement("button");
    add.type = "button";
    add.className = "userCard add";
    add.textContent = d.addUser;
    add.addEventListener("click", openAddUser);
    g.appendChild(add);
  }

  async function switchUser(u) {
    currentUser = u;
    storeUserId(u.user_id);
    applyMode();
    renderUserChip();
    renderUserGrid();
    $("#user-dialog").close();
    toast(t().switched(u.display_name));
    currentSessionId = null;
    await loadSessions();
    selectSession(null);
  }

  function openAddUser() {
    const dlg = $("#adduser-dialog");
    $("#adduser-name").value = "";
    dlg.showModal();
    $("#adduser-ok").onclick = async () => {
      const name = $("#adduser-name").value.trim();
      if (!name) return;
      try {
        const created = await api("/api/users", {
          method: "POST",
          body: JSON.stringify({ user_id: name, display_name: name }),
        });
        dlg.close();
        await loadUsers();
        const found = users.find((x) => x.user_id === created.user_id);
        if (found) await switchUser(found);
      } catch (e) {
        toast(e.message);
      }
    };
  }

  async function loadUsers() {
    users = await api("/api/users");
    if (!Array.isArray(users)) users = [];
  }

  /* ---------- セッション ---------- */
  async function loadSessions() {
    if (!currentUser) return;
    try {
      sessions = await api("/api/sessions?user_id=" + encodeURIComponent(currentUser.user_id));
      if (!Array.isArray(sessions)) sessions = [];
    } catch (e) {
      sessions = [];
      toast(t().loadFailed);
    }
    renderList();
  }

  function renderList() {
    const d = t();
    els.list.innerHTML = "";

    if (!sessions.length) {
      const div = document.createElement("div");
      div.className = "empty-list";
      div.textContent = d.noSessions;
      els.list.appendChild(div);
      return;
    }

    sessions.forEach((s) => {
      const it = document.createElement("div");
      it.className = "session-item" + (currentSessionId === s.session_id ? " active" : "");
      it.tabIndex = 0;
      it.innerHTML =
        '<div class="txt"><div class="nm"></div><div class="tm"></div></div>' +
        '<button class="more" type="button" aria-label="メニュー">' +
        '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>' +
        "</button>";
      it.querySelector(".nm").textContent = s.session_name || d.noName;
      it.querySelector(".tm").textContent = relTime(s.updated_at);

      it.addEventListener("click", (e) => {
        if (e.target.closest(".more")) return;
        selectSession(s.session_id);
        closeDrawer();
      });
      it.querySelector(".more").addEventListener("click", (e) => {
        e.stopPropagation();
        openMenu(e.currentTarget, s);
      });
      els.list.appendChild(it);
    });
  }

  function openMenu(anchor, s) {
    closeMenu();
    const d = t();
    const m = document.createElement("div");
    m.className = "menu";
    m.id = "ctxmenu";
    m.innerHTML =
      '<button type="button" data-a="rename">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg><span></span></button>' +
      '<button type="button" class="danger" data-a="delete">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg><span></span></button>';
    m.querySelectorAll("span")[0].textContent = d.rename;
    m.querySelectorAll("span")[1].textContent = d.del;
    document.body.appendChild(m);

    const r = anchor.getBoundingClientRect();
    m.style.top = Math.min(r.bottom + 6, window.innerHeight - m.offsetHeight - 10) + "px";
    m.style.left = Math.min(r.left - 150, window.innerWidth - m.offsetWidth - 10) + "px";

    m.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      closeMenu();
      if (b.dataset.a === "rename") openRename(s);
      else openDelete(s);
    });
    setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);
  }
  function closeMenu() {
    const m = $("#ctxmenu");
    if (m) m.remove();
  }

  function openRename(s) {
    const dlg = $("#rename-dialog");
    $("#rename-input").value = s.session_name || "";
    dlg.showModal();
    $("#rename-ok").onclick = async () => {
      const v = $("#rename-input").value.trim();
      dlg.close();
      if (!v) return;
      try {
        await api("/api/sessions/" + encodeURIComponent(s.session_id), {
          method: "PUT",
          body: JSON.stringify({ name: v }),
        });
        s.session_name = v;
        renderList();
        toast(t().renamed);
      } catch (e) {
        toast(e.message);
      }
    };
  }

  function openDelete(s) {
    const dlg = $("#delete-dialog");
    $("#delete-target").textContent = "「" + (s.session_name || t().noName) + "」";
    dlg.showModal();
    $("#delete-ok").onclick = async () => {
      dlg.close();
      try {
        await api(
          "/api/sessions/" + encodeURIComponent(s.session_id) +
          "?user_id=" + encodeURIComponent(currentUser.user_id),
          { method: "DELETE" },
        );
        sessions = sessions.filter((x) => x.session_id !== s.session_id);
        if (currentSessionId === s.session_id) {
          currentSessionId = null;
          selectSession(null);
        }
        renderList();
        toast(t().deleted);
      } catch (e) {
        toast(e.message);
      }
    };
  }

  /* ---------- メッセージ ---------- */
  async function selectSession(id) {
    currentSessionId = id;
    els.inner.innerHTML = "";
    renderList();

    if (!id) {
      renderEmpty();
      return;
    }

    try {
      const msgs = await api("/api/sessions/" + encodeURIComponent(id));
      els.inner.innerHTML = "";
      (Array.isArray(msgs) ? msgs : []).forEach((m) => {
        if (m.role === "user") appendMessage("user", m.content);
        else if (m.role === "assistant" && m.content) appendMessage("assistant", m.content);
      });
      scrollBottom();
    } catch (e) {
      toast(t().loadFailed);
    }
  }

  function renderEmpty() {
    const d = t();
    const wrap = document.createElement("div");
    wrap.className = "empty";
    wrap.innerHTML =
      '<img src="' + avatarUrl("ball") + '" alt="">' +
      '<div class="t"></div><div class="d"></div><div class="chips"></div>';
    wrap.querySelector(".t").textContent = d.emptyTitle;
    wrap.querySelector(".d").textContent = d.emptyDesc;

    const chips = wrap.querySelector(".chips");
    d.suggestions.forEach((q) => {
      const c = document.createElement("button");
      c.type = "button";
      c.className = "chip";
      c.textContent = q;
      c.addEventListener("click", () => {
        els.input.value = q;
        autoGrow();
        send();
      });
      chips.appendChild(c);
    });
    els.inner.appendChild(wrap);
  }

  function appendMessage(role, content) {
    const d = t();
    const el = document.createElement("div");
    el.className = "msg msg-" + role;

    const av = role === "user" ? avatarUrl(currentUser && currentUser.avatar) : avatarUrl("ball");
    el.innerHTML =
      '<div class="avatar"><img alt=""></div>' +
      '<div class="col"><div class="who"></div><div class="bubble"></div></div>';
    el.querySelector(".avatar img").src = av;
    el.querySelector(".who").textContent =
      role === "user" ? (currentUser ? currentUser.display_name : "") : d.aiName;

    const bubble = el.querySelector(".bubble");
    if (role === "assistant") {
      bubble.innerHTML = renderMarkdown(content);
      enhanceCodeBlocks(bubble, d);
    } else bubble.textContent = content;

    if (role === "assistant") {
      const acts = document.createElement("div");
      acts.className = "msg-actions";
      acts.innerHTML =
        '<button type="button" data-a="copy">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg><span></span></button>';
      acts.querySelector("span").textContent = d.copy;

      acts.querySelector('[data-a="copy"]').addEventListener("click", () => {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(content).then(() => toast(t().copied));
        }
      });
      el.querySelector(".col").appendChild(acts);
    }

    els.inner.appendChild(el);
  }

  function appendError(msg, retryText) {
    const d = t();
    const el = document.createElement("div");
    el.className = "errorcard";
    el.innerHTML =
      '<div><strong></strong><div style="font-size:.85rem;margin-top:2px"></div></div>' +
      '<button class="retry" type="button"></button>';
    el.querySelector("strong").textContent = d.errTitle;
    el.querySelector("div div").textContent = msg;
    const btn = el.querySelector(".retry");
    btn.textContent = d.retry;
    btn.addEventListener("click", () => {
      el.remove();
      els.input.value = retryText;
      autoGrow();
      send();
    });
    els.inner.appendChild(el);
    scrollBottom();
  }

  function scrollBottom() {
    requestAnimationFrame(() => {
      els.scroll.scrollTop = els.scroll.scrollHeight;
    });
  }

  /* ---------- 3択クイズ（ADR-0011） ---------- */
  /** 5 問まとめて受け取り、1 問ずつ出す。以降 AI への往復は発生しない */
  function startQuiz(questions) {
    quiz = { questions: questions, index: 0, results: [] };
    renderQuestion();
  }

  /**
   * 進行中のクイズを畳む。押しかけのボタンを画面に残さない。
   * 過去ログから読み込んだカードは元々ボタンを持たないため対象外。
   */
  function closeQuiz() {
    quiz = null;
    els.inner.querySelectorAll(".quizcard .quiz-actions").forEach((el) => el.remove());
    els.inner.querySelectorAll(".quiz-choice").forEach((b) => { b.disabled = true; });
  }

  function renderQuizActions(card, actions) {
    const wrap = card.querySelector(".quiz-actions");
    wrap.innerHTML = "";
    actions.forEach((a) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "quiz-act" + (a.ghost ? " ghost" : "");
      b.textContent = a.label;
      b.addEventListener("click", a.act);
      wrap.appendChild(b);
    });
  }

  function renderQuestion() {
    const d = t().quiz;
    const q = quiz.questions[quiz.index];

    const card = document.createElement("div");
    card.className = "quizcard";
    card.innerHTML =
      '<div class="quiz-head"></div><div class="quiz-q"></div>' +
      '<div class="quiz-choices"></div><div class="quiz-feedback"></div>' +
      '<div class="quiz-actions"></div>';
    card.querySelector(".quiz-head").textContent = d.count(quiz.index + 1, quiz.questions.length);
    card.querySelector(".quiz-q").textContent = q.question;

    const choices = card.querySelector(".quiz-choices");
    q.choices.forEach((text, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "quiz-choice";
      b.innerHTML = '<span class="num"></span><span class="tx"></span>';
      b.querySelector(".num").textContent = String(i + 1);
      b.querySelector(".tx").textContent = text;
      b.addEventListener("click", () => answerQuestion(card, i));
      choices.appendChild(b);
    });

    // 1 問目から「おしまい」を出す。やめる操作は常に手元にある
    renderQuizActions(card, [{ label: d.finish, ghost: true, act: () => finishQuiz(false) }]);

    els.inner.appendChild(card);
    scrollBottom();
  }

  /**
   * 正誤はここで確定させる。AI に判定させると、自分が出した正解を取り違えて
   * 「正解なのに不正解」と言うことがある（ADR-0011）。
   */
  function answerQuestion(card, picked) {
    if (!quiz) return;
    const d = t().quiz;
    const q = quiz.questions[quiz.index];
    const ok = picked === q.answer_index;

    quiz.results.push({
      question: q.question,
      picked: q.choices[picked],
      answer: q.choices[q.answer_index],
      ok: ok,
    });

    card.querySelectorAll(".quiz-choice").forEach((b, i) => {
      b.disabled = true;
      if (i === q.answer_index) b.classList.add("correct");
      else if (i === picked) b.classList.add("wrong");
    });

    const fb = card.querySelector(".quiz-feedback");
    fb.className = "quiz-feedback on " + (ok ? "ok" : "ng");
    fb.innerHTML = '<div class="fb-head"></div><div class="fb-body"></div>';
    fb.querySelector(".fb-head").textContent =
      ok ? d.correct : d.wrong + " " + d.answerWas(q.choices[q.answer_index]);
    fb.querySelector(".fb-body").textContent = q.explanation || "";

    if (quiz.index + 1 < quiz.questions.length) {
      renderQuizActions(card, [
        {
          label: d.next,
          act: () => {
            quiz.index += 1;
            card.querySelector(".quiz-actions").remove();
            renderQuestion();
          },
        },
        { label: d.finish, ghost: true, act: () => finishQuiz(false) },
      ]);
    } else {
      const result = document.createElement("div");
      result.className = "quiz-result";
      result.textContent = d.result(quiz.results.filter((r) => r.ok).length, quiz.results.length);
      card.insertBefore(result, card.querySelector(".quiz-actions"));
      renderQuizActions(card, [
        { label: d.again, act: () => finishQuiz(true) },
        { label: d.finish, ghost: true, act: () => finishQuiz(false) },
      ]);
    }
    scrollBottom();
  }

  /**
   * クイズを終え、成績をまとめて 1 回だけ送る。
   * 1 問ごとに送るとテンポが壊れるため、振り返りは最後にまとめる（ADR-0011）。
   *
   * @param again 続けて次の 5 問を出してもらうか
   */
  function finishQuiz(again) {
    if (!quiz) return;
    const d = t().quiz;
    const results = quiz.results;
    closeQuiz();

    // 1 問も答えずにやめたときは、振り返らせるものがない
    if (results.length === 0) return;

    const correct = results.filter((r) => r.ok).length;
    const text = [
      d.scoreIntro(correct, results.length),
      results.map((r, i) => d.scoreLine(i + 1, r.question, r.picked, r.ok, r.answer)).join("\n"),
      again ? d.scoreAgain : d.scoreEnd,
    ].join("\n");

    // 「おしまい」を選んだのに次のクイズが始まると、終了の操作が意味を失う
    send({ text: text, acceptQuiz: again });
  }

  /* ---------- 送信 ---------- */
  function autoGrow() {
    els.input.style.height = "auto";
    const max = window.innerHeight * 0.3;
    const h = Math.min(els.input.scrollHeight, max);
    els.input.style.height = h + "px";
    els.input.classList.toggle("scrollable", els.input.scrollHeight > max);
    els.send.disabled = !els.input.value.trim() || sending;
  }

  /** 待機中の見出しを差し替える。ツールの進捗が届くたびに呼ばれる */
  function setThinkingLabel(text) {
    els.thinkingLabel.textContent = text;
  }

  /** 進捗イベントをモード別の文言に変換する */
  function progressText(p) {
    const d = t();
    const fn = d.progress && d.progress[p.kind];
    return typeof fn === "function" ? fn(p.target) : d.thinking;
  }

  /**
   * SSE を読み、イベントごとに onEvent を呼ぶ。
   * POST に対する応答なので EventSource は使えず、自前で区切る。
   */
  async function readEventStream(res, onEvent) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });

      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);

        let name = "message";
        let data = "";
        block.split("\n").forEach((line) => {
          if (line.indexOf("event:") === 0) name = line.slice(6).trim();
          else if (line.indexOf("data:") === 0) data += line.slice(5).trim();
        });
        if (!data) continue;
        try {
          onEvent(name, JSON.parse(data));
        } catch (e) {
          /* 壊れた行は捨てる */
        }
      }
    }
  }

  /**
   * @param options.text 入力欄の代わりに送る文字列（クイズの成績など）
   * @param options.acceptQuiz 応答に含まれるクイズを開始するか（既定 true）
   */
  async function send(options) {
    const opts = options || {};
    const fromInput = opts.text === undefined;
    const text = (fromInput ? els.input.value : opts.text).trim();
    if (!text || sending || !currentUser) return;
    const d = t();

    // 空状態の表示が残っていれば消す
    const empty = els.inner.querySelector(".empty");
    if (empty) empty.remove();

    // 別の話が始まったら、答えかけの問題は畳む（押せる問題は最新の 1 問だけ）
    if (fromInput) closeQuiz();

    appendMessage("user", text);
    if (fromInput) {
      els.input.value = "";
      autoGrow();
    }
    scrollBottom();

    sending = true;
    els.send.disabled = true;
    setThinkingLabel(d.thinking);
    els.stop.disabled = false;
    els.thinking.classList.add("on");
    let sec = 0;
    els.elapsed.textContent = d.sec(0);
    timer = setInterval(() => {
      sec += 1;
      els.elapsed.textContent = t().sec(sec);
    }, 1000);

    const controller = new AbortController();
    currentAbort = controller;

    try {
      const body = { user_id: currentUser.user_id, message: text };
      if (currentSessionId) body.session_id = currentSessionId;

      const res = await fetch("/api/web/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const raw = await res.text();
        let msg = "HTTP " + res.status;
        try {
          const j = JSON.parse(raw);
          if (j && j.error) msg = j.error;
        } catch (e) { /* JSON でなければステータスのまま */ }
        throw new Error(msg);
      }

      let data = null;
      let failure = null;

      // サーバーが SSE を返さない構成でも動くようにしておく
      if ((res.headers.get("content-type") || "").indexOf("text/event-stream") >= 0) {
        await readEventStream(res, (name, payload) => {
          if (name === "tool") setThinkingLabel(progressText(payload));
          else if (name === "done") data = payload;
          else if (name === "error") failure = payload && payload.error;
        });
      } else {
        data = await res.json();
      }

      if (failure) throw new Error(failure);
      if (!data) throw new Error(d.errTitle);

      if (data.session_id) currentSessionId = data.session_id;

      const reply = String(data.reply || "");
      const hasQuiz =
        opts.acceptQuiz !== false && Array.isArray(data.quiz) && data.quiz.length > 0;
      // 前置きなしでクイズだけ返ってきたときに、空の吹き出しを出さない
      if (reply.trim() || !hasQuiz) {
        appendMessage("assistant", reply || "（回答がありませんでした）");
      }
      if (hasQuiz) startQuiz(data.quiz);
      scrollBottom();
      await loadSessions();
    } catch (e) {
      // 中止はエラーではない。サーバー側の処理は続くため履歴には残る
      if (e && e.name === "AbortError") toast(t().stopped);
      else appendError(e.message, text);
    } finally {
      clearInterval(timer);
      els.thinking.classList.remove("on");
      currentAbort = null;
      sending = false;
      autoGrow();
    }
  }

  /* ---------- 保護者設定 ---------- */
  let pinBuf = "";
  function renderPin() {
    document.querySelectorAll("#pin-dots i").forEach((el, i) => {
      el.classList.toggle("on", i < pinBuf.length);
    });
  }

  async function submitPin() {
    try {
      const data = await api("/api/parent/verify", {
        method: "POST",
        body: JSON.stringify({ pin: pinBuf }),
      });
      parentToken = data.token;
      $("#pin-dialog").close();
      await openSettings();
    } catch (e) {
      $("#pin-wrap").classList.add("shake");
      setTimeout(() => $("#pin-wrap").classList.remove("shake"), 400);
      pinBuf = "";
      renderPin();
      toast(t().pinNg);
    }
  }

  /**
   * プロンプトはユーザーごとに保存される。
   * 編集途中の内容は promptDrafts に保持し、対象ユーザーを切り替えても失わないようにする。
   * promptOriginals は保存時に「変更されたユーザーだけ」を送るための比較用。
   */
  let promptTargetId = null;
  const promptDrafts = {};
  const promptOriginals = {};

  async function fetchPrompt(userId) {
    if (promptDrafts[userId] !== undefined) return promptDrafts[userId];
    try {
      const p = await api("/api/users/" + encodeURIComponent(userId) + "/prompt");
      const text = p.prompt_text || "";
      promptOriginals[userId] = text;
      promptDrafts[userId] = text;
      return text;
    } catch (e) {
      promptOriginals[userId] = "";
      promptDrafts[userId] = "";
      return "";
    }
  }

  function stashPromptDraft() {
    if (promptTargetId !== null) {
      promptDrafts[promptTargetId] = $("#prompt-textarea").value;
    }
  }

  function renderPromptUserSelect() {
    const sel = $("#prompt-user");
    sel.innerHTML = "";
    users.forEach((u) => {
      const o = document.createElement("option");
      o.value = u.user_id;
      o.textContent = u.display_name;
      sel.appendChild(o);
    });
    sel.value = promptTargetId;
  }

  async function openSettings() {
    // 他の端末で追加されたユーザーも反映されるよう開くたびに取り直す
    try { await loadUsers(); } catch (e) { /* 取得できなければ手元の一覧を使う */ }

    renderModeList();
    syncSeg("#theme-seg", "theme", root.getAttribute("data-theme") || "auto");
    $("#new-pin").value = "";

    // 開くたびに編集状態をリセットし、既定の対象は現在のユーザー
    Object.keys(promptDrafts).forEach((k) => delete promptDrafts[k]);
    Object.keys(promptOriginals).forEach((k) => delete promptOriginals[k]);
    promptTargetId = currentUser.user_id;

    renderPromptUserSelect();
    $("#prompt-textarea").value = await fetchPrompt(promptTargetId);
    $("#settings-dialog").showModal();
  }

  function renderModeList() {
    const wrap = $("#mode-list");
    wrap.innerHTML = "";

    users.forEach((u) => {
      const row = document.createElement("div");
      row.className = "modeRow";
      row.innerHTML =
        '<button type="button" class="avatarBtn" title="アイコンを変更"><img alt=""></button>' +
        '<span class="n"></span>' +
        '<div class="segment">' +
        '<button type="button" data-m="kids">キッズ</button>' +
        '<button type="button" data-m="junior">ジュニア</button>' +
        "</div>" +
        '<button type="button" class="delUserBtn" title="このユーザーを削除">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>' +
        "</button>";
      row.querySelector(".avatarBtn img").src = avatarUrl(u.avatar);
      row.querySelector(".n").textContent = u.display_name;

      row.querySelector(".avatarBtn").addEventListener("click", () => openAvatarPicker(u));

      // 最後の1人は削除できない
      const delBtn = row.querySelector(".delUserBtn");
      delBtn.disabled = users.length <= 1;
      delBtn.addEventListener("click", () => openDeleteUser(u));

      const sync = () => {
        row.querySelectorAll(".segment button").forEach((b) => {
          b.classList.toggle("on", b.dataset.m === u.mode);
        });
      };
      sync();

      row.querySelectorAll(".segment button").forEach((b) => {
        b.addEventListener("click", async () => {
          const prev = u.mode;
          u.mode = b.dataset.m;
          sync();
          try {
            await api("/api/users/" + encodeURIComponent(u.user_id), {
              method: "PATCH",
              body: JSON.stringify({ mode: u.mode }),
            });
            if (currentUser && u.user_id === currentUser.user_id) {
              currentUser.mode = u.mode;
              applyMode();
              renderList();
              await selectSession(currentSessionId);
            }
          } catch (e) {
            u.mode = prev;
            sync();
            toast(e.message);
          }
        });
      });

      wrap.appendChild(row);
    });
  }

  /** アイコン選択。アバターは見た目だけなので PIN なしで変更できる */
  function openAvatarPicker(u) {
    const dlg = $("#avatar-dialog");
    const grid = $("#avatar-grid");
    grid.innerHTML = "";

    AVATARS.forEach((key) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = key === u.avatar ? "sel" : "";
      b.innerHTML = '<img alt="">';
      b.querySelector("img").src = avatarUrl(key);
      b.addEventListener("click", async () => {
        dlg.close();
        const prev = u.avatar;
        u.avatar = key;
        try {
          await api("/api/users/" + encodeURIComponent(u.user_id), {
            method: "PATCH",
            body: JSON.stringify({ avatar: key }),
          });
          if (currentUser && u.user_id === currentUser.user_id) {
            currentUser.avatar = key;
            renderUserChip();
            await selectSession(currentSessionId);
          }
          // 開いている画面を再描画して新しいアイコンを反映する
          if ($("#settings-dialog").open) renderModeList();
          if ($("#user-dialog").open) {
            renderUserGrid();
            $("#self-avatar-img").src = avatarUrl(currentUser && currentUser.avatar);
          }
          toast(t().saved);
        } catch (e) {
          u.avatar = prev;
          toast(e.message);
        }
      });
      grid.appendChild(b);
    });
    dlg.showModal();
  }

  /** ユーザー削除（会話履歴もまとめて消える） */
  function openDeleteUser(u) {
    const d = t();
    const dlg = $("#deluser-dialog");
    $("#deluser-target").textContent = "「" + u.display_name + "」";
    dlg.showModal();

    $("#deluser-ok").onclick = async () => {
      dlg.close();
      try {
        await api("/api/users/" + encodeURIComponent(u.user_id), { method: "DELETE" });
        const wasCurrent = currentUser && currentUser.user_id === u.user_id;
        await loadUsers();

        if (wasCurrent) {
          // 使用中のユーザーを消したら別のユーザーへ切り替える
          currentUser = users[0] || null;
          if (currentUser) {
            storeUserId(currentUser.user_id);
            applyMode();
            renderUserChip();
            currentSessionId = null;
            await loadSessions();
            selectSession(null);
          }
        }

        // 削除したユーザーの編集内容は破棄し、対象が消えていたら選び直す
        delete promptDrafts[u.user_id];
        delete promptOriginals[u.user_id];
        if (promptTargetId === u.user_id) {
          promptTargetId = currentUser ? currentUser.user_id : (users[0] && users[0].user_id);
          $("#prompt-textarea").value = await fetchPrompt(promptTargetId);
        }

        renderModeList();
        renderPromptUserSelect();
        toast(u.display_name + " を " + d.deleted);
      } catch (e) {
        toast(e.message);
      }
    };
  }

  function syncSeg(sel, key, val) {
    document.querySelectorAll(sel + " button").forEach((x) => {
      x.classList.toggle("on", x.dataset[key] === val);
    });
  }

  /* ---------- 初期化 ---------- */
  function bindEvents() {
    document.querySelectorAll("[data-close]").forEach((b) => {
      b.addEventListener("click", () => b.closest("dialog").close());
    });

    $("#menu-btn").addEventListener("click", () => {
      els.sidebar.classList.add("open");
      els.scrim.classList.add("show");
    });
    els.scrim.addEventListener("click", closeDrawer);

    els.stop.addEventListener("click", () => {
      if (!currentAbort) return;
      els.stop.disabled = true;
      currentAbort.abort();
    });

    $("#new-chat-btn").addEventListener("click", () => {
      currentSessionId = null;
      selectSession(null);
      closeDrawer();
      els.input.focus();
    });

    $("#user-chip").addEventListener("click", () => {
      renderUserGrid();
      $("#self-avatar-img").src = avatarUrl(currentUser && currentUser.avatar);
      $("#user-dialog").showModal();
    });

    // 自分のアイコン変更は PIN 不要（見た目だけの設定のため）
    $("#self-avatar-btn").addEventListener("click", () => {
      if (currentUser) openAvatarPicker(currentUser);
    });

    $("#fontsize-seg").querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => {
        root.setAttribute("data-fontsize", b.dataset.size);
        try { localStorage.setItem("ai-rotom-fontsize", b.dataset.size); } catch (e) { /* ignore */ }
        syncSeg("#fontsize-seg", "size", b.dataset.size);
      });
    });

    $("#settings-btn").addEventListener("click", () => {
      pinBuf = "";
      renderPin();
      $("#pin-dialog").showModal();
    });

    $("#keypad").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const act = b.dataset.act;
      if (act === "clear") pinBuf = "";
      else if (act === "back") pinBuf = pinBuf.slice(0, -1);
      else if (pinBuf.length < 4) pinBuf += b.textContent.trim();
      renderPin();
      if (pinBuf.length === 4) setTimeout(submitPin, 120);
    });

    $("#theme-seg").querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => {
        const v = b.dataset.theme;
        if (v === "auto") root.removeAttribute("data-theme");
        else root.setAttribute("data-theme", v);
        try { localStorage.setItem("ai-rotom-theme", v); } catch (e) { /* ignore */ }
        syncSeg("#theme-seg", "theme", v);
      });
    });

    // 編集対象ユーザーの切り替え（編集途中の内容は保持する）
    $("#prompt-user").addEventListener("change", async (e) => {
      stashPromptDraft();
      promptTargetId = e.target.value;
      $("#prompt-textarea").value = await fetchPrompt(promptTargetId);
    });

    $("#prompt-save").addEventListener("click", async () => {
      stashPromptDraft();

      // 変更のあったユーザーだけ保存する
      const changed = Object.keys(promptDrafts).filter(
        (id) => promptDrafts[id] !== promptOriginals[id],
      );

      if (!changed.length) {
        $("#settings-dialog").close();
        return;
      }

      try {
        for (const id of changed) {
          await api("/api/users/" + encodeURIComponent(id) + "/prompt", {
            method: "PUT",
            body: JSON.stringify({ prompt_text: promptDrafts[id] }),
          });
          promptOriginals[id] = promptDrafts[id];
        }
        $("#settings-dialog").close();
        const names = changed.map((id) => {
          const u = users.find((x) => x.user_id === id);
          return u ? u.display_name : id;
        });
        toast(names.join("・") + " の " + t().saved);
      } catch (e) {
        toast(e.message);
      }
    });

    $("#pin-save").addEventListener("click", async () => {
      const v = $("#new-pin").value.trim();
      if (!/^\d{4}$/.test(v)) {
        toast(t().pinNg);
        return;
      }
      try {
        await api("/api/parent/pin", { method: "PUT", body: JSON.stringify({ pin: v }) });
        $("#new-pin").value = "";
        toast(t().saved);
      } catch (e) {
        toast(e.message);
      }
    });

    els.input.addEventListener("input", autoGrow);
    els.input.addEventListener("keydown", (e) => {
      // スマホ・タブレットでは Enter はそのまま改行させる
      if (isSoftKeyboard) return;
      if (e.key !== "Enter" || e.shiftKey) return;
      // IME 変換中の確定 Enter を送信と誤認しない（keyCode 229 は Safari 等の保険）
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      send();
    });
    $("#composer").addEventListener("submit", (e) => {
      e.preventDefault();
      send();
    });
  }

  function restorePrefs() {
    try {
      const fs = localStorage.getItem("ai-rotom-fontsize");
      if (fs) root.setAttribute("data-fontsize", fs);
      syncSeg("#fontsize-seg", "size", fs || "normal");

      const th = localStorage.getItem("ai-rotom-theme");
      if (th && th !== "auto") root.setAttribute("data-theme", th);
    } catch (e) { /* ignore */ }
  }

  async function init() {
    bindEvents();
    restorePrefs();

    try {
      await loadUsers();
    } catch (e) {
      toast("サーバーに接続できませんでした");
      return;
    }

    // 初回起動時はユーザーが存在しないので既定の1人を作る
    if (!users.length) {
      try {
        await api("/api/users", {
          method: "POST",
          body: JSON.stringify({ user_id: "ゲスト", display_name: "ゲスト", mode: "kids" }),
        });
        await loadUsers();
      } catch (e) { /* ignore */ }
    }

    const saved = storedUserId();
    currentUser = users.find((u) => u.user_id === saved) || users[0] || null;
    if (currentUser) storeUserId(currentUser.user_id);

    applyMode();
    renderUserChip();
    await loadSessions();
    selectSession(null);
    autoGrow();
  }

  init().catch((e) => console.error("初期化エラー:", e));
})();
