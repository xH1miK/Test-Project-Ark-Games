/* Single-file loader for the packed Cocos Creator web-mobile build (see tools/pack/pack.mjs).
 *
 * The page carries the build as two base64 blobs:
 *   #zm-z  gzip of every compressible file (js, json, css, wasm, ...)
 *   #zm-r  raw bytes of already-compressed media (png, jpg, webp, mp3, ...)
 * and a file table window.__ZM_FILES__ = [[path, section(0 = z, 1 = r), offset, size], ...].
 *
 * Boot: decode both blobs -> make every URL the engine asks for resolve to a blob: URL of the
 * embedded file (hooks on XMLHttpRequest.open, fetch and the src setters of script / img / media
 * elements) -> wait for MRAID `ready` if present -> run polyfills + SystemJS with an inline
 * import map -> System.import('./index.js'), exactly like the stock index.html.
 * Nothing is requested from the network.
 */
(function () {
  'use strict';
  var CFG = window.__ZM_CFG__ || {};
  var TABLE = window.__ZM_FILES__ || [];
  var T = (window.__ZM_TIMING__ = { start: performance.now() });
  var files = {};
  var paths = [];
  var blobUrls = {};

  var MIME = {
    js: 'text/javascript', json: 'application/json', css: 'text/css', txt: 'text/plain', html: 'text/html',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'video/mp4',
    wasm: 'application/wasm', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  };

  function fail(err) {
    console.error('[zm] boot failed', err);
    var el = document.getElementById('zm-loading');
    if (el) el.setAttribute('data-error', String((err && err.message) || err));
  }

  function takeBase64(id) {
    var el = document.getElementById(id);
    var s = el ? el.textContent : '';
    if (el) el.parentNode.removeChild(el);
    if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(s);
    var bin = atob(s);
    var n = bin.length;
    var out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function gunzip(bytes) {
    var forceJs = CFG.forceJsInflate || /[?&]zm-inflate=js\b/.test(location.search);
    if (!forceJs && typeof DecompressionStream === 'function') {
      try {
        var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        return new Response(stream).arrayBuffer().then(function (ab) {
          return new Uint8Array(ab);
        });
      } catch (e) {
        /* fall back to the JS inflate */
      }
    }
    T.jsInflate = true;
    return Promise.resolve(zmGunzip(bytes));
  }

  // ---- virtual file system ----------------------------------------------------------------

  function lookup(url) {
    if (url == null) return null;
    var s = String(url);
    if (/^(blob|data):/i.test(s)) return null;
    s = s.split('#')[0].split('?')[0].replace(/\\/g, '/');
    try {
      s = decodeURI(s);
    } catch (e) {
      /* keep as is */
    }
    if (files[s]) return s;
    var rel = s.replace(/^\.?\//, '');
    if (files[rel]) return rel;
    // Absolute or ../ URL: the longest embedded path that is a suffix of it (paths is sorted by length).
    for (var i = 0; i < paths.length; i++) {
      var p = paths[i];
      var cut = s.length - p.length;
      if (cut > 0 && s.slice(cut) === p && (s.charAt(cut - 1) === '/' || s.charAt(cut - 1) === ':')) return p;
    }
    return null;
  }

  function blobUrl(path) {
    var u = blobUrls[path];
    if (!u) {
      var ext = (/\.([a-z0-9]+)$/i.exec(path) || [])[1];
      var type = MIME[(ext || '').toLowerCase()] || 'application/octet-stream';
      u = blobUrls[path] = URL.createObjectURL(new Blob([files[path]], { type: type }));
    }
    return u;
  }

  function mapUrl(url) {
    var p = lookup(url);
    if (p) return blobUrl(p);
    if (/^https?:/i.test(String(url))) console.warn('[zm] request outside the package:', url);
    return url;
  }

  function installHooks() {
    var xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function () {
      var args = Array.prototype.slice.call(arguments); // keep arity: open(m, u) != open(m, u, undefined)
      args[1] = mapUrl(args[1]);
      return xhrOpen.apply(this, args);
    };

    if (typeof window.fetch === 'function') {
      var nativeFetch = window.fetch;
      window.fetch = function (input, init) {
        if (typeof input === 'string' || (typeof URL === 'function' && input instanceof URL)) {
          return nativeFetch.call(this, mapUrl(String(input)), init);
        }
        if (input && input.url) {
          var mapped = mapUrl(input.url);
          if (mapped !== input.url) return nativeFetch.call(this, mapped, init);
        }
        return nativeFetch.apply(this, arguments);
      };
    }

    var hookSrc = function (Ctor) {
      var d = Ctor && Object.getOwnPropertyDescriptor(Ctor.prototype, 'src');
      if (!d || !d.set) return;
      Object.defineProperty(Ctor.prototype, 'src', {
        configurable: true,
        enumerable: d.enumerable,
        get: d.get,
        set: function (v) {
          d.set.call(this, mapUrl(v));
        },
      });
    };
    hookSrc(window.HTMLScriptElement);
    hookSrc(window.HTMLImageElement);
    hookSrc(window.HTMLMediaElement);
    hookSrc(window.HTMLSourceElement);

    var setAttr = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (name === 'src' && /^(SCRIPT|IMG|AUDIO|VIDEO|SOURCE)$/.test(this.tagName)) value = mapUrl(value);
      return setAttr.call(this, name, value);
    };
  }

  // Rendering at DPR 3 costs a lot of fill rate on phones for little visible gain.
  function capDevicePixelRatio() {
    var max = CFG.maxDpr || 2;
    var real = window.devicePixelRatio || 1;
    if (real <= max) return;
    try {
      Object.defineProperty(window, 'devicePixelRatio', {
        configurable: true,
        get: function () {
          return max;
        },
      });
    } catch (e) {
      /* read-only in this browser */
    }
  }

  function whenMraidReady(cb) {
    var done = false;
    var go = function () {
      if (!done) {
        done = true;
        cb();
      }
    };
    var m = window.mraid;
    try {
      if (!m || typeof m.getState !== 'function' || m.getState() !== 'loading') return go();
      m.addEventListener('ready', go);
    } catch (e) {
      return go();
    }
    setTimeout(go, CFG.mraidTimeout || 1500);
  }

  function text(path) {
    return new TextDecoder().decode(files[path]);
  }

  function inlineScript(code, type) {
    var s = document.createElement('script');
    if (type) s.type = type;
    s.text = code;
    document.head.appendChild(s);
    return s;
  }

  function hideLoaderOnFirstFrames() {
    var el = document.getElementById('zm-loading');
    var tick = function () {
      var cc = window.cc;
      var frames = cc && cc.director && cc.director.getTotalFrames ? cc.director.getTotalFrames() : 0;
      if (frames > 2) {
        T.firstFrames = performance.now();
        if (el) el.parentNode.removeChild(el);
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function boot() {
    T.boot = performance.now();
    // The import map must be in the DOM before SystemJS initialises (it scans once on load).
    inlineScript(JSON.stringify(CFG.importMap || { imports: {} }), 'systemjs-importmap');
    for (var i = 0; i < CFG.scripts.length; i++) inlineScript(text(CFG.scripts[i]));
    window.System.import(CFG.entry).catch(fail);
    hideLoaderOnFirstFrames();
  }

  try {
    var z = takeBase64('zm-z');
    var r = takeBase64('zm-r');
    T.base64 = performance.now();
    gunzip(z)
      .then(function (zBytes) {
        T.inflate = performance.now();
        for (var i = 0; i < TABLE.length; i++) {
          var e = TABLE[i];
          files[e[0]] = (e[1] ? r : zBytes).subarray(e[2], e[2] + e[3]);
          paths.push(e[0]);
        }
        paths.sort(function (a, b) {
          return b.length - a.length;
        });
        installHooks();
        capDevicePixelRatio();
        whenMraidReady(boot);
      })
      .catch(fail);
  } catch (e) {
    fail(e);
  }
})();
