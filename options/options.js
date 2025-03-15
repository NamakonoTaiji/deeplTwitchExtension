document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyInput = document.getElementById('apiKey');
  const saveButton = document.getElementById('saveButton');
  const testButton = document.getElementById('testButton');
  const statusMessage = document.getElementById('status-message');
  const translationEnabledCheckbox = document.getElementById('translationEnabled');
  
  // 保存された設定を読み込む
  const { apiKey, enabled } = await chrome.storage.sync.get({
    apiKey: '',
    enabled: false
  });
  
  // UIを初期状態に設定
  apiKeyInput.value = apiKey;
  translationEnabledCheckbox.checked = enabled;
  
  // 保存ボタンのイベントリスナー
  saveButton.addEventListener('click', async () => {
    const newApiKey = apiKeyInput.value.trim();
    
    // 設定を保存
    await chrome.storage.sync.set({ 
      apiKey: newApiKey,
      enabled: translationEnabledCheckbox.checked
    });
    
    // ステータスメッセージを表示
    showStatusMessage('設定を保存しました', 'success');
    
    // バックグラウンドスクリプトに設定変更を通知
    chrome.runtime.sendMessage({ action: 'settingsUpdated' });
  });
  
  // APIテストボタンのイベントリスナー
  testButton.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    
    if (!apiKey) {
      showStatusMessage('APIキーを入力してください', 'error');
      return;
    }
    
    try {
      // APIテストを実行
      const response = await testDeeplApi(apiKey);
      
      if (response.valid) {
        showStatusMessage('APIキーは有効です！接続に成功しました。', 'success');
      } else {
        showStatusMessage(`APIテストに失敗しました: ${response.error || '不明なエラー'}`, 'error');
      }
    } catch (error) {
      showStatusMessage('APIテスト中にエラーが発生しました', 'error');
      console.error('APIテスト中のエラー:', error);
    }
  });
  
  // 翻訳有効化チェックボックスのイベントリスナー
  translationEnabledCheckbox.addEventListener('change', async () => {
    const newEnabled = translationEnabledCheckbox.checked;
    await chrome.storage.sync.set({ enabled: newEnabled });
    
    // ステータスメッセージを表示
    const status = newEnabled ? '有効' : '無効';
    showStatusMessage(`翻訳機能を${status}にしました`, 'success');
    
    // content scriptに状態変更を通知
    const tabs = await chrome.tabs.query({ url: '*://*.twitch.tv/*' });
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { action: 'toggleTranslation', enabled: newEnabled });
    });
  });
  
  // ステータスメッセージの表示
  function showStatusMessage(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type}`;
    
    // 3秒後にメッセージを非表示にする
    setTimeout(() => {
      statusMessage.className = 'status-message';
    }, 3000);
  }
  
  // DeepL APIのテスト
  async function testDeeplApi(apiKey) {
    try {
      // バックグラウンドスクリプトにAPIテストをリクエスト
      return await chrome.runtime.sendMessage({ 
        action: 'testApiKey', 
        apiKey 
      });
    } catch (error) {
      console.error('APIテスト中のエラー:', error);
      return { valid: false, error: error.message };
    }
  }
});
