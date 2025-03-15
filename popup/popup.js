document.addEventListener('DOMContentLoaded', async () => {
  const statusElement = document.getElementById('status');
  const apiStatusElement = document.getElementById('api-status');
  const enableTranslationCheckbox = document.getElementById('enableTranslation');
  const openOptionsButton = document.getElementById('openOptions');

  // 設定を読み込む
  const { enabled, apiKey } = await chrome.storage.sync.get({
    enabled: false,
    apiKey: ''
  });

  // UIを更新
  enableTranslationCheckbox.checked = enabled;
  updateStatusText(enabled);
  checkApiKey(apiKey);

  // トグルスイッチのイベントリスナー
  enableTranslationCheckbox.addEventListener('change', async () => {
    const newEnabled = enableTranslationCheckbox.checked;
    await chrome.storage.sync.set({ enabled: newEnabled });
    updateStatusText(newEnabled);
    
    // content scriptに状態変更を通知
    const tabs = await chrome.tabs.query({ url: '*://*.twitch.tv/*' });
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { action: 'toggleTranslation', enabled: newEnabled });
    });
  });

  // 設定ボタンのイベントリスナー
  openOptionsButton.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // ステータステキストの更新
  function updateStatusText(enabled) {
    statusElement.textContent = enabled ? '有効' : '無効';
    statusElement.className = enabled ? 'success' : '';
  }

  // APIキーのチェック
  async function checkApiKey(apiKey) {
    if (!apiKey) {
      apiStatusElement.textContent = 'DeepL API: キーが未設定です';
      apiStatusElement.className = 'error';
      return;
    }

    try {
      // バックグラウンドスクリプトにAPIキーチェックをリクエスト
      const response = await chrome.runtime.sendMessage({ action: 'checkApiKey' });
      
      if (response.valid) {
        apiStatusElement.textContent = 'DeepL API: 接続OK';
        apiStatusElement.className = 'success';
      } else {
        apiStatusElement.textContent = `DeepL API: ${response.error || 'エラー'}`;
        apiStatusElement.className = 'error';
      }
    } catch (error) {
      apiStatusElement.textContent = 'DeepL API: 確認できませんでした';
      apiStatusElement.className = 'error';
      console.error('API確認中のエラー:', error);
    }
  }
});
