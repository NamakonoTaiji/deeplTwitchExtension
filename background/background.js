// DeepL API関連の定数
const DEEPL_API_FREE_URL = 'https://api-free.deepl.com/v2/translate';
const DEEPL_API_PRO_URL = 'https://api.deepl.com/v2/translate';

// APIリクエストの管理
let pendingRequests = 0;
const MAX_CONCURRENT_REQUESTS = 5;
const requestQueue = [];

// 翻訳キャッシュ
const translationCache = new Map();
const MAX_CACHE_SIZE = 1000; // 最大キャッシュサイズ

// 設定データのデフォルト値
const defaultSettings = {
  apiKey: '',
  enabled: false,
  translationMode: 'selective',
  japaneseThreshold: 30,
  englishThreshold: 50,
  displayPrefix: '🇯🇵',
  textColor: '#9b9b9b',
  accentColor: '#9147ff',
  fontSize: 'medium',
  useCache: true, // キャッシュ機能の有効/無効
  maxCacheAge: 24 // キャッシュの有効期間（時間）
};

// 設定データをロード
let settings = { ...defaultSettings };

// 統計情報
let stats = {
  totalRequests: 0,
  cacheHits: 0,
  apiRequests: 0,
  errors: 0,
  charactersTranslated: 0,
  lastReset: Date.now()
};

// 初期化処理
async function initialize() {
  // 保存された設定を読み込む
  const result = await chrome.storage.sync.get(defaultSettings);
  
  settings = result;
  console.log('Twitch DeepL Translator: バックグラウンドスクリプト初期化完了');
  console.log('現在の設定:', settings);
  
  // 統計情報を読み込む
  try {
    const savedStats = await chrome.storage.local.get('translationStats');
    if (savedStats.translationStats) {
      stats = savedStats.translationStats;
    }
  } catch (error) {
    console.error('統計情報の読み込みに失敗:', error);
  }
  
  // 古いキャッシュデータをロード
  if (settings.useCache) {
    try {
      const savedCache = await chrome.storage.local.get('translationCache');
      if (savedCache.translationCache) {
        const now = Date.now();
        const maxAge = settings.maxCacheAge * 60 * 60 * 1000; // 時間をミリ秒に変換
        
        // 期限内のキャッシュのみ復元
        Object.entries(savedCache.translationCache).forEach(([key, entry]) => {
          if (now - entry.timestamp < maxAge) {
            translationCache.set(key, entry);
          }
        });
        
        console.log(`${translationCache.size}件のキャッシュをロードしました`);
      }
    } catch (error) {
      console.error('キャッシュの読み込みに失敗:', error);
    }
  }
}

// キャッシュを保存
async function saveCache() {
  if (!settings.useCache || translationCache.size === 0) {
    return;
  }
  
  try {
    // MapオブジェクトをObjectに変換
    const cacheObject = {};
    translationCache.forEach((value, key) => {
      cacheObject[key] = value;
    });
    
    await chrome.storage.local.set({ translationCache: cacheObject });
    console.log(`${translationCache.size}件のキャッシュを保存しました`);
  } catch (error) {
    console.error('キャッシュの保存に失敗:', error);
  }
}

// 統計情報を保存
async function saveStats() {
  try {
    await chrome.storage.local.set({ translationStats: stats });
  } catch (error) {
    console.error('統計情報の保存に失敗:', error);
  }
}

// キャッシュからの翻訳取得
function getCachedTranslation(text, sourceLang) {
  if (!settings.useCache) {
    return null;
  }
  
  const cacheKey = `${sourceLang}:${text}`;
  const cachedEntry = translationCache.get(cacheKey);
  
  if (!cachedEntry) {
    return null;
  }
  
  // キャッシュの有効期限をチェック
  const now = Date.now();
  const maxAge = settings.maxCacheAge * 60 * 60 * 1000; // 時間をミリ秒に変換
  
  if (now - cachedEntry.timestamp > maxAge) {
    // 期限切れのキャッシュを削除
    translationCache.delete(cacheKey);
    return null;
  }
  
  // キャッシュヒットの統計を更新
  stats.totalRequests++;
  stats.cacheHits++;
  
  // キャッシュのタイムスタンプを更新（アクセス時間の更新）
  cachedEntry.timestamp = now;
  translationCache.set(cacheKey, cachedEntry);
  
  return cachedEntry.translation;
}

// キャッシュに翻訳を保存
function cacheTranslation(text, sourceLang, translationResult) {
  if (!settings.useCache || !translationResult.success) {
    return;
  }
  
  const cacheKey = `${sourceLang}:${text}`;
  
  // キャッシュが最大サイズに達した場合、最も古いエントリを削除
  if (translationCache.size >= MAX_CACHE_SIZE) {
    let oldestKey = null;
    let oldestTime = Date.now();
    
    translationCache.forEach((entry, key) => {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    });
    
    if (oldestKey) {
      translationCache.delete(oldestKey);
    }
  }
  
  // 新しい翻訳をキャッシュに追加
  translationCache.set(cacheKey, {
    translation: translationResult,
    timestamp: Date.now()
  });
  
  // 30分ごとにキャッシュを保存
  const now = Date.now();
  if (now - lastCacheSave > 30 * 60 * 1000) {
    saveCache();
    lastCacheSave = now;
  }
}

// 最後にキャッシュを保存した時間
let lastCacheSave = Date.now();

// DeepL APIを使用してテキストを翻訳
async function translateText(text, apiKey, sourceLang = 'EN') {
  // 統計情報を更新
  stats.totalRequests++;
  
  // キャッシュをチェック
  const cachedResult = getCachedTranslation(text, sourceLang);
  if (cachedResult) {
    return cachedResult;
  }
  
  // API呼び出しの統計を更新
  stats.apiRequests++;
  stats.charactersTranslated += text.length;
  
  // XMLHttpRequestを使用した翻訳関数
  function translateWithXHR(text, apiKey, sourceLang) {
    return new Promise((resolve, reject) => {
      // APIキーが空の場合はエラー
      if (!apiKey) {
        stats.errors++;
        reject(new Error('APIキーが設定されていません'));
        return;
      }
      
      // APIエンドポイントを決定（フリーアカウントかProアカウントか）
      const apiUrl = apiKey.endsWith(':fx') ? DEEPL_API_FREE_URL : DEEPL_API_PRO_URL;
      
      const xhr = new XMLHttpRequest();
      xhr.open('POST', apiUrl, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Authorization', `DeepL-Auth-Key ${apiKey}`);
      xhr.setRequestHeader('Accept', 'application/json');
      
      xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            const result = {
              success: true,
              translatedText: data.translations[0].text,
              detectedLanguage: data.translations[0].detected_source_language
            };
            
            // 翻訳結果をキャッシュに保存
            cacheTranslation(text, sourceLang, result);
            
            resolve(result);
          } catch (error) {
            stats.errors++;
            reject(new Error('レスポンスの解析中にエラーが発生しました'));
          }
        } else {
          stats.errors++;
          try {
            const errorData = JSON.parse(xhr.responseText);
            reject(new Error(errorData.message || `エラーステータス: ${xhr.status}`));
          } catch (e) {
            reject(new Error(`エラーステータス: ${xhr.status}`));
          }
        }
      };
      
      xhr.onerror = function() {
        stats.errors++;
        reject(new Error('DeepL APIへの接続に失敗しました'));
      };
      
      // リクエストパラメータの構築
      const requestParams = {
        text: [text],
        target_lang: 'JA'
      };
      
      // ソース言語が指定されている場合は追加
      if (sourceLang && sourceLang !== 'auto') {
        requestParams.source_lang = sourceLang;
      }
      
      xhr.send(JSON.stringify(requestParams));
    });
  }
  
  // まずfetchを試し、失敗した場合はXMLHttpRequestを使用
  try {
    // APIキーが空の場合はエラー
    if (!apiKey) {
      stats.errors++;
      return { success: false, error: 'APIキーが設定されていません' };
    }
    
    // APIエンドポイントを決定（フリーアカウントかProアカウントか）
    const apiUrl = apiKey.endsWith(':fx') ? DEEPL_API_FREE_URL : DEEPL_API_PRO_URL;
    
    console.log(`DeepL API リクエスト送信先: ${apiUrl}`);
    
    // リクエストパラメータの構築
    const requestParams = {
      text: [text],
      target_lang: 'JA'
    };
    
    // ソース言語が指定されている場合は追加
    if (sourceLang && sourceLang !== 'auto') {
      requestParams.source_lang = sourceLang;
    }
    
    // DeepL APIにリクエスト
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `DeepL-Auth-Key ${apiKey}`,
        'Accept': 'application/json'
      },
      body: JSON.stringify(requestParams),
      credentials: 'omit',
      mode: 'cors'
    });
    
    // レスポンスのステータスをログに記録
    console.log(`DeepL API レスポンスステータス: ${response.status}`);
    
    // レスポンスをJSONとしてパース
    const data = await response.json();
    
    // エラーチェック
    if (!response.ok) {
      stats.errors++;
      console.error('DeepL API エラー:', data);
      return { 
        success: false, 
        error: data.message || '翻訳中にエラーが発生しました' 
      };
    }
    
    // 翻訳結果
    const result = {
      success: true,
      translatedText: data.translations[0].text,
      detectedLanguage: data.translations[0].detected_source_language
    };
    
    // 翻訳結果をキャッシュに保存
    cacheTranslation(text, sourceLang, result);
    
    // 統計情報を保存（10回に1回）
    if (stats.totalRequests % 10 === 0) {
      saveStats();
    }
    
    return result;
  } catch (error) {
    console.error('翻訳中のエラー (fetch使用時):', error);
    
    // fetchが失敗した場合はXMLHttpRequestを代替手段として使用
    console.log('fetchが失敗したため、XMLHttpRequestを使用して再試行します');
    try {
      const result = await translateWithXHR(text, apiKey, sourceLang);
      return result;
    } catch (xhrError) {
      stats.errors++;
      console.error('翻訳中のエラー (XMLHttpRequest使用時):', xhrError);
      return { 
        success: false, 
        error: xhrError.message || '翻訳中に予期せぬエラーが発生しました' 
      };
    }
  }
}

// APIキーのテスト
async function testApiKey(apiKey) {
  try {
    // サンプルテキストで翻訳をテスト
    console.log(`APIキーテスト: ${apiKey.substring(0, 5)}...`);
    const testResult = await translateText('Hello, this is a test.', apiKey);
    
    if (testResult.success) {
      console.log('APIキーは有効です');
      return { valid: true };
    } else {
      console.error('APIキーテスト失敗:', testResult.error);
      return { valid: false, error: testResult.error };
    }
  } catch (error) {
    console.error('APIキーテスト中のエラー:', error);
    return { valid: false, error: error.message };
  }
}

// リクエストキューの処理
function processQueue() {
  if (pendingRequests < MAX_CONCURRENT_REQUESTS && requestQueue.length > 0) {
    const nextRequest = requestQueue.shift();
    pendingRequests++;
    
    translateText(nextRequest.text, settings.apiKey, nextRequest.sourceLang)
      .then(result => {
        nextRequest.resolve(result);
      })
      .catch(error => {
        nextRequest.reject(error);
      })
      .finally(() => {
        pendingRequests--;
        // 次のリクエストを処理
        processQueue();
      });
  }
}

// 統計情報のリセット
function resetStats() {
  stats = {
    totalRequests: 0,
    cacheHits: 0,
    apiRequests: 0,
    errors: 0,
    charactersTranslated: 0,
    lastReset: Date.now()
  };
  
  saveStats();
}

// メッセージリスナーの設定
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 翻訳リクエスト
  if (message.action === 'translate') {
    // 翻訳が無効の場合はエラーを返す
    if (!settings.enabled) {
      sendResponse({ success: false, error: '翻訳機能が無効になっています' });
      return true;
    }
    
    // APIキーが設定されていない場合はエラーを返す
    if (!settings.apiKey) {
      sendResponse({ success: false, error: 'DeepL APIキーが設定されていません' });
      return true;
    }

    // 新しいリクエストをキューに追加
    const promise = new Promise((resolve, reject) => {
      requestQueue.push({
        text: message.text,
        sourceLang: message.sourceLang || 'auto',
        resolve,
        reject
      });
    });
    
    // キューの処理を開始
    processQueue();
    
    // 非同期で応答を返す
    promise.then(sendResponse).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    
    return true; // 非同期応答のために必要
  }
  
  // 設定の取得
  else if (message.action === 'getSettings') {
    sendResponse(settings);
    return true;
  }
  
  // APIキーのテスト
  else if (message.action === 'testApiKey') {
    testApiKey(message.apiKey).then(sendResponse);
    return true; // 非同期応答のために必要
  }
  
  // 現在のAPIキーの有効性チェック
  else if (message.action === 'checkApiKey') {
    if (!settings.apiKey) {
      sendResponse({ valid: false, error: 'APIキーが設定されていません' });
    } else {
      testApiKey(settings.apiKey).then(sendResponse);
    }
    return true; // 非同期応答のために必要
  }
  
  // 設定更新の通知
  else if (message.action === 'settingsUpdated') {
    initialize(); // 設定をリロード
    sendResponse({ success: true });
    return true;
  }
  
  // 翻訳統計の取得
  else if (message.action === 'getStats') {
    sendResponse({
      success: true,
      stats: {
        ...stats,
        cacheSize: translationCache.size
      }
    });
    return true;
  }
  
  // 統計情報のリセット
  else if (message.action === 'resetStats') {
    resetStats();
    sendResponse({ success: true });
    return true;
  }
  
  // キャッシュのクリア
  else if (message.action === 'clearCache') {
    translationCache.clear();
    chrome.storage.local.remove('translationCache');
    sendResponse({ 
      success: true, 
      message: 'キャッシュをクリアしました' 
    });
    return true;
  }
});

// 拡張機能のアンロード時にキャッシュを保存
chrome.runtime.onSuspend.addListener(() => {
  saveCache();
  saveStats();
});

// 1時間ごとにキャッシュと統計情報を保存
setInterval(() => {
  saveCache();
  saveStats();
}, 60 * 60 * 1000);

// 初期化の実行
initialize();
