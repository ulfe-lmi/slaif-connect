document.getElementById('start-dev')?.addEventListener('click', () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL('html/session.html?dev=1'),
  });
});
