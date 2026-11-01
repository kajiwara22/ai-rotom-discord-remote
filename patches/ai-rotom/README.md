# ai-rotom ローカルパッチ

上流 [nonz250/ai-rotom](https://github.com/nonz250/ai-rotom) に当てているローカル差分です。
**上流へ PR は出さない**方針のため、差分の正はこのディレクトリに置きます（[ADR-0027](../../docs/adr/ADR-0027.md)）。

rpi-bridge は `AI_ROTOM_ARGS` で `~/ai-rotom/packages/mcp-server/dist/index.mjs` を直接起動しており、
このパッチを当てたビルドが前提です。

## 基準

- 基準コミット: `4172a07`（origin/main、1.3.5 以降、2026-10-27 時点）
- 適用順: ファイル名の昇順（`0001` → `0002`）
- パッチは `git format-patch` の形式（`git am` で適用）

## パッチ一覧

| ファイル | 内容 |
|---|---|
| `0001-name-resolver-bare-form-alias.patch` | フォルム付き種（例: `ギルガルド(シールドフォルム)`）を素名 `ギルガルド` でも解決できるようにする。rpi-bridge の AI が日本語の素名でツールを呼ぶため |
| `0002-migrate-to-pnpm.patch` | npm から pnpm 管理へ移行。pnpm の隔離 node_modules では `shared/` から `@smogon/calc` / `zod` を解決できないため、root の devDependencies に追加している |

## 再現

```bash
mise exec -- ./scripts/setup-ai-rotom.sh
```

`AI_ROTOM_DIR`（既定 `~/ai-rotom`）が既に存在すると失敗します。作り直すときは削除してから実行してください。

## 上流に追従する

```bash
cd ~/ai-rotom
git fetch origin
git rebase origin/main          # 衝突を解消する
mise exec -- pnpm install
mise exec -- pnpm test          # 下記「既知の失敗」を除いて通ること
mise exec -- pnpm build

# パッチを作り直す
git format-patch origin/main..local/rpi-bridge -o ~/ai-rotom-discord-remote/patches/ai-rotom
```

作り直したら、ファイル名を `0001-...` の連番にリネームし、新しい基準コミットを
`scripts/setup-ai-rotom.sh` の `BASE_REF` に反映してください。

`package.json` と `pnpm-lock.yaml` は上流の変更と衝突しやすいので、rebase のたびに
`pnpm install` で lock を更新します。

## 既知の失敗

`packages/mcp-server/src/tools/analysis/find-counters.test.ts` の
「弱点タイプ攻撃技を覚える候補が 10 件を超える target では counters が 10 件を超える」は
Raspberry Pi 上でテスト側の 60 秒タイムアウトを超えます（2026-10-27 時点）。
パッチとは無関係の性能問題で、他の 763 テストは通ります。
