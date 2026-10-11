mergeInto(LibraryManager.library, {
  Voyager_Download: function(bytes, length, filename) {
    var url = URL.createObjectURL(new Blob([HEAPU8.slice(bytes, bytes + length)], {type: 'image/png'}));
    var link = document.createElement('a');
    link.href = url; link.download = UTF8ToString(filename);
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(function() { URL.revokeObjectURL(url); }, 10000);
  },
  Voyager_Ready: function() {
    document.documentElement.dataset.gameReady = 'true';
    window.dispatchEvent(new Event('voyager-ready'));
  },
  Voyager_Message: function(message) {
    window.dispatchEvent(new CustomEvent('voyager-message', {detail: UTF8ToString(message)}));
  }
});
