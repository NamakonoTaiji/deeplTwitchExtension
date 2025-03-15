// DeepL API関連の定数
const DEEPL_API_FREE_URL = 'https://api-free.deepl.com/v2/translate';
const DEEPL_API_PRO_URL = 'https://api.deepl.com/v2/translate';

// APIリクエストの管理
let pendingRequests = 0;
const MAX_CONCURRENT_REQUESTS = 5;
const requestQueue = [];

// 設定データをロード
let settings = {
  apiKey: '',
  enabled: false
};

// 初期化処理
async function initialize() {
  // 保存された設定を読み込む
  const result = await chrome.storage.sync.get({
    apiKey: '',
    enabled: false
  });
  
  settings = result;
  console.log('Twitch DeepL Translator: バックグラウンドスクリプト初期化完了');
}

// DeepL APIを使用してテキストを翻訳
async function translateText(text, apiKey) {
  // XMLHttpRequestを使用した翻訳関数
  function translateWithXHR(text, apiKey) {
    return new Promise((resolve, reject) => {
      // APIキーが空の場合はエラー
      if (!apiKey) {
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
            resolve({
              success: true,
              translatedText: data.translations[0].text
            });
          } catch (error) {
            reject(new Error('レスポンスの解析中にエラーが発生しました'));
          }
        } else {
          try {
            const errorData = JSON.parse(xhr.responseText);
            reject(new Error(errorData.message || `エラーステータス: ${xhr.status}`));
          } catch (e) {
            reject(new Error(`エラーステータス: ${xhr.status}`));
          }
        }
      };
      
      xhr.onerror = function() {
        reject(new Error('DeepL APIへの接続に失敗しました'));
      };
      
      xhr.send(JSON.stringify({
        text: [text],
        target_lang: 'JA',
        source_lang: 'EN'
      }));
    });
  }
  
  // まずfetchを試し、失敗した場合はXMLHttpRequestを使用
  try {
    // APIキーが空の場合はエラー
    if (!apiKey) {
      return { success: false, error: 'APIキーが設定されていません' };
    }
    
    // APIエンドポイントを決定（フリーアカウントかProアカウントか）
    const apiUrl = apiKey.endsWith(':fx') ? DEEPL_API_FREE_URL : DEEPL_API_PRO_URL;
    
    console.log(`DeepL API リクエスト送信先: ${apiUrl}`);
    
    // DeepL APIにリクエスト
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `DeepL-Auth-Key ${apiKey}`,
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        text: [text],
        target_lang: 'JA',
        source_lang: 'EN'
      }),
      credentials: 'omit',
      mode: 'cors'
    });
    
    // レスポンスのステータスをログに記録
    console.log(`DeepL API レスポンスステータス: ${response.status}`);
    
    // レスポンスをJSONとしてパース
    const data = await response.json();
    
    // エラーチェック
    if (!response.ok) {
      console.error('DeepL API エラー:', data);
      return { 
        success: false, 
        error: data.message || '翻訳中にエラーが発生しました' 
      };
    }
    
    // 翻訳結果を返す
    return {
      success: true,
      translatedText: data.translations[0].text
    };
  } catch (error) {
    console.error('翻訳中のエラー (fetch使用時):', error);
    
    // fetchが失敗した場合はXMLHttpRequestを代替手段として使用
    console.log('fetchが失敗したため、XMLHttpRequestを使用して再試行します');
    try {
      const result = await translateWithXHR(text, apiKey);
      return result;
    } catch (xhrError) {
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
    
    translateText(nextRequest.text, settings.apiKey)
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
});

// 初期化の実行
initialize();
