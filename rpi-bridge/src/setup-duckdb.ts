/**
 * DuckDB のセットアップ。Raspberry Pi の準備時に一度だけ実行する。
 *
 * httpfs 拡張を導入し、R2 の対戦記録に到達できることを確認する。
 * サーバー起動時に `INSTALL` を走らせない（実行時は `LOAD` のみ）のは、
 * ネットワークが不調な再起動でサーバー全体の起動が拡張のダウンロードに
 * 引きずられるのを避けるため。詳しい経緯は docs/adr/ADR-0010.md を参照。
 *
 *   pnpm setup:duckdb
 */
import "./log-timestamp.js";
import { DuckDBInstance } from "@duckdb/node-api";
import { countMatches, closeMatchRepository } from "./match-repository.js";

async function main(): Promise<void> {
  console.log("httpfs 拡張をインストールしています...");
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  await connection.run("INSTALL httpfs");
  connection.closeSync();
  console.log("httpfs 拡張をインストールしました");

  console.log("R2 の対戦記録に接続しています...");
  const count = await countMatches();
  console.log(`接続できました。対戦記録は ${count} 件です`);

  await closeMatchRepository();
}

main().catch((error: unknown) => {
  console.error("セットアップに失敗しました:", error);
  console.error(
    "R2_ENDPOINT_URL / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY が設定されているか確認してください",
  );
  process.exit(1);
});
