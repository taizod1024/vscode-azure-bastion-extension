# VS Code Azure Bastion 拡張機能 - 開発ガイド

## プロジェクト概要

このVS Code拡張機能は、Azure Bastionを通してSSHトンネルをVS Code内から簡単に作成できます。

## 最近の開発活動

### README.mdドキュメント (2026年3月)

1. **Usageセクションの改善**: 英語文法の修正と改善
   - 非公式な指示を正しい英語に変換
   - Azure CLIコマンドを明確に記載（例：`az extension add --name ssh`）
   - 各ステップをより分かりやすく説明

2. **開発状況インジケータの追加**: メインタイトルに「(Work In Progress)」を追加
   - プロジェクトがまだ開発途中であることを示す
   - ユーザーが大きな変更の可能性があることを理解できるように

## 主要ファイル

- `src/extension.ts` - 拡張機能のメインエントリーポイント
- `src/AzureBastion.ts` - トンネル機能の中核実装
- `bin/Invoke-AZNetwork.ps1` - Azure Network実行用PowerShellスクリプト
- `README.md` - ユーザー向けドキュメント

## 今後の開発ガイドライン

- README.mdのドキュメントは常に正しく、プロフェッショナルな英語で保つ
- 安定版リリースまで「(Work In Progress)」インジケータを保持する
- コミット前にすべての使用手順をテストする
- 新機能や設定オプションは必ずドキュメント化する
