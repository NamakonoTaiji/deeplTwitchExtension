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
  
  // 最初に特定のSevenTVメッセージ要素を直接確認
  const seventvMessages = document.querySelectorAll('[data-v-43cb0e29].seventv-chat-message-body, [data-v-43cb0e29].text-token');
  if (seventvMessages.length > 0) {
    console.log('SevenTV メッセージを直接検出しました。親要素を監視します。');
    // 最初のメッセージの親要素を辿って監視対象を特定
    let parent = seventvMessages[0].parentElement;
    // 適切な親要素（複数のメッセージを含む要素）を見つける
    for (let i = 0; i < 5 && parent; i++) { // 最大5レベル上まで確認
      const siblings = Array.from(parent.querySelectorAll('[data-v-43cb0e29]'));
      
      if (siblings.length > 1) {
        console.log('適切なチャットコンテナを検出しました:', parent);
        observeChatMessages(parent);
        return true;
      }
      parent = parent.parentElement;
    }
    
    // 適切な親が見つからない場合は、最も近い親を使用
    if (parent) {
      console.log('最も近い親要素をコンテナとして使用します:', parent);
      observeChatMessages(parent);
      return true;
    }
  }
  
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
    // SevenTV 新セレクタ（2025年3月更新）
    '[data-v-43cb0e29]',
    '.seventv-chat-message-body',
    
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
    
    // 1秒後に再試行（3秒→1秒に短縮）
    setTimeout(findChatContainer, 1000);
    return false;
  }
}

// ページ内のメッセージを直接検索して処理する関数
function findAndProcessMessages() {
  // より包括的なセレクタのリスト
  const messageSelectors = [
    // Twitch公式要素
    '.chat-line__message',
    '.chat-line__message-container',
    '.chat-line',
    '[data-a-target="chat-line-message"]',
    '[data-test-selector="chat-line-message"]',
    
    // メッセージテキスト要素
    '[data-a-target="chat-text-message"]',
    '.text-fragment[data-a-target="chat-message-text"]',
    '.chat-message',
    '.text-token',
    
    // SevenTV関連
    '.seventv-chat-message-body',
    '.seventv-chat-message',
    '[data-v-43cb0e29]'
  ];
  
  let foundMessages = [];
  
  // 各セレクタで検索
  for (const selector of messageSelectors) {
    try {
      const messages = document.querySelectorAll(selector);
      if (messages.length > 0) {
        console.log(`${selector} セレクタで ${messages.length} 個のメッセージを検出`);
        foundMessages = foundMessages.concat(Array.from(messages));
      }
    } catch (error) {
      console.log(`セレクタ ${selector} の検索中にエラーが発生:`, error);
    }
  }
  
  // 重複を削除
  const uniqueMessages = [...new Set(foundMessages)];
  
  if (uniqueMessages.length > 0) {
    console.log(`合計 ${uniqueMessages.length} 個のメッセージを直接検出しました。処理を開始します。`);
    
    // メッセージごとに処理し翻訳を試みる
    uniqueMessages.forEach(message => {
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
  console.log('メッセージの直接監視を開始します');
  
  // すでに監視中なら何もしない
  if (observer) {
    return;
  }
  
  // チャットメッセージの可能性がある要素を監視する対象を決定
  // チャット関連の親要素を見つける
  const potentialContainers = [
    document.querySelector('.chat-room__content'),
    document.querySelector('.right-column__wrapper'),
    document.querySelector('.stream-chat'),
    document.querySelector('.chat-list'),
    document.body // 最終手段
  ];
  
  const container = potentialContainers.find(el => el !== null) || document.body;
  
  // MutationObserverの設定
  observer = new MutationObserver(mutations => {
    let newNodes = [];
    
    mutations.forEach(mutation => {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            newNodes.push(node);
            
            // 追加された要素内の潜在的なメッセージ要素も探す
            const childMessages = node.querySelectorAll(
              '.chat-line__message, [data-a-target="chat-text-message"], .text-token, .text-fragment, .seventv-chat-message-body'
            );
            
            if (childMessages.length > 0) {
              childMessages.forEach(msg => newNodes.push(msg));
            }
          }
        });
      }
    });
    
    // 重複を削除し処理
    if (newNodes.length > 0) {
      console.log(`${newNodes.length}個の新規要素を検出`);
      
      [...new Set(newNodes)].forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          processChatMessage(node);
        }
      });
    }
  });
  
  // 監視を開始 - subtreeをtrueにして深い変更も監視
  observer.observe(container, { childList: true, subtree: true });
  console.log(`${container.tagName || 'UNKNOWN'} 要素の監視を開始しました (直接監視モード)`);
  
  // 初回実行として現在のメッセージを取得して処理
  findAndProcessMessages();
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
  
  // 5秒後にまだ設定されていない場合は、直接メッセージ検索モードに切り替え
  setTimeout(() => {
    if (!observer) {
      console.log('チャットコンテナが見つからなかったため、直接メッセージ検索モードを開始します');
      
      // 直接監視モードを開始
      startDirectObserving();
    }
  }, 3000); // 3秒待機に短縮
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
  
  // 自分が追加した翻訳要素ならスキップ
  if (messageNode.classList && messageNode.classList.contains('twitch-deepl-translation')) {
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
    // 新しく確認されたTwitch公式のセレクタ
    '[data-a-target="chat-text-message"]',
    '[data-a-target="chat-message-text"]',
    '.text-fragment[data-a-target="chat-message-text"]',
    
    // SevenTV関連セレクタ
    '.text-token', 
    '.seventv-chat-message-body > .text-token',
    '[data-v-43cb0e29].text-token',
    
    // 一般的なセレクタ
    '.text-fragment', 
    '.message',
    '.chat-line__message--content',
    '.message-text',
    '.chat-message',
    
    // バックアップセレクタ
    'span[class*="text"]',
    'div[class*="message"]',
    'div[class*="chat"] span'
  ];
  
  let messageTextElement = null;
  let messageText = '';
  
  // テキスト要素を探す
  for (const selector of textSelectors) {
    try {
      messageTextElement = messageElement.querySelector(selector);
      if (messageTextElement) {
        messageText = messageTextElement.textContent.trim();
        if (messageText) {
          console.log('メッセージテキストを検出:', messageText.substring(0, 30) + (messageText.length > 30 ? '...' : ''));
          break;
        }
      }
    } catch (error) {
      console.log(`セレクタ ${selector} の処理中にエラーが発生しました:`, error);
      // エラーがあっても処理を続行
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
    messageNode.classList.contains('seventv-chat-message-body') ? messageNode :
    messageNode.hasAttribute && messageNode.hasAttribute('data-v-43cb0e29') ? messageNode :
    messageNode.querySelector('.chat-line__message') ||
    messageNode.querySelector('.seventv-chat-message') ||
    messageNode.querySelector('.seventv-chat-message-body') ||
    messageNode.querySelector('[data-v-43cb0e29]') ||
    messageNode.querySelector('[data-a-target="chat-line-message"]') ||
    messageNode
  );
  
  // 翻訳表示用の要素を作成
  translationElement = document.createElement('div');
  translationElement.className = 'twitch-deepl-translation';
  translationElement.textContent = `🇯🇵 ${translatedText}`;
  
  // スタイル設定（より目立つように強化）
  translationElement.style.color = '#9b9b9b';
  translationElement.style.fontSize = '0.9em';
  translationElement.style.marginTop = '4px';
  translationElement.style.marginBottom = '4px';
  translationElement.style.fontStyle = 'italic';
  translationElement.style.padding = '2px 0';
  translationElement.style.borderLeft = '3px solid #9147ff';
  translationElement.style.paddingLeft = '8px';
  translationElement.style.marginLeft = '4px';
  translationElement.style.backgroundColor = 'rgba(145, 71, 255, 0.05)';
  translationElement.style.borderRadius = '2px';
  translationElement.style.display = 'block';
  translationElement.style.width = '95%';
  translationElement.style.boxSizing = 'border-box';
  translationElement.style.position = 'relative';
  translationElement.style.zIndex = '10';
  
  // チャットメッセージの挿入先候補を収集
  const insertCandidates = [
    // Twitch ネイティブ
    messageElement.querySelector('.chat-line__message-container'),
    messageElement.querySelector('.chat-line__message--content'),
    messageElement.querySelector('.text-fragment')?.parentElement,
    messageElement.querySelector('[data-a-target="chat-text-message"]')?.parentElement,
    
    // SevenTV
    messageElement.querySelector('.seventv-chat-message-body'),
    messageElement.closest('.seventv-chat-message-body'),
    
    // その他
    messageElement,
    messageNode
  ];
  
  // 最初にnullでない要素を使用
  const insertTarget = insertCandidates.find(element => element !== null && element !== undefined);
  
  if (!insertTarget) {
    console.error('翻訳結果を挿入する場所が見つかりません');
    return;
  }
  
  // メッセージ要素の最後に翻訳を追加
  try {
    // スタイルを保持するためにappendChildではなくinsertAdjacentElementを使用
    insertTarget.insertAdjacentElement('beforeend', translationElement);
    console.log('翻訳結果を表示しました', insertTarget);
  } catch (error) {
    console.error('翻訳結果の表示に失敗しました:', error);
    
    // 代替手段として親要素に追加を試みる
    try {
      if (insertTarget.parentElement) {
        insertTarget.parentElement.appendChild(translationElement);
        console.log('代替手段で翻訳結果を表示しました');
      } else {
        console.error('親要素が見つからないため、翻訳を表示できません');
      }
    } catch (fallbackError) {
      console.error('翻訳結果の表示に完全に失敗しました:', fallbackError);
    }
  }

  // 翻訳要素を保存して重複処理を防止
  if (messageElement.id) {
    translatedComments.set(messageElement.id, true);
  } else if (messageNode.id) {
    translatedComments.set(messageNode.id, true);
  } else {
    // IDがない場合は一意のIDを生成
    const randomId = `translated-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    messageElement.setAttribute('data-translation-id', randomId);
    translatedComments.set(randomId, true);
  }
}

// プログラム開始
initialize();
