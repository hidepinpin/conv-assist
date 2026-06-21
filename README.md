# Conv Assist EN→JA (Even G2 / Even Hub)

相手の英語を聞き取り、グラスに「英語原文 / 日本語訳 / 返答候補(英語)」を3段表示する会話支援アプリ。

## 画面レイアウト (576×288)
```
┌──────────────────────────────┐
│ EN ●: What time does the...  │  ← 聞き取った英語(リアルタイム)
│ JA: 何時に店が開きますか?     │  ← 日本語訳
│ Reply: It opens at nine.     │  ← 返答候補(英語)
└──────────────────────────────┘
```
グラスのタップで聞き取り開始/停止。

## セットアップ
```bash
npm install
npm run dev          # http://localhost:5173
```

### シミュレータで動作確認
```bash
npm i -g @evenrealities/evenhub-cli evenhub-simulator   # 未導入なら
evenhub-simulator http://localhost:5173
```
マイク入力が必要なので、even-dev環境なら AUDIO_DEVICE 指定でシミュレータに音声を流せます。

### 実機で動作確認 (QRサイドロード)
```bash
evenhub qr --url "http://<あなたのPCのLAN IP>:5173"
```
Even RealitiesアプリでQRを読み込むとグラスにロードされます(ホットリロード対応)。

## 使い方
1. スマホ側に表示される設定画面で OpenAI API キーを保存
2. グラスをタップ → 聞き取り開始(EN行に ● が付く)
3. 相手が話し終わると(無音600msで区切り)、日本語訳と返答候補が表示される
4. もう一度タップで停止

## Even Hub へのデプロイ
```bash
npm run build
evenhub pack app.json dist -o conv-assist.ehpk -c   # -c でpackage_idの空き確認
```
生成された `.ehpk` を Even Hub 開発者ポータル (hub.evenrealities.com) からアップロード・申請。

## 要確認ポイント
- **タップイベントのenum**: main.ts では textEvent 受信をタップとして扱っています。
  実際のイベント種別は `node_modules/@evenrealities/even_hub_sdk` の型定義か、
  シミュレータのコンソールログで確認し、必要なら条件を絞ってください。
- **日本語グリフ**: G2のファームウェアフォントは対応外文字を無表示にします。
  日本語表示は公式のライブ翻訳機能で使われているため対応していますが、
  シミュレータ/実機で漢字の表示を一度確認してください。
- **app.json の package_id**: `com.pinpin.convassist` は仮です。自分のIDに変更を。
- **APIキーの扱い**: キーはユーザーがスマホ側UIで入力し localStorage に保存します。
  ストア配布時はコードにキーを埋め込まないこと(審査・セキュリティ両面でNG)。

## ハーネス (検証ゲート)
`npm run build` の前段に自動実行されます。個別実行も可能:
```bash
npm run verify              # 全チェック
npm run verify:manifest     # app.json をEven Hub packルールで検証
npm run verify:test         # ヘルパー関数のユニットテスト (node --test)
npm run verify:security     # 静的セキュリティスキャン (CRITICAL/HIGHでビルド失敗)
```
スキャン項目: ハードコードされたAPIキー / eval・innerHTML等の危険API /
非TLSエンドポイント / app.jsonのnetwork whitelistにない外部通信 / キーのログ出力 / CSP有無
