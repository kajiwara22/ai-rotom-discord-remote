/**
 * 構築メモビューア。
 *
 * URL は `#/<docs からの相対パス>`、節の指定は `?h=s3`（h2 の出現順）。
 * 目次データ（/docs/_toc.json）の見出し ID と、本文描画時に振る ID は
 * どちらも「h2 の出現順」なので必ず一致する。
 */
(() => {
  "use strict";

  const STORE_KEY = "rotom-docs-settings";
  const THEMES = ["auto", "light", "dark"];
  const FONT_SIZES = ["m", "l", "s"];

  /** 「すぐ見る」に出す見出しのパターン。対戦中に引く節を目次先頭へ上げる */
  const QUICK_PATTERN = /(選出|チェックリスト|禁止対面)/;

  const GROUP_LABELS = { concepts: "構築メモ", adr: "設計判断（ADR）" };

  const els = {
    tocPane: document.getElementById("toc-pane"),
    docPane: document.getElementById("doc-pane"),
    content: document.getElementById("content"),
    quick: document.getElementById("quick"),
    quickList: document.getElementById("quick-list"),
    docList: document.getElementById("doc-list"),
    barTitle: document.getElementById("bar-title"),
    homeBtn: document.getElementById("home-btn"),
    fontBtn: document.getElementById("font-btn"),
    themeBtn: document.getElementById("theme-btn"),
    loading: document.getElementById("loading"),
  };

  let toc = null;
  let currentPath = null;

  /* ---------- 設定（文字サイズ・テーマ） ---------- */

  function loadSettings() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    } catch {
      saved = {};
    }
    return {
      font: FONT_SIZES.includes(saved.font) ? saved.font : "m",
      theme: THEMES.includes(saved.theme) ? saved.theme : "auto",
    };
  }

  const settings = loadSettings();

  function saveSettings() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(settings));
    } catch {
      /* プライベートブラウズ等では保存できない。表示だけ変える */
    }
  }

  function applySettings() {
    document.documentElement.dataset.fontsize = settings.font;
    if (settings.theme === "auto") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = settings.theme;
    }
    els.fontBtn.textContent = settings.font === "s" ? "A" : settings.font === "l" ? "A+" : "Aa";
    els.themeBtn.title = settings.theme === "auto" ? "テーマ: 自動" : settings.theme === "light" ? "テーマ: ライト" : "テーマ: ダーク";
  }

  els.fontBtn.addEventListener("click", () => {
    const i = FONT_SIZES.indexOf(settings.font);
    settings.font = FONT_SIZES[(i + 1) % FONT_SIZES.length];
    applySettings();
    saveSettings();
  });

  els.themeBtn.addEventListener("click", () => {
    const i = THEMES.indexOf(settings.theme);
    settings.theme = THEMES[(i + 1) % THEMES.length];
    applySettings();
    saveSettings();
  });

  /* ---------- 目次 ---------- */

  function make(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function headingHref(path, id) {
    return "#/" + encodeURI(path) + "?h=" + encodeURIComponent(id);
  }

  function renderQuick(data) {
    els.quickList.replaceChildren();
    let count = 0;

    for (const group of data.groups) {
      if (group.group !== "concepts") continue;
      for (const doc of group.docs) {
        for (const heading of doc.headings) {
          if (!QUICK_PATTERN.test(heading.text)) continue;
          const a = document.createElement("a");
          a.className = "quick-link";
          a.href = headingHref(doc.path, heading.id);

          const docLabel = make("span", "ql-doc", doc.title);
          docLabel.title = doc.title;
          a.append(docLabel, make("span", "ql-head", heading.text));
          els.quickList.appendChild(a);
          count += 1;
        }
      }
    }

    els.quick.hidden = count === 0;
  }

  function renderDocList(data) {
    els.docList.replaceChildren();

    for (const group of data.groups) {
      if (group.docs.length === 0) continue;

      // ADR は件数が多く、対戦中に引くのは concepts 側なので既定で閉じる
      const section = document.createElement("details");
      section.className = "group";
      section.open = group.group === "concepts";
      section.appendChild(make("summary", "", GROUP_LABELS[group.group] || group.group));

      for (const doc of group.docs) {
        const details = document.createElement("details");
        details.className = "doc-card";

        const summary = document.createElement("summary");
        summary.appendChild(make("span", "d-title", doc.title));
        summary.appendChild(
          make("span", "d-meta", `${doc.updated} ・ 見出し ${doc.headings.length} 件`),
        );
        details.appendChild(summary);

        const heads = make("div", "d-heads");

        const top = document.createElement("a");
        top.href = "#/" + encodeURI(doc.path);
        top.append(make("span", "n", ""), make("span", "", "先頭から読む"));
        heads.appendChild(top);

        doc.headings.forEach((heading, i) => {
          const a = document.createElement("a");
          a.href = headingHref(doc.path, heading.id);
          a.append(make("span", "n", String(i + 1)), make("span", "", heading.text));
          heads.appendChild(a);
        });

        details.appendChild(heads);
        section.appendChild(details);
      }

      els.docList.appendChild(section);
    }
  }

  async function loadToc() {
    const res = await fetch("/docs/_toc.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("目次を取得できませんでした");
    return res.json();
  }

  /* ---------- ルーティング ---------- */

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, "");
    if (!raw) return null;

    const queryAt = raw.indexOf("?");
    const pathPart = queryAt === -1 ? raw : raw.slice(0, queryAt);
    const params = new URLSearchParams(queryAt === -1 ? "" : raw.slice(queryAt + 1));

    let path;
    try {
      path = decodeURIComponent(pathPart);
    } catch {
      return null;
    }
    if (!path) return null;

    return { path, heading: params.get("h") };
  }

  function showToc() {
    currentPath = null;
    els.docPane.hidden = true;
    els.tocPane.hidden = false;
    els.barTitle.textContent = "構築メモ";
    document.title = "構築メモ";
    window.scrollTo(0, 0);
  }

  function scrollToHeading(id) {
    if (!id) {
      window.scrollTo(0, 0);
      return;
    }
    const target = document.getElementById(id);
    if (target) target.scrollIntoView({ block: "start" });
  }

  /* ---------- Markdown 描画 ---------- */

  function renderMarkdown(src) {
    // 生 HTML を実行させない。既存 Web UI（app.js）と同じ扱いにそろえる
    const safe = String(src || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return window.marked ? window.marked.parse(safe) : safe;
  }

  /** 相対リンク（../adr/ADR-0023.md など）をビューア内のルートへ寄せる */
  function rewriteLinks(container, docPath) {
    const baseDir = docPath.includes("/") ? docPath.slice(0, docPath.lastIndexOf("/") + 1) : "";

    container.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return;
      if (!/\.md(?:[?#].*)?$/i.test(href)) return;

      let resolved;
      try {
        resolved = new URL(href, "http://docs.local/" + baseDir);
      } catch {
        return;
      }
      a.setAttribute("href", "#/" + encodeURI(resolved.pathname.replace(/^\/+/, "")));
    });
  }

  function decorate(container, docPath) {
    container.querySelectorAll("h2").forEach((h, i) => {
      h.id = `s${i + 1}`;
    });

    container.querySelectorAll("table").forEach((table) => {
      if (table.parentElement && table.parentElement.classList.contains("tablewrap")) return;
      const wrap = make("div", "tablewrap");
      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
    });

    rewriteLinks(container, docPath);
  }

  async function openDoc(path, heading) {
    // 同じ文書内で節だけ移動する場合は再取得しない
    if (currentPath === path && !els.docPane.hidden) {
      scrollToHeading(heading);
      return;
    }

    currentPath = path;
    els.loading.hidden = false;

    try {
      const res = await fetch("/docs/md/" + encodeURI(path), { cache: "no-cache" });
      if (!res.ok) throw new Error(`本文を取得できませんでした（${res.status}）`);
      const md = await res.text();

      els.content.innerHTML = renderMarkdown(md);
      decorate(els.content, path);

      const title = els.content.querySelector("h1");
      const label = title ? title.textContent.trim() : path;
      els.barTitle.textContent = label;
      document.title = label;

      els.tocPane.hidden = true;
      els.docPane.hidden = false;

      // レイアウト確定後にスクロールする（フォント読み込みで行位置がずれるため）
      requestAnimationFrame(() => requestAnimationFrame(() => scrollToHeading(heading)));
    } catch (error) {
      els.content.replaceChildren(make("p", "error", String(error.message || error)));
      els.tocPane.hidden = true;
      els.docPane.hidden = false;
      els.barTitle.textContent = "読み込みエラー";
      window.scrollTo(0, 0);
    } finally {
      els.loading.hidden = true;
    }
  }

  async function route() {
    const target = parseHash();
    if (!target) {
      showToc();
      return;
    }

    if (!toc) {
      try {
        toc = await loadToc();
      } catch {
        toc = null;
      }
    }
    await openDoc(target.path, target.heading);
  }

  els.homeBtn.addEventListener("click", () => {
    if (location.hash) {
      location.hash = "";
    } else {
      showToc();
    }
  });

  window.addEventListener("hashchange", route);

  /* ---------- 起動 ---------- */

  applySettings();

  (async () => {
    try {
      toc = await loadToc();
      renderQuick(toc);
      renderDocList(toc);
    } catch (error) {
      els.docList.replaceChildren(make("p", "error", String(error.message || error)));
    }
    await route();
  })();
})();
