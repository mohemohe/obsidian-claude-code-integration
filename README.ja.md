# Claude Code Obsidian Integration

[Claude Code](https://docs.anthropic.com/ja/docs/claude-code/overview) AIコーディングエージェントをObsidianのvaultに統合します。

> [!NOTE]
> これはサードパーティーのコミュニティプラグインであり、Obsidianと提携、承認、または公式にサポートされているものではありません。このプラグインは独立して開発・保守されています。

## 機能

- **AI搭載コーディングアシスタント**: Obsidian内でClaude Codeに直接アクセスし、インテリジェントなコード提案、説明、デバッグのヘルプを受けられます
- **シームレスな統合**: アプリケーションを切り替えることなく、Obsidianのワークフロー内で自然に動作します
- **Reactベースの UI**: スムーズなユーザー体験のために React で構築されたモダンでレスポンシブなインターフェース

## セキュリティとプライバシー

> [!IMPORTANT]
> このプラグインが適切に機能するには、特定の権限が必要です：

### ファイルシステムアクセス
このプラグインはClaude Codeを起動して通信するため、Obsidianのvault外のファイルへのアクセスが必要です。これは以下の理由で必要です：
- Claude Codeは開発プロジェクト内のコードファイルを読み書きする必要があります
- AIアシスタントは正確な提案を提供するために、コードベースからのコンテキストが必要です
- ファイル操作（作成、編集、削除）は、Claude Codeへの指示に基づいて実行されます

### ローカルMCPサーバー
このプラグインは、以下のためにローカルのModel Context Protocol（MCP）サーバーを起動します：
- **権限の管理**: Claude Codeからのファイルアクセスリクエストを傍受して制御します
- **セキュリティの提供**: 各ファイル操作を実行する前に承認または拒否できるようにします
- **透明性の確保**: Claude Codeが何にアクセスしようとしているかを正確に表示します

書き込み、削除、その他ツール操作は権限ダイアログを通じてあなたの明示的な承認を必要とし、Claude Codeが変更できるものをコントロールできるようにします。

> [!CAUTION]
> Claude Codeは破壊的な操作を行うことがあります。バックアップを取り、[Claude Code Hooks](https://docs.anthropic.com/en/docs/claude-code/hooks)を活用するなど、ベストプラクティスに沿って利用してください。

## インストール

> [!IMPORTANT]
> このプラグインは公式のClaude Codeを別途インストールする必要があります。このプラグインはObsidianとClaude Code間の統合レイヤーとして機能します。

### Obsidianコミュニティプラグインから（推奨）

// TODO:

### 手動インストール

1. [GitHubリリースページ](https://github.com/mohemohe/obsidian-claude-code-integration/releases)から最新のリリースをダウンロードします
2. ファイルをvaultの`.obsidian/plugins/`フォルダに展開します
3. Obsidianをリロードします
4. 設定 → コミュニティプラグインでプラグインを有効にします

## 使い方

1. プラグインを有効にした後、以下の方法でClaude Codeにアクセスできます：
   - 左サイドバーのリボンアイコン
   - コマンドパレット: `Claude Code Obsidian Integration: Open Claude Code`
   
2. プラグイン設定を構成します：
   - Claude Codeインストールパス（デフォルトの場所にない場合）
   - Node.js PATH（必要な場合）
   - その他のプラグイン固有の設定
   
3. Obsidianのvault内で直接AIアシスタンスを使ってコーディングを開始できます！

注意: API設定はプラグイン設定ではなく、Claude Code（CLI）自体で管理されます。

## 要件

- Obsidian v0.15.0以降
- デスクトップのみ（技術的制限によりモバイルでは使用不可）
- AI機能にはアクティブなインターネット接続が必要

## 開発

このプラグインは以下を使用して構築されています：
- TypeScript
- React 18
- Obsidian Plugin API
- @anthropic-ai/claude-code SDK
- Model Context Protocol (MCP)

### ソースからのビルド

```bash
# リポジトリをクローン
git clone https://github.com/mohemohe/obsidian-claude-code-integration.git

# 依存関係をインストール
npm install

# プラグインをビルド
npm run build

```

## サポート

- **問題**: バグや機能リクエストは[GitHub Issuesページ](https://github.com/mohemohe/obsidian-claude-code-integration/issues)で報告してください

## ライセンス

このプロジェクトはMITライセンスの下でライセンスされています - 詳細は[LICENSE](LICENSE)ファイルを参照してください。
