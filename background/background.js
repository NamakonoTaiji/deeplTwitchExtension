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
  maxCacheAge: 24, // キャッシュの有効期間（時間）
  processExistingMessages: false, // 既存コメントを処理するかどうか
  requestDelay: 100 // リクエスト間の最小遅延（ミリ秒）
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
  
  // 代替翻訳関数（fetchのみを使用）
  async function translateWithBackupFetch(text, apiKey, sourceLang) {
    // APIキーが空の場合はエラー
    if (!apiKey) {
      stats.errors++;
      return { success: false, error: 'APIキーが設定されていません' };
    }
    
    // APIエンドポイントを決定（フリーアカウントかProアカウントか）
    const apiUrl = apiKey.endsWith(':fx') ? DEEPL_API_FREE_URL : DEEPL_API_PRO_URL;
    
    console.log(`DeepL API バックアップリクエスト送信先: ${apiUrl}`);
    
    // リクエストパラメータの構築
    const requestParams = {
      text: [text],
      target_lang: 'JA'
    };
    
    // ソース言語が指定されている場合は追加
    if (sourceLang && sourceLang !== 'auto') {
      requestParams.source_lang = sourceLang;
    }
    
    try {
      // DeepL APIにリクエスト（異なるオプションでfetchを再試行）
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `DeepL-Auth-Key ${apiKey}`,
          'Accept': 'application/json'
        },
        body: JSON.stringify(requestParams),
        // すべてのオプションを明示的に指定
        cache: 'no-store',
        redirect: 'follow',
        referrerPolicy: 'no-referrer'
      });
      
      // レスポンスのステータスをログに記録
      console.log(`DeepL API バックアップレスポンスステータス: ${response.status}`);
      
      // レスポンスを読み込む
      const responseText = await response.text();
      
      try {
        // JSONとしてパース
        const data = JSON.parse(responseText);
        
        // エラーチェック
        if (!response.ok) {
          stats.errors++;
          console.error('DeepL API バックアップエラー:', response.status, data);
          return { 
            success: false, 
            error: data.message || `バックアップエラー: ${response.status}` 
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
        
        return result;
      } catch (parseError) {
        stats.errors++;
        console.error('DeepL API バックアップレスポンスのJSON解析エラー:', parseError);
        console.error('受信したバックアップレスポンスの先頭部分:', responseText.substring(0, 200));
        
        return { 
          success: false, 
          error: '翻訳結果の解析に失敗しました。サーバーが正しいJSONを返していません。' 
        };
      }
    } catch (error) {
      stats.errors++;
      console.error('バックアップ翻訳中のエラー:', error);
      return { 
        success: false, 
        error: error.message || 'バックアップ翻訳中に予期せぬエラーが発生しました' 
      };
    }
  }
  
  // 翻訳処理のメインロジック
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
        'Accept': 'application/json',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify(requestParams),
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
      redirect: 'follow',
      referrerPolicy: 'no-referrer'
    });
    
    // レスポンスのステータスをログに記録
    console.log(`DeepL API レスポンスステータス: ${response.status}`);
    
    // レスポンスを読み込む
    const responseText = await response.text();
    
    try {
      // JSONとしてパース
      const data = JSON.parse(responseText);
      
      // エラーチェック
      if (!response.ok) {
        stats.errors++;
        console.error('DeepL API エラー:', response.status, data);
        return { 
          success: false, 
          error: data.message || `エラーステータス: ${response.status}` 
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
    } catch (parseError) {
      stats.errors++;
      console.error('DeepL API レスポンスのJSON解析エラー:', parseError);
      console.error('受信したレスポンスの先頭部分:', responseText.substring(0, 200));
      
      return { 
        success: false, 
        error: '翻訳結果の解析に失敗しました。サーバーが正しいJSONを返していません。' 
      };
    }
  } catch (error) {
    console.error('翻訳中のエラー (fetch使用時):', error);
    
    // fetchが失敗した場合は別の設定でfetchを再試行
    console.log('最初のfetchが失敗したため、別の設定で再試行します');
    try {
      const result = await translateWithBackupFetch(text, apiKey, sourceLang);
      return result;
    } catch (retryError) {
      stats.errors++;
      console.error('再試行中のエラー:', retryError);
      return { 
        success: false, 
        error: retryError.message || '翻訳中に予期せぬエラーが発生しました' 
      };
    }
  }
}

// APIキーのテスト
async function testApiKey(apiKey) {
  try {
    // サンプルテキストで翻訳をテスト
    console.log(`APIキーテスト: ${apiKey.substring(0, 5)}...`);
    
    // APIエンドポイントを決定
    const apiUrl = apiKey.endsWith(':fx') ? DEEPL_API_FREE_URL : DEEPL_API_PRO_URL;
    
    // テストリクエストを送信
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `DeepL-Auth-Key ${apiKey}`,
        'Accept': 'application/json',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify({
        text: ['Hello, this is a test.'],
        target_lang: 'JA'
      }),
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
      redirect: 'follow',
      referrerPolicy: 'no-referrer'
    });
    
    console.log(`APIテストレスポンスステータス: ${response.status}`);
    
    // レスポンスをチェック
    if (!response.ok) {
      // レスポンスボディを読み込む
      let errorDetails = '';
      try {
        const errorText = await response.text();
        try {
          const errorData = JSON.parse(errorText);
          errorDetails = JSON.stringify(errorData);
        } catch (jsonError) {
          // JSON解析に失敗した場合はテキストをそのまま使用
          errorDetails = errorText.substring(0, 200); // 最初の200文字だけ表示
        }
      } catch (textError) {
        errorDetails = `レスポンスの読み込みに失敗: ${textError.message}`;
      }
      
      console.error(`APIキーテスト失敗 (${response.status}):`, errorDetails);
      return { valid: false, error: `ステータスコード: ${response.status} - ${errorDetails}` };
    }
    
    // レスポンスをJSONとして解析
    try {
      // レスポンステキストを取得
      const responseText = await response.text();
      
      try {
        // JSONとしてパース
        const data = JSON.parse(responseText);
        
        if (data && data.translations && data.translations.length > 0) {
          console.log('APIキーは有効です');
          return { valid: true };
        } else {
          console.error('APIキーテスト: 無効なレスポンス形式', data);
          return { valid: false, error: '翻訳結果が不正な形式です' };
        }
      } catch (jsonError) {
        console.error('APIキーテスト中のJSONエラー:', jsonError, responseText.substring(0, 200));
        return { valid: false, error: `レスポンスの解析に失敗: ${jsonError.message}` };
      }
    } catch (textError) {
      console.error('APIキーテスト中のレスポンス読み込みエラー:', textError);
      return { valid: false, error: `レスポンスの読み込みに失敗: ${textError.message}` };
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
    // キャッシュチェックを先に行う
    const cachedResult = getCachedTranslation(message.text, message.sourceLang || 'auto');
    if (cachedResult) {
      sendResponse(cachedResult);
      return true;
    }
    
    // 翻訳が無効の場合はエラーを返す
    if (!settings.enabled) {
      // エラーログに詳細情報を追加
      console.warn('翻訳機能が無効になっています。現在のsettings:', settings);
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
    // 設定を再ロード
    initialize();
    
    // 設定更新時のデバッグ情報の追加
    console.log('設定が更新されました:', { 
      enabled: settings.enabled, 
      hasApiKey: !!settings.apiKey,
      translationMode: settings.translationMode
    });
    
    // 現在のセッションIDを記録して、同期問題を回避
    const sessionId = Date.now().toString();
    chrome.storage.local.set({ 'settingsSessionId': sessionId });
    
    sendResponse({ success: true, sessionId });
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
  
  // Content Scriptからの初期化通知
  else if (message.action === 'contentScriptInitialized') {
    console.log('Content Scriptが初期化されました。有効状態:', message.enabled);
    // 必要に応じてsettingsの再同期を行うことも可能
    sendResponse({ success: true });
    return true;
  }
  
  // Pingリクエスト - 拡張機能コンテキストの有効性確認用
  else if (message.action === 'ping') {
    sendResponse({ success: true, message: 'pong' });
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