// 拡張機能の状態
let isEnabled = false;
let apiKeySet = false;
let observer = null;

// 翻訳済みコメントを追跡するMap
const translatedComments = new Map();

// チャットコンテナを検索
function findChatContainer() {
  // デバッグ情報を出力
  console.log("Twitchチャットコンテナを検索中...");

  // 指定されたセレクタのみを使用
  const chatContainer = document.querySelector(
    '[data-test-selector="chat-scrollable-area__message-container"]'
  );

  if (chatContainer) {
    // コンテナが見つかったら監視を開始
    console.log("チャットコンテナを検出しました。監視を開始します。");
    observeChatMessages(chatContainer);
    return true;
  } else {
    // コンテナが見つからない場合はログを出力
    console.log("Twitchチャットコンテナが見つかりません。後ほど再試行します。");

    // 1秒後に再試行
    setTimeout(findChatContainer, 1000);
    return false;
  }
}

// ページ内のメッセージを直接検索して処理する関数
function findAndProcessMessages() {
  // より包括的なセレクタのリスト
  const messageSelectors = [
    // Twitch公式要素
    ".chat-line__message",
    ".chat-line__message-container",
    ".chat-line",
    '[data-a-target="chat-line-message"]',
    '[data-test-selector="chat-line-message"]',

    // メッセージテキスト要素
    '[data-a-target="chat-text-message"]',
    '.text-fragment[data-a-target="chat-message-text"]',
    ".chat-message",
    ".text-token",

    // SevenTV関連
    ".seventv-chat-message-body",
    ".seventv-chat-message",
    "[data-v-43cb0e29]",
  ];

  let foundMessages = [];

  // 各セレクタで検索
  for (const selector of messageSelectors) {
    try {
      const messages = document.querySelectorAll(selector);
      if (messages.length > 0) {
        console.log(
          `${selector} セレクタで ${messages.length} 個のメッセージを検出`
        );
        foundMessages = foundMessages.concat(Array.from(messages));
      }
    } catch (error) {
      console.log(`セレクタ ${selector} の検索中にエラーが発生:`, error);
    }
  }

  // 重複を削除
  const uniqueMessages = [...new Set(foundMessages)];

  if (uniqueMessages.length > 0) {
    console.log(
      `合計 ${uniqueMessages.length} 個のメッセージを直接検出しました。処理を開始します。`
    );

    // メッセージごとに処理し翻訳を試みる
    uniqueMessages.forEach((message) => {
      processChatMessage(message);
    });

    // 継続的な監視のためにdirectObserve関数を開始
    startDirectObserving();

    return true;
  }

  return false;
}

// メッセージの直接監視（コンテナを特定できない場合の代替手段）
function startDirectObserving() {
  console.log("メッセージの直接監視を開始します");

  // すでに監視中なら何もしない
  if (observer) {
    return;
  }

  // チャットメッセージの可能性がある要素を監視する対象を決定
  // チャット関連の親要素を見つける
  const potentialContainers = [
    document.querySelector(".chat-room__content"),
    document.querySelector(".right-column__wrapper"),
    document.querySelector(".stream-chat"),
    document.querySelector(".chat-list"),
    document.body, // 最終手段
  ];

  const container =
    potentialContainers.find((el) => el !== null) || document.body;

  // MutationObserverの設定
  observer = new MutationObserver((mutations) => {
    let newNodes = [];

    mutations.forEach((mutation) => {
      if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            newNodes.push(node);

            // 追加された要素内の潜在的なメッセージ要素も探す
            const childMessages = node.querySelectorAll(
              '.chat-line__message, [data-a-target="chat-text-message"], .text-token, .text-fragment, .seventv-chat-message-body'
            );

            if (childMessages.length > 0) {
              childMessages.forEach((msg) => newNodes.push(msg));
            }
          }
        });
      }
    });

    // 重複を削除し処理
    if (newNodes.length > 0) {
      console.log(`${newNodes.length}個の新規要素を検出`);

      [...new Set(newNodes)].forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          processChatMessage(node);
        }
      });
    }
  });

  // 監視を開始 - subtreeをtrueにして深い変更も監視
  observer.observe(container, { childList: true, subtree: true });
  console.log(
    `${
      container.tagName || "UNKNOWN"
    } 要素の監視を開始しました (直接監視モード)`
  );

  // 初回実行として現在のメッセージを取得して処理
  findAndProcessMessages();
}

// ページ全体の監視（最終手段）
function observeEntirePage() {
  console.log("ページ全体の監視を開始します。チャットメッセージを監視します。");

  // チャットに関連する要素がページのどこかにあるはず
  // ページ全体を監視し、チャットのような要素を探す
  observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
        mutation.addedNodes.forEach((node) => {
          // チャットメッセージらしき要素を探す
          if (node.nodeType === Node.ELEMENT_NODE) {
            // チャットメッセージの可能性がある要素かチェック
            const isLikelyMessage =
              (node.classList &&
                (node.classList.contains("chat-line__message") ||
                  node.classList.contains("chat-line") ||
                  node.classList.contains("seventv-chat-message") ||
                  node.textContent.includes("chat"))) ||
              node.querySelector(
                ".chat-line__message, .chat-line, .seventv-chat-message, .text-token"
              );

            if (isLikelyMessage) {
              processChatMessage(node);
            }
          }
        });
      }
    });
  });

  // ページ全体を監視
  observer.observe(document.body, { childList: true, subtree: true });
}

// 初期化処理
async function initialize() {
  // 設定を読み込む
  const { enabled, apiKey } = await chrome.storage.sync.get({
    enabled: false,
    apiKey: "",
  });

  isEnabled = enabled;
  apiKeySet = !!apiKey;

  console.log(
    `Twitch DeepL Translator: コンテンツスクリプト初期化 (有効: ${isEnabled}, APIキー設定済み: ${apiKeySet})`
  );

  // 設定に応じて監視を開始/停止
  if (isEnabled && apiKeySet) {
    startObserving();
  } else {
    stopObserving();
  }
}

// メッセージリスナーの設定
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 翻訳の有効/無効切り替え
  if (message.action === "toggleTranslation") {
    isEnabled = message.enabled;

    if (isEnabled && apiKeySet) {
      startObserving();
    } else {
      stopObserving();
    }

    sendResponse({ success: true });
  }

  // 設定更新の通知
  else if (message.action === "settingsUpdated") {
    initialize();
    sendResponse({ success: true });
  }

  return true;
});

// チャットメッセージの監視を開始
function startObserving() {
  // すでに監視中の場合は何もしない
  if (observer) {
    console.log("すでにチャット監視中です");
    return;
  }

  console.log(
    "Twitchページで拡張機能が有効化されました。チャット監視を開始します。"
  );

  // 少し待機してからチャットコンテナを探す
  setTimeout(() => {
    findChatContainer();
  }, 2000); // 2秒待機

  // 3秒後にまだ設定されていない場合は、直接メッセージ検索モードに切り替え
  setTimeout(() => {
    if (!observer) {
      console.log(
        "チャットコンテナが見つからなかったため、直接メッセージ検索モードを開始します"
      );
      findAndProcessMessages();
    }
  }, 5000); // 5秒待機
}

// チャットメッセージの監視を停止
function stopObserving() {
  if (observer) {
    observer.disconnect();
    observer = null;
    console.log("Twitchチャットの監視を停止しました");
  }
}

// チャットメッセージの監視処理
function observeChatMessages(container) {
  console.log(
    "チャットコンテナの監視を開始します:",
    container.className || container.nodeName
  );

  // MutationObserverの設定
  observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      // 追加されたノードがある場合
      if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
        mutation.addedNodes.forEach((node) => {
          // チャットメッセージの要素を処理
          if (node.nodeType === Node.ELEMENT_NODE) {
            processChatMessage(node);
          }
        });
      }
    });
  });

  // 監視を開始 - childListのみを監視
  observer.observe(container, { childList: true });
  console.log("監視を開始しました（childList: true）");

  // 監視開始時に既存のチャットメッセージも処理
  console.log("既存のチャットメッセージを処理します...");
  const existingMessages = Array.from(container.children);
  console.log(`${existingMessages.length}個の要素を処理します`);

  // 既存要素を処理
  existingMessages.forEach((element) => {
    processChatMessage(element);
  });
}

// チャットメッセージの処理
async function processChatMessage(messageNode) {
  // メッセージノードが要素ノードでなければスキップ
  if (messageNode.nodeType !== Node.ELEMENT_NODE) {
    return;
  }

  // 自分が追加した翻訳要素ならスキップ
  if (
    messageNode.classList &&
    messageNode.classList.contains("twitch-deepl-translation")
  ) {
    return;
  }

  // 様々なセレクタを試す
  const messageSelectors = [
    ".chat-line__message",
    ".seventv-chat-message", // SevenTV拡張機能用
    ".chat-line__message-container",
    ".chat-line",
    '[data-a-target="chat-line-message"]',
    '[data-test-selector="chat-line-message"]',
    ".chat-line-message",
  ];

  // メッセージ要素を探す
  let messageElement = null;
  for (const selector of messageSelectors) {
    messageElement = messageNode.matches(selector)
      ? messageNode
      : messageNode.querySelector(selector);
    if (messageElement) break;
  }

  // メッセージ要素が見つからない場合
  if (!messageElement) {
    return;
  }

  // すでに翻訳済みのメッセージはスキップ
  const messageId =
    messageNode.id ||
    messageElement.id ||
    messageNode.dataset.messageId ||
    messageElement.dataset.messageId;
  if (messageId && translatedComments.has(messageId)) {
    return;
  }

  // メッセージのテキストの取得を試みる
  const textSelectors = [
    // 新しく確認されたTwitch公式のセレクタ
    '[data-a-target="chat-text-message"]',
    '[data-a-target="chat-message-text"]',
    '.text-fragment[data-a-target="chat-message-text"]',

    // SevenTV関連セレクタ
    ".text-token",
    ".seventv-chat-message-body > .text-token",
    "[data-v-43cb0e29].text-token",

    // 一般的なセレクタ
    ".text-fragment",
    ".message",
    ".chat-line__message--content",
    ".message-text",
    ".chat-message",

    // バックアップセレクタ
    'span[class*="text"]',
    'div[class*="message"]',
    'div[class*="chat"] span',
  ];

  let messageTextElement = null;
  let messageText = "";

  // テキスト要素を探す
  for (const selector of textSelectors) {
    try {
      messageTextElement = messageElement.querySelector(selector);
      if (messageTextElement) {
        messageText = messageTextElement.textContent.trim();
        if (messageText) {
          break;
        }
      }
    } catch (error) {
      // エラーがあっても処理を続行
    }
  }

  // テキストの取得に失敗した場合、親要素から直接取得を試みる
  if (!messageText) {
    // メッセージ要素自体のテキストコンテンツを取得
    const textContent = messageElement.textContent.trim();
    if (textContent) {
      // ユーザー名などを除去するか、単純にすべてのテキストを使用
      messageText = textContent;
    }
  }

  if (!messageText) {
    return;
  }

  // 英語判定（簡易的な実装）
  if (!isEnglishText(messageText)) {
    return;
  }

  // APIを無駄に消費しないため、翻訳せずにテキストをそのまま表示
  displayTranslation(messageNode, messageText);

  // 翻訳済みとしてマーク
  if (messageId) {
    translatedComments.set(messageId, true);
  }
}
function isEnglishText(text) {
  // 日本語文字（ひらがな、カタカナ、漢字）を含まない場合は英語と仮定
  const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
  return !japaneseRegex.test(text);
}

// 翻訳リクエストをバックグラウンドスクリプトに送信
function sendTranslationRequest(text) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: "translate", text }, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(response);
      }
    });
  });
}

// content.js の displayTranslation 関数を修正

function displayTranslation(messageNode, translatedText) {
  console.log("翻訳結果を表示します:", translatedText);

  // 既に翻訳要素があれば更新、なければ新規作成
  let translationElement = messageNode.querySelector(
    ".twitch-deepl-translation"
  );

  if (translationElement) {
    console.log("既存の翻訳要素を更新します");
    translationElement.textContent = `🇯🇵 ${translatedText}`;
    return;
  }

  // 提供されたDOMサンプルに基づいて、より具体的なセレクタを追加
  const messageElement = messageNode.classList.contains("chat-line__message")
    ? messageNode
    : messageNode.querySelector(".chat-line__message") ||
      messageNode.closest(".chat-line__message") ||
      messageNode;

  // 翻訳表示用の要素を作成
  translationElement = document.createElement("div");
  translationElement.className = "twitch-deepl-translation";
  translationElement.textContent = `🇯🇵 ${translatedText}`;

  // スタイル設定（より目立つように強化）
  translationElement.style.color = "#9b9b9b";
  translationElement.style.fontSize = "0.9em";
  translationElement.style.marginTop = "4px";
  translationElement.style.marginBottom = "4px";
  translationElement.style.fontStyle = "italic";
  translationElement.style.padding = "2px 0";
  translationElement.style.borderLeft = "3px solid #9147ff";
  translationElement.style.paddingLeft = "8px";
  translationElement.style.marginLeft = "4px";
  translationElement.style.backgroundColor = "rgba(145, 71, 255, 0.05)";
  translationElement.style.borderRadius = "2px";
  translationElement.style.display = "block";
  translationElement.style.width = "95%";

  // 共有いただいたDOM構造に基づく挿入先の候補を追加
  const insertCandidates = [
    // メッセージコンテナを直接ターゲット
    messageElement.querySelector(".chat-line__message-container"),
    // message-containerの親要素
    messageElement.querySelector(".cwtKyw"),
    // メッセージ本体
    messageElement.querySelector('[data-a-target="chat-text-message"]')
      ?.parentElement,
    // フォールバック
    messageElement,
  ];

  // 最初にnullでない要素を使用
  const insertTarget = insertCandidates.find((element) => element !== null);

  if (!insertTarget) {
    console.error("翻訳結果を挿入する場所が見つかりません");
    // デバッグのため周辺要素を出力
    console.log("messageElement:", messageElement);
    console.log(
      "利用可能な子要素:",
      Array.from(messageElement.children).map(
        (el) => el.className || el.nodeName
      )
    );
    return;
  }

  // メッセージ要素の最後に翻訳を追加（代替方法も用意）
  try {
    insertTarget.appendChild(translationElement);
    console.log("翻訳結果を表示しました", insertTarget);
  } catch (error) {
    console.error("翻訳結果の表示に失敗しました:", error);

    // 代替手段として直接DOMに挿入
    try {
      if (messageElement.parentElement) {
        messageElement.parentElement.insertBefore(
          translationElement,
          messageElement.nextSibling
        );
        console.log("代替手段で翻訳結果を表示しました");
      }
    } catch (fallbackError) {
      console.error("翻訳結果の表示に完全に失敗しました:", fallbackError);
    }
  }
}

// プログラム開始
initialize();
