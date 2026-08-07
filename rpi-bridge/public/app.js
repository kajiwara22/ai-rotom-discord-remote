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
      sec: (n) => n + "びょう",
      speak: "よみあげ", copy: "コピー",
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
      sec: (n) => n + "秒",
      speak: "読み上げ", copy: "コピー",
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
    input: $("#input"), send: $("#send-btn"),
  };

  let users = [];
  let currentUser = null;
  let sessions = [];
  let currentSessionId = null;
  let sending = false;
  let parentToken = null;
  let timer = null;

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
    if (role === "assistant") bubble.innerHTML = renderMarkdown(content);
    else bubble.textContent = content;

    if (role === "assistant") {
      const acts = document.createElement("div");
      acts.className = "msg-actions";
      acts.innerHTML =
        '<button type="button" data-a="speak">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg><span></span></button>' +
        '<button type="button" data-a="copy">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg><span></span></button>';
      acts.querySelectorAll("span")[0].textContent = d.speak;
      acts.querySelectorAll("span")[1].textContent = d.copy;

      acts.querySelector('[data-a="speak"]').addEventListener("click", () => speak(bubble.innerText));
      acts.querySelector('[data-a="copy"]').addEventListener("click", () => {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(content).then(() => toast(t().copied));
        }
      });
      el.querySelector(".col").appendChild(acts);
    }

    els.inner.appendChild(el);
  }

  function speak(text) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
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

  /* ---------- 送信 ---------- */
  function autoGrow() {
    els.input.style.height = "auto";
    const max = window.innerHeight * 0.3;
    const h = Math.min(els.input.scrollHeight, max);
    els.input.style.height = h + "px";
    els.input.classList.toggle("scrollable", els.input.scrollHeight > max);
    els.send.disabled = !els.input.value.trim() || sending;
  }

  async function send() {
    const text = els.input.value.trim();
    if (!text || sending || !currentUser) return;
    const d = t();

    // 空状態の表示が残っていれば消す
    const empty = els.inner.querySelector(".empty");
    if (empty) empty.remove();

    appendMessage("user", text);
    els.input.value = "";
    autoGrow();
    scrollBottom();

    sending = true;
    els.send.disabled = true;
    els.thinking.classList.add("on");
    let sec = 0;
    els.elapsed.textContent = d.sec(0);
    timer = setInterval(() => {
      sec += 1;
      els.elapsed.textContent = t().sec(sec);
    }, 1000);

    try {
      const body = { user_id: currentUser.user_id, message: text };
      if (currentSessionId) body.session_id = currentSessionId;

      const data = await api("/api/web/ask", {
        method: "POST",
        body: JSON.stringify(body),
      });

      if (data.session_id) currentSessionId = data.session_id;
      appendMessage("assistant", data.reply || "（回答がありませんでした）");
      scrollBottom();
      await loadSessions();
    } catch (e) {
      appendError(e.message, text);
    } finally {
      clearInterval(timer);
      els.thinking.classList.remove("on");
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
