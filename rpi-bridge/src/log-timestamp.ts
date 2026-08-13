/**
 * すべてのログ行の先頭に時刻を付ける。
 *
 * ログは byobu のペインと tee したファイルに流すだけで、journald のように
 * 外側で時刻を付けてくれる仕組みがない。行そのものに時刻がないと、いつ・
 * どれくらいの間隔で起きたのかを後から追えないため、ここで面倒を見る。
 *
 * 読み込むだけで効く副作用モジュール。index.ts の先頭で import すること。
 */

function timestamp(): string {
  const d = new Date();
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  );
}

for (const level of ["log", "warn", "error"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => original(`[${timestamp()}]`, ...args);
}
