// Twitch DeepL Translator: メインコンテンツスクリプト
console.log('Twitch DeepL Translator: コンテンツスクリプトが起動しました');

// 拡張機能の状態
let isEnabled = false;
let apiKeySet = false;
let observer = null;

// 設定
let settings = {
  apiKey: '',
  enabled: false,
  translationMode: 'selective',
  japaneseThreshold: 30,
  englishThreshold: 50,
  displayPrefix: '🇯🇵',
  textColor: '#9b9b9b',
  accentColor: '#9147ff',
  fontSize: 'medium'
};

// 翻訳済みコメントを追跡するMap
const translatedComments = new Map();

// DOM完全ロード後に実行
document.addEventListener('DOMContentLoaded', initialize);

// ページロードが既に完了している場合の対応
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(initialize, 1000);
}

// 初期化処理
async function initialize() {
  console.log('Twitch DeepL Translator: 初期化開始');
  
  // 再度の初期化フラグをクリア
  sessionStorage.removeItem('twitch_deepl_context_invalidated');
  
  // 後続の処理が失敗しても、直接ローカルストレージから読み込む
  let manuallyLoaded = false;
  
  try {
    // ローカルストレージから直接読み込み
    const storedSettings = localStorage.getItem('twitch_deepl_settings');
    if (storedSettings) {
      try {
        settings = JSON.parse(storedSettings);
        isEnabled = settings.enabled;
        apiKeySet = !!settings.apiKey;
        console.log('初期化時にローカルストレージから設定を読み込みました');
        manuallyLoaded = true;
      } catch (parseError) {
        console.error('ローカルストレージの設定の解析中にエラー:', parseError);
      }
    }
  } catch (localStorageError) {
    console.warn('ローカルストレージからの設定読み込みに失敗しました:', localStorageError);
  }
  
  // 設定を読み込む
  try {
    // バックグラウンドスクリプトから設定を取得
    settings = await getSettings();
    
    isEnabled = settings.enabled;
    apiKeySet = !!settings.apiKey;
    
    console.log(`設定を読み込みました: 有効=${isEnabled}, APIキー設定済み=${apiKeySet}`);
    console.log('翻訳モード:', settings.translationMode);
    
    // 設定をローカルストレージに保存（コンテキスト無効化への対策）
    try {
      localStorage.setItem('twitch_deepl_settings', JSON.stringify(settings));
    } catch (storageError) {
      console.warn('ローカルストレージへの設定保存に失敗しました:', storageError);
    }
    
    // バックグラウンドスクリプトに初期化完了を通知
    try {
      chrome.runtime.sendMessage({ 
        action: 'contentScriptInitialized',
        enabled: isEnabled
      }, response => {
        if (chrome.runtime.lastError) {
          console.warn('初期化通知エラー:', chrome.runtime.lastError);
        } else {
          console.log('初期化通知が成功しました');
        }
      });
    } catch (notifyError) {
      console.error('初期化通知失敗:', notifyError);
    }
    
    // 有効かつAPIキーがある場合は監視開始
    if (isEnabled && apiKeySet) {
      startObserving();
    }
  } catch (error) {
    console.error('設定読み込みエラー:', error);
    
    // 拡張機能コンテキストが無効化されたエラーの場合
    if (error.message && error.message.includes('Extension context invalidated')) {
      console.warn('拡張機能コンテキストが無効になりました。ローカル設定を使用します。');
      
      // manuallyLoadedがtrueの場合、すでにローカルストレージから読み込み済み
      if (manuallyLoaded) {
        console.log('すでにローカルストレージから設定を読み込み済みです');
        if (isEnabled && apiKeySet) {
          startObserving();
        }
        return; // ここで処理を終了
      }
      
      // ローカルストレージから設定を読み込む試み
      try {
        const storedSettings = localStorage.getItem('twitch_deepl_settings');
        if (storedSettings) {
          settings = JSON.parse(storedSettings);
          isEnabled = settings.enabled;
          apiKeySet = !!settings.apiKey;
          console.log('ローカルストレージから設定を復元しました');
          
          if (isEnabled && apiKeySet) {
            startObserving();
          }
          return; // 処理成功のため終了
        }
      } catch (localStorageError) {
        console.error('ローカルストレージからの設定読み込みエラー:', localStorageError);
      }
      
      // 30秒後に再初期化を試行
      setTimeout(() => {
        console.log('拡張機能コンテキストの再接続を試みます...');
        initialize();
      }, 30000);
    }
    
    // manuallyLoadedがtrueの場合、すでにローカルから読み込み済みのため終了
    if (manuallyLoaded) {
      return;
    }
    
    // デフォルトで無効に設定
    isEnabled = isEnabled || false;
    apiKeySet = apiKeySet || false;
  }
}

// バックグラウンドスクリプトから設定を取得
async function getSettings() {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
        if (chrome.runtime.lastError) {
          const error = chrome.runtime.lastError;
          console.warn('設定取得中のエラー:', error);
          // エラー時はフォールバック処理へ
          throw new Error(error.message || 'Unknown error');
        } else {
          // 成功した場合はローカルストレージに保存
          try {
            localStorage.setItem('twitch_deepl_settings', JSON.stringify(response));
            console.log('バックグラウンドから設定を取得しました');
          } catch (storageError) {
            console.warn('ローカルストレージへの保存に失敗:', storageError);
          }
          resolve(response);
        }
      });
    } catch (error) {
      console.error('設定取得リクエストの送信中にエラーが発生しました:', error);
      
      // ローカルストレージからの設定読み込みを試みる
      getSettingsFromLocalStorage().then(resolve).catch(() => {
        // デフォルト設定を返す
        console.log('デフォルト設定を使用します');
        resolve(getDefaultSettings());
      });
    }
  });
}

// ローカルストレージから設定を読み込む
async function getSettingsFromLocalStorage() {
  return new Promise((resolve, reject) => {
    try {
      const storedSettings = localStorage.getItem('twitch_deepl_settings');
      if (storedSettings) {
        console.log('ローカルストレージから設定を取得しました');
        resolve(JSON.parse(storedSettings));
      } else {
        reject(new Error('ローカルストレージに設定がありません'));
      }
    } catch (error) {
      console.warn('ローカルストレージからの設定読み込みに失敗しました:', error);
      reject(error);
    }
  });
}

// デフォルト設定を取得
function getDefaultSettings() {
  return {
    apiKey: '',
    enabled: false,
    translationMode: 'selective',
    japaneseThreshold: 30,
    englishThreshold: 50,
    displayPrefix: '🇯🇵',
    textColor: '#9b9b9b',
    accentColor: '#9147ff',
    fontSize: 'medium',
    useCache: true,
    maxCacheAge: 24,
    processExistingMessages: false,
    requestDelay: 100
  };
}

// チャットコンテナを検索
function findChatContainer() {
  console.log("Twitchチャットコンテナを検索中...");

  // メインのチャットコンテナセレクタ
  const chatContainer = document.querySelector(
    '[data-test-selector="chat-scrollable-area__message-container"]'
  );

  if (chatContainer) {
    console.log("チャットコンテナを検出しました。監視を開始します。");
    observeChatMessages(chatContainer);
    return true;
  } else {
    console.log("Twitchチャットコンテナが見つかりません。後ほど再試行します。");
    setTimeout(findChatContainer, 1000);
    return false;
  }
}

// チャットメッセージの監視を開始
function startObserving() {
  if (observer) {
    console.log("すでにチャット監視中です");
    return;
  }

  console.log("チャット監視を開始します。");
  
  // チャットコンテナを探す
  setTimeout(findChatContainer, 2000);
}

// チャットメッセージの監視処理
function observeChatMessages(container) {
  console.log("チャットコンテナの監視を開始します");

  // MutationObserverの設定
  observer = new MutationObserver((mutations) => {
    // 新規メッセージの処理間隔を開けるためのスロットリング
    const addedNodes = [];
    
    mutations.forEach((mutation) => {
      // 追加されたノードがある場合
      if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
        mutation.addedNodes.forEach((node) => {
          // チャットメッセージの要素を収集
          if (node.nodeType === Node.ELEMENT_NODE) {
            addedNodes.push(node);
          }
        });
      }
    });
    
    // 収集したノードを遅延を付けて処理
    addedNodes.forEach((node, index) => {
      setTimeout(() => {
        processChatMessage(node);
      }, index * settings.requestDelay); // リクエスト間の最小遅延
    });
  });

  // 監視を開始 - childListのみを監視
  observer.observe(container, { childList: true });
  console.log("監視を開始しました（childList: true）");

  // 監視開始時の既存メッセージ処理
  if (settings.processExistingMessages) {
    console.log("既存のチャットメッセージを処理します...");
    const existingMessages = Array.from(container.children);
    console.log(`${existingMessages.length}個の既存メッセージを処理します`);

    // 既存メッセージの処理間隔を開けてリクエストを分散させる
    existingMessages.forEach((element, index) => {
      setTimeout(() => {
        processChatMessage(element);
      }, index * settings.requestDelay); // ここで遅延を設定
    });
  } else {
    console.log("既存メッセージの翻訳は無効に設定されています。");
  }
}

// チャットメッセージの処理
async function processChatMessage(messageNode) {
  // 拡張機能が無効またはAPIキーが設定されていない場合はスキップ
  if (!isEnabled) {
    // デバッグ情報を追加
    console.debug('翻訳機能が無効のため、処理をスキップします。現在の状態:', { isEnabled, apiKeySet });
    return;
  }
  
  if (!apiKeySet) {
    console.debug('APIキーが設定されていないため、処理をスキップします。');
    return;
  }
  
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

  // メッセージ要素を特定
  const isMessageElement = messageNode.classList.contains("chat-line__message");
  const messageElement = isMessageElement
    ? messageNode
    : messageNode.querySelector(".chat-line__message");

  if (!messageElement) {
    return; // メッセージ要素がない場合はスキップ
  }

  // メッセージIDの取得（属性から）
  const messageId = messageElement.getAttribute('data-message-id') || 
                    messageElement.getAttribute('id') ||
                    Date.now().toString(); // 属性がない場合はタイムスタンプを使用
  
  // 既に処理済みならスキップ
  if (translatedComments.has(messageId)) {
    return;
  }

  // メッセージテキストを取得
  let messageText = extractMessageText(messageElement);
  
  if (!messageText) {
    return; // テキストがない場合はスキップ
  }

  // 翻訳モードに応じて翻訳するかどうかを判定
  if (!shouldTranslateBasedOnMode(messageText)) {
    return; // 翻訳対象外はスキップ
  }

  console.log(`翻訳対象メッセージを検出: "${messageText}"`);
  
  try {
    // 翻訳リクエストを送信
    // 翻訳モードがallの場合は言語自動検出、それ以外は英語と仮定
    const sourceLang = settings.translationMode === 'all' ? 'auto' : 'EN';
    const translationResult = await sendTranslationRequest(messageText, sourceLang);
    
    if (translationResult && translationResult.success) {
      // 翻訳結果を表示
      displayTranslation(messageElement, translationResult.translatedText);
      
      // 処理済みとしてマーク
      translatedComments.set(messageId, true);
    } else if (translationResult) {
      // エラーメッセージをコンソールに出力
      console.error('翻訳エラー:', translationResult.error);
      
      // 翻訳機能が無効になっている場合は、一時的に無効化
      if (translationResult.error && translationResult.error.includes('翻訳機能が無効')) {
        console.warn('バックグラウンドで翻訳機能が無効になっています。ローカル状態を更新します。');
        isEnabled = false; // ローカル状態を更新
        
        // 30秒後に設定を再読み込み
        setTimeout(async () => {
          console.log('設定の再読み込みを試みます...');
          await updateSettings();
        }, 30000);
      }
      
      // エラーが続く場合、拡張機能が無効になっている可能性がある
      if (translationResult.error && translationResult.error.includes('Extension context invalidated')) {
        console.warn('拡張機能コンテキストが無効になりました。監視を停止します。');
        stopObserving();
        return;
      }
    }
  } catch (error) {
    console.error('翻訳リクエスト中のエラー:', error);
    
    // 重大なエラーの場合は監視を停止
    if (error.message && error.message.includes('Extension context invalidated')) {
      console.warn('拡張機能コンテキストが無効になりました。監視を停止します。');
      stopObserving();
    }
  }
}

// メッセージテキストの抽出
function extractMessageText(messageElement) {
  // 新しいDOMパスを優先的に使用
  const textElement = messageElement.querySelector('[data-a-target="chat-message-text"]') ||
                      messageElement.querySelector('[data-a-target="chat-line-message-body"] .text-fragment') ||
                      messageElement.querySelector('.text-fragment');
  
  if (textElement) {
    return textElement.textContent.trim();
  }
  
  // バックアップ方法: テキストを含む可能性のある要素を探す
  const possibleTextContainers = [
    '.text-token',
    '.message-text',
    '[data-a-target="chat-line-message-body"]'
  ];
  
  for (const selector of possibleTextContainers) {
    const element = messageElement.querySelector(selector);
    if (element && element.textContent.trim()) {
      return element.textContent.trim();
    }
  }
  
  return null;
}

// 翻訳モードに基づいて翻訳すべきかどうかを判定
function shouldTranslateBasedOnMode(text) {
  // 翻訳モードに応じて判定
  switch (settings.translationMode) {
    // すべてのメッセージを翻訳
    case 'all':
      return true;
      
    // 英語メッセージのみ翻訳
    case 'english':
      return isEnglishText(text);
      
    // 選択的翻訳（デフォルト）- 言語判定ロジックを使用
    case 'selective':
    default:
      return shouldTranslate(text);
  }
}

// 英語テキスト判定（シンプル版）
function isEnglishText(text) {
  // 簡易的な英語判定: アルファベットが50%以上を占めるか
  const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
  return englishChars / text.length >= 0.5;
}

// 翻訳すべきテキストかどうかを判定（選択的翻訳用）
function shouldTranslate(text) {
  // 空のテキストは翻訳しない
  if (!text || text.length === 0) {
    return false;
  }
  
  // 設定から閾値を取得
  const japaneseThreshold = settings.japaneseThreshold / 100;
  const englishThreshold = settings.englishThreshold / 100;
  
  // 文章の内容を分析して翻訳すべきかどうかを判断
  
  // 1. 日本語の文字の割合を計算
  const japaneseChars = (text.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g) || []).length;
  const totalChars = text.length;
  const japaneseRatio = japaneseChars / totalChars;
  
  // 2. 英語（ラテン文字）の割合を計算
  const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
  const englishRatio = englishChars / totalChars;
  
  // 3. 記号やスペースの割合
  const symbolsAndSpaces = (text.match(/[\s\d\p{P}]/gu) || []).length;
  const contentChars = totalChars - symbolsAndSpaces;
  
  // 判定ロジック：
  // - 英語の文字が主要部分を占める場合は翻訳対象
  // - 日本語の文字が一定割合以上ある場合は翻訳対象外
  // - 日本語と英語の文字が混在する場合で、英語が日本語より多い場合は翻訳対象
  
  // 日本語が多ければ翻訳しない
  if (japaneseRatio >= japaneseThreshold) {
    console.log(`日本語率: ${(japaneseRatio * 100).toFixed(1)}% - 翻訳しません`);
    return false;
  }
  
  // 英語が十分にあれば翻訳する
  if (englishRatio >= englishThreshold) {
    console.log(`英語率: ${(englishRatio * 100).toFixed(1)}% - 翻訳対象です`);
    return true;
  }
  
  // 内容がほとんどない場合（絵文字や記号だけなど）は翻訳しない
  if (contentChars < 3) {
    console.log('実質的な内容が少ないため翻訳しません');
    return false;
  }
  
  // 英語が日本語より多い場合は翻訳する
  if (englishChars > japaneseChars) {
    console.log('英語が日本語より多いため翻訳対象です');
    return true;
  }
  
  // デフォルトでは翻訳しない
  return false;
}

// 翻訳リクエストをバックグラウンドスクリプトに送信
function sendTranslationRequest(text, sourceLang = 'auto') {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ action: 'translate', text, sourceLang }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('翻訳リクエストエラー:', chrome.runtime.lastError.message);
          
          // コンテキスト無効化エラーの場合は再初期化を試みる
          if (chrome.runtime.lastError.message.includes('Extension context invalidated')) {
            handleContextInvalidated();
          }
          
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    } catch (error) {
      console.error('メッセージ送信エラー:', error);
      
      // 拡張機能コンテキストが無効になった場合の処理
      if (error.message && error.message.includes('Extension context invalidated')) {
        handleContextInvalidated();
      }
      
      resolve({ success: false, error: error.message });
    }
  });
}

// コンテキスト無効化時の処理
function handleContextInvalidated() {
  console.warn('拡張機能コンテキストが無効になりました。自動再接続を試みます。');
  
  // 監視を停止
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  
  // コンテキスト無効化が既に検出されている場合は再初期化しない
  const contextInvalidatedFlag = sessionStorage.getItem('twitch_deepl_context_invalidated');
  const now = Date.now();
  const lastAttempt = parseInt(contextInvalidatedFlag || '0');
  
  // 最後の試行から30秒以上経過している場合のみ再試行
  if (now - lastAttempt > 30000) {
    sessionStorage.setItem('twitch_deepl_context_invalidated', now.toString());
    
    // 10秒後に再初期化を試行
    setTimeout(() => {
      console.log('拡張機能の再初期化を試みます...');
      initialize();
    }, 10000);
  } else {
    console.log('最近再初期化を試行したため、再試行をスキップします');
  }
}

// 翻訳表示関数
function displayTranslation(messageElement, translatedText) {
  console.log(`翻訳表示: "${translatedText}"`);
  
  // 既に翻訳要素があれば更新
  let translationElement = messageElement.querySelector('.twitch-deepl-translation');
  
  if (translationElement) {
    translationElement.textContent = `${settings.displayPrefix} ${translatedText}`;
    return;
  }
  
  // 翻訳表示用の要素を作成
  translationElement = document.createElement('div');
  translationElement.className = 'twitch-deepl-translation';
  translationElement.textContent = `${settings.displayPrefix} ${translatedText}`;
  
  // フォントサイズの設定
  let fontSize = '0.9em';
  switch (settings.fontSize) {
    case 'small':
      fontSize = '0.8em';
      break;
    case 'medium':
      fontSize = '0.9em';
      break;
    case 'large':
      fontSize = '1.0em';
      break;
  }
  
  // スタイル設定
  translationElement.style.color = settings.textColor;
  translationElement.style.fontSize = fontSize;
  translationElement.style.marginTop = '4px';
  translationElement.style.marginLeft = '20px';
  translationElement.style.fontStyle = 'italic';
  translationElement.style.padding = '2px 0';
  translationElement.style.borderLeft = `3px solid ${settings.accentColor}`;
  translationElement.style.paddingLeft = '8px';
  
  // 最適な挿入位置を探す
  // 1. メッセージコンテナ
  const messageContainer = messageElement.querySelector('.chat-line__message-container');
  
  // 2. サブコンテナ（確認された構造から）
  const subContainer = messageElement.querySelector('.cwtKyw');
  
  // 挿入先の決定
  const insertTarget = messageContainer || subContainer || messageElement;
  
  try {
    // 要素の最後に追加
    insertTarget.appendChild(translationElement);
    console.log('翻訳を表示しました');
  } catch (error) {
    console.error('翻訳表示エラー:', error);
    
    // 代替手段としてmessageElementの後に挿入
    try {
      if (messageElement.parentElement) {
        messageElement.parentElement.insertBefore(
          translationElement,
          messageElement.nextSibling
        );
        console.log('代替方法で翻訳を表示しました');
      }
    } catch (fallbackError) {
      console.error('翻訳表示の代替手段も失敗:', fallbackError);
    }
  }
}

// チャットメッセージの監視を停止
function stopObserving() {
  if (observer) {
    observer.disconnect();
    observer = null;
    console.log('Twitchチャットの監視を停止しました');
  }
}

// 設定を更新
async function updateSettings() {
  try {
    // 設定を再取得
    settings = await getSettings();
    isEnabled = settings.enabled;
    apiKeySet = !!settings.apiKey;
    
    console.log('設定を更新しました');
    
    // 設定をローカルストレージに保存（コンテキスト無効化への対策）
    try {
      localStorage.setItem('twitch_deepl_settings', JSON.stringify(settings));
    } catch (storageError) {
      console.warn('ローカルストレージへの設定保存に失敗しました:', storageError);
    }
    
    // 有効/無効状態に応じて監視を開始/停止
    if (isEnabled && apiKeySet) {
      if (!observer) {
        startObserving();
      }
    } else {
      stopObserving();
    }
  } catch (error) {
    console.error('設定更新エラー:', error);
    
    // 拡張機能コンテキストが無効化されたエラーの場合
    if (error.message && error.message.includes('Extension context invalidated')) {
      console.warn('拡張機能コンテキストが無効になりました。再接続を試みます...');
      
      // ローカルストレージから設定を読み込む
      try {
        const storedSettings = localStorage.getItem('twitch_deepl_settings');
        if (storedSettings) {
          settings = JSON.parse(storedSettings);
          isEnabled = settings.enabled;
          apiKeySet = !!settings.apiKey;
          console.log('ローカルストレージから設定を復元しました');
        }
      } catch (localStorageError) {
        console.error('ローカルストレージからの設定読み込みエラー:', localStorageError);
      }
    }
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
    updateSettings();
    sendResponse({ success: true });
  }
  
  return true;
});

// 拡張機能のコンテキスト変更を監視
// 拡張機能が再読み込みされた場合に当処理を再度実行するため
(() => {
  // 拡張機能の初期化状態を確認する関数
  function checkExtensionContext() {
    try {
      // ダミーメッセージを送信してコンテキストが有効か確認
      chrome.runtime.sendMessage({ action: 'ping' }, response => {
        // 当関数が終了する前にエラーが発生しなければコンテキストは有効
        // 次回の確認をスケジュール
        const nextCheckTime = isEnabled ? 15000 : 60000; // 有効時は15秒ごと、無効時は1分ごと
        setTimeout(checkExtensionContext, nextCheckTime);
      });
    } catch (error) {
      // エラーが発生した場合、拡張機能の再初期化を試みる
      console.warn('拡張機能コンテキストが変更されました。再初期化します。', error);
      
      // 監視を停止
      stopObserving();
      
      // 外部リソースの参照をクリア
      observer = null;
      translatedComments.clear();
      
      // 再初期化の試行回数のカウント
      const retryCount = parseInt(sessionStorage.getItem('twitch_deepl_retry_count') || '0') + 1;
      sessionStorage.setItem('twitch_deepl_retry_count', retryCount.toString());
      
      // 一定回数以上失敗した場合は長い間隔を空ける
      const delayTime = retryCount > 3 ? 30000 : 3000;
      
      // 再初期化
      setTimeout(() => {
        console.log('拡張機能の再初期化を試みます...(試行回数:' + retryCount + ')');
        // ローカルストレージから設定を読み込み直す
        try {
          // 直接ローカルストレージから設定を取得する
          const storedSettings = localStorage.getItem('twitch_deepl_settings');
          if (storedSettings) {
            settings = JSON.parse(storedSettings);
            isEnabled = settings.enabled;
            apiKeySet = !!settings.apiKey;
            console.log('ローカルストレージから設定を直接読み込みました');
            
            // 有効かつAPIキーがあれば再度監視開始
            if (isEnabled && apiKeySet) {
              startObserving();
            }
          }
        } catch (localStorageError) {
          console.error('直接読み込み中のエラー:', localStorageError);
        }
        
        // 通常の初期化も実行
        initialize();
      }, delayTime);
      
      // 次回のチェックを短い間隔で再実行
      setTimeout(checkExtensionContext, 5000);
    }
  }
  
  // コンテキスト確認を開始
  setTimeout(() => {
    // カウンタをリセット
    sessionStorage.setItem('twitch_deepl_retry_count', '0');
    checkExtensionContext();
  }, 5000); // 初回の確認は5秒後
})();
