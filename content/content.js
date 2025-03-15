// 拡張機能の状態
let isEnabled = false;
let apiKeySet = false;
let observer = null;

// 翻訳済みコメントを追跡するMap
const translatedComments = new Map();

// チャットコンテナを検索
function findChatContainer() {
  // デバッグ情報を出力
  console.log('Twitchチャットコンテナを検索中...');
  
  // セレクタの完全なリスト
  const selectors = [
    // 標準のTwitchコンテナ
    '.chat-scrollable-area__message-container',
    '.chat-list__list-container',
    '.chat-list',
    '.stream-chat .chat-list--default',
    '.chat-list--default',
    
    // SevenTV関連
    '.seventv-chat-list',
    '.seventv-chat-scrollable-area__message-container',
    
    // データ属性セレクタ
    '[data-test-selector="chat-scrollable-area__message-container"]',
    '[data-a-target="chat-scroller"]',
    '[data-a-target="chat-list"]',
    
    // 汎用セレクタ
    '.chat-scroller',
    '.chat-room__content',
    '.chat-room',
    '.stream-chat',
    '.right-column__wrapper' // 右サイドバー全体
  ];
  
  let chatContainer = null;
  
  // すべてのセレクタを試す
  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    if (elements.length > 0) {
      chatContainer = elements[0]; // 最初の一致を使用
      console.log(`Twitchチャットコンテナを検出しました: ${selector}`);
      break;
    }
  }
  
  if (chatContainer) {
    // コンテナが見つかったら監視を開始
    console.log('チャットコンテナを検出しました。監視を開始します。');
    observeChatMessages(chatContainer);
    return true;
  } else {
    // コンテナが見つからない場合はログを出力
    console.log('Twitchチャットコンテナが見つかりません。ページ内の要素を確認します:');
    
    // デバッグのためページ情報を表示
    console.log('現在のURL:', window.location.href);
    const bodyClasses = document.body.classList;
    console.log('Body classes:', Array.from(bodyClasses));
    
    // チャット関連の要素を探す
    const chatRelated = document.querySelectorAll('[class*="chat"], [data-a-target*="chat"]');
    console.log('チャット関連要素数:', chatRelated.length);
    if (chatRelated.length > 0) {
      console.log('最初のチャット関連要素:', chatRelated[0].className || chatRelated[0].nodeName);
    }
    
    // 3秒後に再試行
    setTimeout(findChatContainer, 3000);
    return false;
  }
}

// ページ全体の監視（最終手段）
function observeEntirePage() {
  console.log('ページ全体の監視を開始します。チャットメッセージを監視します。');
  
  // チャットに関連する要素がページのどこかにあるはず
  // ページ全体を監視し、チャットのような要素を探す
  observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        mutation.addedNodes.forEach(node => {
          // チャットメッセージらしき要素を探す
          if (node.nodeType === Node.ELEMENT_NODE) {
            // チャットメッセージの可能性がある要素かチェック
            const isLikelyMessage = 
              (node.classList && (
                node.classList.contains('chat-line__message') ||
                node.classList.contains('chat-line') ||
                node.classList.contains('seventv-chat-message') ||
                node.textContent.includes('chat')
              )) ||
              node.querySelector('.chat-line__message, .chat-line, .seventv-chat-message, .text-token');
            
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
    apiKey: ''
  });
  
  isEnabled = enabled;
  apiKeySet = !!apiKey;
  
  console.log(`Twitch DeepL Translator: コンテンツスクリプト初期化 (有効: ${isEnabled}, APIキー設定済み: ${apiKeySet})`);
  
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
  if (message.action === 'toggleTranslation') {
    isEnabled = message.enabled;
    
    if (isEnabled && apiKeySet) {
      startObserving();
    } else {
      stopObserving();
    }
    
    sendResponse({ success: true });
  }
  
  // 設定更新の通知
  else if (message.action === 'settingsUpdated') {
    initialize();
    sendResponse({ success: true });
  }
  
  return true;
});

// チャットメッセージの監視を開始
function startObserving() {
  // すでに監視中の場合は何もしない
  if (observer) {
    console.log('すでにチャット監視中です');
    return;
  }
  
  console.log('Twitchページで拡張機能が有効化されました。チャット監視を開始します。');
  
  // 少し待機してからチャットコンテナを探す
  setTimeout(() => {
    findChatContainer();
  }, 3000); // 3秒待機
  
  // 10秒後にまだ設定されていない場合は、ページ全体を監視
  setTimeout(() => {
    if (!observer) {
      console.log('チャットコンテナが見つからなかったため、ページ全体を監視します');
      observeEntirePage();
    }
  }, 10000); // 10秒待機
}

// チャットメッセージの監視を停止
function stopObserving() {
  if (observer) {
    observer.disconnect();
    observer = null;
    console.log('Twitchチャットの監視を停止しました');
  }
}

// チャットメッセージの監視処理
function observeChatMessages(container) {
  console.log('チャットコンテナの監視を開始します:', container.className || container.nodeName);
  
  // MutationObserverの設定
  observer = new MutationObserver(mutations => {
    console.log(`${mutations.length}件の変更を検出しました`);
    
    mutations.forEach(mutation => {
      // 追加されたノードがある場合
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        console.log(`${mutation.addedNodes.length}個の新規要素が追加されました`);
        
        mutation.addedNodes.forEach(node => {
          // チャットメッセージの要素を処理
          processChatMessage(node);
        });
      }
    });
  });
  
  // 監視を開始 - ただしsubtreeをtrueにして、子孫要素の変更も監視
  observer.observe(container, { childList: true, subtree: true });
  console.log('監視を開始しました（childList: true, subtree: true）');
  
  // 監視開始時に既存のチャットメッセージも処理
  console.log('既存のチャットメッセージを処理します...');
  const existingMessages = Array.from(container.querySelectorAll('*'));
  console.log(`${existingMessages.length}個の要素を処理します`);
  
  // 既存要素を処理
  existingMessages.forEach(element => {
    processChatMessage(element);
  });
}

// チャットメッセージの処理
async function processChatMessage(messageNode) {
  // メッセージノードが要素ノードでなければスキップ
  if (messageNode.nodeType !== Node.ELEMENT_NODE) {
    return;
  }
  
  console.log('チャットメッセージを加工中:', messageNode.className || messageNode.nodeName);
  
  // 様々なセレクタを試す
  const messageSelectors = [
    '.chat-line__message',
    '.seventv-chat-message', // SevenTV拡張機能用
    '.chat-line__message-container',
    '.chat-line',
    '[data-a-target="chat-line-message"]',
    '[data-test-selector="chat-line-message"]',
    '.chat-line-message'
  ];
  
  // メッセージ要素を探す
  let messageElement = null;
  for (const selector of messageSelectors) {
    messageElement = messageNode.matches(selector) ? messageNode : messageNode.querySelector(selector);
    if (messageElement) break;
  }
  
  // メッセージ要素が見つからない場合
  if (!messageElement) {
    console.log('メッセージ要素が見つかりません');
    return;
  }
  
  // すでに翻訳済みのメッセージはスキップ
  const messageId = messageNode.id || messageElement.id || messageNode.dataset.messageId || messageElement.dataset.messageId;
  if (messageId && translatedComments.has(messageId)) {
    console.log('すでに翻訳済みのメッセージです', messageId);
    return;
  }
  
  // メッセージのテキストの取得を試みる
  const textSelectors = [
    '.text-token', // Twitchの実際の構造に基づくセレクタ
    '.seventv-chat-message-body > .text-token', // 専用セレクタ
    '.text-fragment', 
    '.message',
    '.chat-line__message--content',
    '[data-a-target="chat-message-text"]',
    '.message-text',
    '.chat-message'
  ];
  
  let messageTextElement = null;
  let messageText = '';
  
  // テキスト要素を探す
  for (const selector of textSelectors) {
    messageTextElement = messageElement.querySelector(selector);
    if (messageTextElement) {
      messageText = messageTextElement.textContent.trim();
      if (messageText) {
        console.log('メッセージテキストを検出:', messageText.substring(0, 30) + (messageText.length > 30 ? '...' : ''));
        break;
      }
    }
  }
  
  // テキストの取得に失敗した場合、親要素から直接取得を試みる
  if (!messageText) {
    console.log('テキスト要素が見つからないため、他の方法で取得を試みます');
    
    // メッセージ要素自体のテキストコンテンツを取得
    const textContent = messageElement.textContent.trim();
    if (textContent) {
      // ユーザー名などを除去するか、単純にすべてのテキストを使用
      messageText = textContent;
      console.log('親要素からテキストを取得:', messageText.substring(0, 30) + (messageText.length > 30 ? '...' : ''));
    }
  }
  
  if (!messageText) {
    console.log('テキストが見つかりませんでした');
    return;
  }
  
  // 英語判定（簡易的な実装）
  if (!isEnglishText(messageText)) {
    console.log('言語判定: 英語ではないためスキップ');
    return;
  }
  
  console.log('翻訳リクエストを送信します:', messageText);
  
  // 翻訳リクエスト
  try {
    const result = await sendTranslationRequest(messageText);
    
    if (result.success) {
      console.log('翻訳成功:', result.translatedText);
      // 翻訳結果を表示
      displayTranslation(messageNode, result.translatedText);
      
      // 翻訳済みとしてマーク
      if (messageId) {
        translatedComments.set(messageId, true);
      }
    } else {
      console.error('翻訳エラー:', result.error);
    }
  } catch (error) {
    console.error('翻訳処理中のエラー:', error);
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
    chrome.runtime.sendMessage(
      { action: 'translate', text },
      response => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      }
    );
  });
}

// 翻訳結果の表示
function displayTranslation(messageNode, translatedText) {
  console.log('翻訳結果を表示します:', translatedText);
  
  // 既に翻訳要素があれば更新、なければ新規作成
  let translationElement = messageNode.querySelector('.twitch-deepl-translation');
  
  if (translationElement) {
    console.log('既存の翻訳要素を更新します');
    translationElement.textContent = `🇯🇵 ${translatedText}`;
    return;
  }
  
  // メッセージ要素を探す
  const messageElement = (
    messageNode.classList.contains('chat-line__message') ? messageNode : 
    messageNode.classList.contains('seventv-chat-message') ? messageNode : 
    messageNode.querySelector('.chat-line__message') ||
    messageNode.querySelector('.seventv-chat-message') ||
    messageNode.querySelector('[data-a-target="chat-line-message"]') ||
    messageNode
  );
  
  // 翻訳表示用の要素を作成
  translationElement = document.createElement('div');
  translationElement.className = 'twitch-deepl-translation';
  translationElement.textContent = `🇯🇵 ${translatedText}`;
  
  // スタイル設定
  translationElement.style.color = '#9b9b9b';
  translationElement.style.fontSize = '0.9em';
  translationElement.style.marginTop = '4px';
  translationElement.style.marginBottom = '4px';
  translationElement.style.fontStyle = 'italic';
  translationElement.style.padding = '2px 0';
  translationElement.style.borderLeft = '2px solid #9147ff';
  translationElement.style.paddingLeft = '8px';
  translationElement.style.marginLeft = '4px';
  
  // 挿入先を特定
  const insertTarget = (
    // メッセージ本文の容器要素
    messageElement.querySelector('.chat-line__message-container') ||
    messageElement.querySelector('.chat-line__message--content') ||
    // 上記が見つからない場合はメッセージ要素自体
    messageElement
  );
  
  // メッセージ要素の最後に翻訳を追加
  try {
    insertTarget.appendChild(translationElement);
    console.log('翻訳結果を表示しました');
  } catch (error) {
    console.error('翻訳結果の表示に失敗しました:', error);
    // 代替手段として親要素に追加を試みる
    try {
      messageNode.appendChild(translationElement);
      console.log('代替手段で翻訳結果を表示しました');
    } catch (fallbackError) {
      console.error('翻訳結果の表示に完全に失敗しました:', fallbackError);
    }
  }
}

// プログラム開始
initialize();
