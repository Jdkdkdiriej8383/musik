// ==========================================
// Musik 2.0 - Frontend Application Engine
// With Personal Wave ("Мой поток"), Playlist Import,
// Dislikes & Multi-device Account Sync
// ==========================================

class MusikApp {
  constructor() {
    this.audio = document.getElementById("audioElement");
    // Background preloader audio element for instant zero-latency transitions
    this.preloaderAudio = new Audio();
    this.preloaderAudio.preload = "auto";

    // Auth & User State
    this.token = localStorage.getItem("musik_token") || null;
    this.currentUser = null;

    // Automatically purge old offline local tokens so user is always connected to cloud Supabase
    if (this.token && this.token.startsWith("local_token_")) {
      localStorage.removeItem("musik_token");
      localStorage.removeItem("musik_user");
      localStorage.removeItem("musik_local_users");
      this.token = null;
    }

    // Multi-Backend Support & Automatic Failover Engine
    this.defaultBackends = [
      "https://musik-5a7a.onrender.com",
      "https://musik-npzp.onrender.com"
    ];
    let storedBackend = localStorage.getItem("musik_api_backend");

    // Automatically migrate from old suspended instance if previously stored
    if (storedBackend === "https://musik-npzp.onrender.com") {
      storedBackend = "https://musik-5a7a.onrender.com";
      localStorage.setItem("musik_api_backend", storedBackend);
    }

    this.backendList = [...this.defaultBackends];
    if (storedBackend && storedBackend.startsWith("http") && !this.backendList.includes(storedBackend)) {
      this.backendList.unshift(storedBackend);
    }

    // Determine if running directly from an active local Python server (port 8000)
    const isPort8000 = window.location.port === "8000";
    const isLocalHost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    const isLocalServer = isLocalHost && isPort8000;

    if (isLocalServer) {
      this.apiBase = "";
    } else {
      // For GitHub Pages, file:// protocol, Live Server, or other hosts, ALWAYS use the active remote backend
      this.apiBase = storedBackend || this.backendList[0];
    }
    this.currentBackendIndex = Math.max(0, this.backendList.indexOf(this.apiBase));

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has("api")) {
      const pApi = urlParams.get("api").replace(/\/$/, "");
      this.apiBase = pApi;
      if (!this.backendList.includes(pApi)) {
        this.backendList.unshift(pApi);
      }
      this.currentBackendIndex = this.backendList.indexOf(pApi);
      localStorage.setItem("musik_api_backend", this.apiBase);
    }

    // Library State (Synced with Backend DB)
    this.favorites = [];
    this.dislikes = [];
    this.history = [];

    // Wave / "Мой поток" State
    this.isWaveActive = false;
    this.waveMode = "default";
    this.waveQueue = [];
    this.waveIndex = -1;
    this.isLoadingWave = false;

    // General Player State
    this.currentTrack = null;
    this.queue = [];
    this.queueIndex = -1;
    this.isPlaying = false;
    this.isBuffering = false;
    this.isShuffle = false;
    this.repeatMode = 0; // 0 = off, 1 = all, 2 = one
    this.volume = parseFloat(localStorage.getItem("musik_volume") || "0.8");

    // Lyrics State
    this.lyricsData = [];
    this.currentLyricIndex = -1;
    this.lyricsOpen = false;

    // Auth Modal State
    this.authMode = "login"; // 'login' or 'register'

    // Offline & Preload Buffer State
    this.isOnline = navigator.onLine;
    this.isOfflineFallbackActive = false;
    this.savedOnlineQueue = [];
    this.savedOnlineQueueIndex = 0;

    // DOM Elements Cache
    this.dom = {
      // Views
      waveView: document.getElementById("waveView"),
      homeView: document.getElementById("homeView"),
      searchView: document.getElementById("searchView"),
      favoritesView: document.getElementById("favoritesView"),
      dislikesView: document.getElementById("dislikesView"),

      // Nav & Topbar
      userCard: document.getElementById("userCard"),
      userAvatar: document.getElementById("userAvatar"),
      userName: document.getElementById("userName"),
      userStatus: document.getElementById("userStatus"),
      userActionBtn: document.getElementById("userActionBtn"),
      favCountPill: document.getElementById("favCountPill"),
      dislikeCountPill: document.getElementById("dislikeCountPill"),
      searchInput: document.getElementById("searchInput"),
      searchClearBtn: document.getElementById("searchClearBtn"),
      countrySelect: document.getElementById("countrySelect"),
      topbarImportBtn: document.getElementById("topbarImportBtn"),
      sidebarImportBtn: document.getElementById("sidebarImportBtn"),

      // Wave View
      startWaveBtn: document.getElementById("startWaveBtn"),
      startWaveBtnText: document.getElementById("startWaveBtnText"),
      refreshWaveBtn: document.getElementById("refreshWaveBtn"),
      waveTrackList: document.getElementById("waveTrackList"),
      waveLikesCount: document.getElementById("waveLikesCount"),
      waveDislikesCount: document.getElementById("waveDislikesCount"),
      waveTopGenres: document.getElementById("waveTopGenres"),

      // Home & Search
      trendingGrid: document.getElementById("trendingGrid"),
      searchTrackList: document.getElementById("searchTrackList"),
      searchQueryLabel: document.getElementById("searchQueryLabel"),
      searchResultsCount: document.getElementById("searchResultsCount"),
      heroWaveBtn: document.getElementById("heroWaveBtn"),
      heroPlayBtn: document.getElementById("heroPlayBtn"),
      heroImportBtn: document.getElementById("heroImportBtn"),

      // Favorites & Dislikes Lists
      favoritesTrackList: document.getElementById("favoritesTrackList"),
      dislikesTrackList: document.getElementById("dislikesTrackList"),
      playAllFavsBtn: document.getElementById("playAllFavsBtn"),

      // Player Controls
      playerCover: document.getElementById("playerCover"),
      playerTitle: document.getElementById("playerTitle"),
      playerArtist: document.getElementById("playerArtist"),
      playerCoverWrapper: document.getElementById("playerCoverWrapper"),
      playerLikeBtn: document.getElementById("playerLikeBtn"),
      playerDislikeBtn: document.getElementById("playerDislikeBtn"),
      playBtn: document.getElementById("playBtn"),
      prevBtn: document.getElementById("prevBtn"),
      nextBtn: document.getElementById("nextBtn"),
      shuffleBtn: document.getElementById("shuffleBtn"),
      repeatBtn: document.getElementById("repeatBtn"),
      repeatOneIndicator: document.querySelector(".repeat-one-indicator"),
      playerSpinner: document.getElementById("playerSpinner"),
      playIcon: document.querySelector(".play-icon"),
      pauseIcon: document.querySelector(".pause-icon"),

      // Sliders
      progressWrapper: document.getElementById("progressWrapper"),
      progressFill: document.getElementById("progressFill"),
      progressBuffer: document.getElementById("progressBuffer"),
      currentTime: document.getElementById("currentTime"),
      totalDuration: document.getElementById("totalDuration"),
      volumeWrapper: document.getElementById("volumeWrapper"),
      volumeFill: document.getElementById("volumeFill"),
      volumeBtn: document.getElementById("volumeBtn"),
      volumeIcon: document.getElementById("volumeIcon"),

      // Queue & Lyrics
      queueBtn: document.getElementById("queueBtn"),
      queueDrawer: document.getElementById("queueDrawer"),
      closeQueueBtn: document.getElementById("closeQueueBtn"),
      clearQueueBtn: document.getElementById("clearQueueBtn"),
      queueList: document.getElementById("queueList"),
      queueCount: document.getElementById("queueCount"),
      queueBadge: document.getElementById("queueBadge"),
      lyricsBtn: document.getElementById("lyricsBtn"),
      quickLyricsBtn: document.getElementById("quickLyricsBtn"),
      lyricsOverlay: document.getElementById("lyricsOverlay"),
      lyricsBg: document.getElementById("lyricsBg"),
      lyricsBody: document.getElementById("lyricsBody"),
      closeLyricsBtn: document.getElementById("closeLyricsBtn"),
      lyricsTrackCover: document.getElementById("lyricsTrackCover"),
      lyricsTrackTitle: document.getElementById("lyricsTrackTitle"),
      lyricsTrackArtist: document.getElementById("lyricsTrackArtist"),

      // Auth Modal
      authModal: document.getElementById("authModal"),
      closeAuthModalBtn: document.getElementById("closeAuthModalBtn"),
      tabLogin: document.getElementById("tabLogin"),
      tabRegister: document.getElementById("tabRegister"),
      authForm: document.getElementById("authForm"),
      authUsername: document.getElementById("authUsername"),
      authEmail: document.getElementById("authEmail"),
      regEmailGroup: document.getElementById("regEmailGroup"),
      authPassword: document.getElementById("authPassword"),
      authSubmitBtn: document.getElementById("authSubmitBtn"),
      authErrorMsg: document.getElementById("authErrorMsg"),

      // Import Modal
      importModal: document.getElementById("importModal"),
      closeImportModalBtn: document.getElementById("closeImportModalBtn"),
      cancelImportBtn: document.getElementById("cancelImportBtn"),
      doImportBtn: document.getElementById("doImportBtn"),
      importUrlInput: document.getElementById("importUrlInput"),
      importStatusArea: document.getElementById("importStatusArea"),
      importStatusText: document.getElementById("importStatusText"),
      importResultCard: document.getElementById("importResultCard"),
      importResultTitle: document.getElementById("importResultTitle"),
      importResultDesc: document.getElementById("importResultDesc"),
      importCounterBadge: document.getElementById("importCounterBadge"),

      toastContainer: document.getElementById("toastContainer"),

      // Network & Buffer UI
      networkStatusBadge: document.getElementById("networkStatusBadge"),
      networkStatusText: document.getElementById("networkStatusText"),
      bufferBadge: document.getElementById("bufferBadge"),
      bufferStatusText: document.getElementById("bufferStatusText"),
      offlineBanner: document.getElementById("offlineBanner"),
      offlineBannerMessage: document.getElementById("offlineBannerMessage"),
      offlineBannerDismissBtn: document.getElementById("offlineBannerDismissBtn"),
      topbarSettingsBtn: document.getElementById("topbarSettingsBtn"),
      sidebarSettingsBtn: document.getElementById("sidebarSettingsBtn"),

      // Settings Modal
      settingsModal: document.getElementById("settingsModal"),
      closeSettingsModalBtn: document.getElementById("closeSettingsModalBtn"),
      saveSettingsCloseBtn: document.getElementById("saveSettingsCloseBtn"),
      apiBackendInput: document.getElementById("apiBackendInput"),
      saveApiBackendBtn: document.getElementById("saveApiBackendBtn"),
      settingAutoDownloadToggle: document.getElementById("settingAutoDownloadToggle"),
      settingPreloadToggle: document.getElementById("settingPreloadToggle"),
      offlineFavsCount: document.getElementById("offlineFavsCount"),
      offlineStorageSize: document.getElementById("offlineStorageSize"),
      btnFavsTotalCount: document.getElementById("btnFavsTotalCount"),
      downloadAllFavoritesBtn: document.getElementById("downloadAllFavoritesBtn"),
      clearStorageBtn: document.getElementById("clearStorageBtn"),
      downloadProgressBar: document.getElementById("downloadProgressBar"),
      downloadProgressFill: document.getElementById("downloadProgressFill"),
      downloadProgressLabel: document.getElementById("downloadProgressLabel"),
      yandexTokenInput: document.getElementById("yandexTokenInput"),
      saveYandexTokenBtn: document.getElementById("saveYandexTokenBtn"),
      favsDownloadAllQuickBtn: document.getElementById("favsDownloadAllQuickBtn"),

      // Mobile Layout & Navigation
      mobileTopHeader: document.getElementById("mobileTopHeader"),
      mobileLogoBtn: document.getElementById("mobileLogoBtn"),
      mobileSearchToggleBtn: document.getElementById("mobileSearchToggleBtn"),
      mobileSettingsBtn: document.getElementById("mobileSettingsBtn"),
      mobileUserAvatar: document.getElementById("mobileUserAvatar"),
      mobileBottomNav: document.getElementById("mobileBottomNav"),
      mobileFavCount: document.getElementById("mobileFavCount"),
      mobileProfileNavBtn: document.getElementById("mobileProfileNavBtn"),

      // Fullscreen Mobile Player
      mobileFullPlayer: document.getElementById("mobileFullPlayer"),
      closeFullPlayerBtn: document.getElementById("closeFullPlayerBtn"),
      mPlayerQueueBtn: document.getElementById("mPlayerQueueBtn"),
      mPlayerCover: document.getElementById("mPlayerCover"),
      mPlayerTitle: document.getElementById("mPlayerTitle"),
      mPlayerArtist: document.getElementById("mPlayerArtist"),
      mLikeBtn: document.getElementById("mLikeBtn"),
      mDislikeBtn: document.getElementById("mDislikeBtn"),
      mProgressWrapper: document.getElementById("mProgressWrapper"),
      mProgressTrack: document.getElementById("mProgressTrack"),
      mProgressFill: document.getElementById("mProgressFill"),
      mProgressThumb: document.getElementById("mProgressThumb"),
      mCurrentTime: document.getElementById("mCurrentTime"),
      mTotalDuration: document.getElementById("mTotalDuration"),
      mShuffleBtn: document.getElementById("mShuffleBtn"),
      mPrevBtn: document.getElementById("mPrevBtn"),
      mPlayBtn: document.getElementById("mPlayBtn"),
      mNextBtn: document.getElementById("mNextBtn"),
      mRepeatBtn: document.getElementById("mRepeatBtn"),
      mPlayIcon: document.querySelector(".m-play-icon"),
      mPauseIcon: document.querySelector(".m-pause-icon"),
      mLyricsBtn: document.getElementById("mLyricsBtn"),
      mDownloadBtn: document.getElementById("mDownloadBtn"),
    };

    this.init();
  }

  async init() {
    this.setupAudioListeners();
    this.setupUIListeners();
    this.setupKeyboardShortcuts();
    this.setupNetworkAndOfflineListeners();
    this.setVolume(this.volume);

    // 0. Autonomous backend discovery: race candidate servers & auto-select alive one
    await this.detectAndSelectBestBackend();
    this.setupBackgroundHealthCheck();

    // 1. Authenticate user & sync library
    await this.checkAuthAndSync();

    // 2. Load initial Wave data & Trending
    this.loadWave(this.waveMode, false);
    this.loadTrending(this.dom.countrySelect.value);

    // 3. Initialize offline settings and badges
    this.initOfflineBadges();

    // 4. Restore last playing track across page reload
    this.restorePlayerState();
  }

  // ==========================================
  // AUTHENTICATION & MULTI-DEVICE SYNC
  // ==========================================
  async checkAuthAndSync() {
    // 1. Immediately restore cached user from localStorage to eliminate UI flicker on reload
    try {
      const cachedUser = JSON.parse(localStorage.getItem("musik_user") || "null");
      if (cachedUser && this.token) {
        this.currentUser = cachedUser;
        this.updateUserUI(cachedUser);
      }
    } catch (e) {}

    // Fallback local storage favorites for instant display
    try {
      this.favorites = JSON.parse(localStorage.getItem("musik_favorites") || "[]");
      this.dislikes = JSON.parse(localStorage.getItem("musik_dislikes") || "[]");
      this.updatePillCounts();
    } catch (e) {}

    if (!this.token) {
      if (!this.currentUser) this.updateUserUI(null);
      return;
    }

    try {
      const resp = await this.fetchApi("/api/auth/me", {
        headers: { "Authorization": `Bearer ${this.token}` }
      });
      let data = null;
      try {
        const text = await resp.text();
        data = JSON.parse(text);
      } catch (jsonErr) {
        data = null;
      }

      if (data && (data.authenticated || data.user)) {
        const user = data.user || data;
        this.currentUser = user;
        localStorage.setItem("musik_user", JSON.stringify(user));
        this.updateUserUI(user);
        await this.syncLibraryFromBackend();
      } else if (resp.status === 401) {
        // Token explicitly revoked by server
        this.token = null;
        this.currentUser = null;
        localStorage.removeItem("musik_token");
        localStorage.removeItem("musik_user");
        this.updateUserUI(null);
      }
    } catch (e) {
      console.warn("Auth check network error:", e);
      if (this.currentUser) {
        this.updateUserUI(this.currentUser);
      }
    }
  }

  // ==========================================
  // AUTONOMOUS MULTI-BACKEND ENGINE & FAILOVER
  // ==========================================
  async detectAndSelectBestBackend(force = false) {
    const isPort8000 = window.location.port === "8000";
    const isLocalHost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    const isLocalServer = isLocalHost && isPort8000;

    if (isLocalServer && !this.forceRemote) {
      this.apiBase = "";
      this.updateBackendStatusUI("Локальный хост (localhost:8000)", true);
      return;
    }

    const label = document.getElementById("activeBackendLabel");
    if (label && force) {
      label.textContent = "Проверка серверов...";
    }

    const candidates = [...(this.backendList || ["https://musik-5a7a.onrender.com", "https://musik-npzp.onrender.com"])];
    let bestBackend = null;
    let minLatency = 99999;

    const checkServer = async (baseUrl) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);
      const start = Date.now();
      try {
        const res = await fetch(`${baseUrl}/api/settings/yandex-token`, {
          method: "GET",
          signal: controller.signal,
          cache: "no-store"
        });
        clearTimeout(timer);
        const latency = Date.now() - start;
        if (res.status === 200 || res.status === 401) {
          return { url: baseUrl, latency, ok: true };
        }
        throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        clearTimeout(timer);
        try {
          const c2 = new AbortController();
          const t2 = setTimeout(() => c2.abort(), 6000);
          const r2 = await fetch(`${baseUrl}/`, { method: "HEAD", signal: c2.signal, cache: "no-store" });
          clearTimeout(t2);
          if (r2.status === 200) {
            return { url: baseUrl, latency: Date.now() - start, ok: true };
          }
        } catch (e2) {}
        throw err;
      }
    };

    try {
      const results = await Promise.allSettled(candidates.map(url => checkServer(url)));
      const alive = results
        .filter(r => r.status === "fulfilled" && r.value.ok)
        .map(r => r.value)
        .sort((a, b) => a.latency - b.latency);

      if (alive.length > 0) {
        bestBackend = alive[0].url;
        minLatency = alive[0].latency;
      }
    } catch (e) {
      console.warn("Probe error:", e);
    }

    if (bestBackend) {
      this.apiBase = bestBackend;
      this.currentBackendIndex = this.backendList.indexOf(bestBackend);
      localStorage.setItem("musik_api_backend", bestBackend);
      console.log(`⚡ [AutoBackend] Активен сервер: ${bestBackend} (${minLatency} мс)`);
      this.updateBackendStatusUI(bestBackend, true, `${minLatency} мс`);
    } else {
      // Default immediately to primary if probe failed or timed out
      if (!this.apiBase || this.apiBase === "") {
        this.apiBase = this.defaultBackends[0];
      }
      this.updateBackendStatusUI(this.apiBase, true);
    }
  }

  updateBackendStatusUI(backendUrl = this.apiBase, isOnline = true, pingText = "") {
    const label = document.getElementById("activeBackendLabel");
    const indicator = document.getElementById("backendStatusIndicator");
    const pingDetails = document.getElementById("backendPingDetails");

    const url = backendUrl || this.apiBase || (this.defaultBackends && this.defaultBackends[0]) || "https://musik-5a7a.onrender.com";
    const clean = url ? url.replace(/^https?:\/\//, "") : "Локальный хост";

    if (label) {
      label.textContent = clean;
    }
    if (indicator) {
      indicator.style.background = isOnline ? "#1db954" : "#ffaa00";
      indicator.style.boxShadow = isOnline ? "0 0 10px #1db954" : "0 0 10px #ffaa00";
    }
    if (pingDetails && pingText) {
      pingDetails.innerHTML = `Ответ: <strong style="color: ${isOnline ? '#1db954' : '#ffaa00'};">${isOnline ? 'Онлайн' : 'Проверка'} (${pingText})</strong> • Резервный пул активен`;
    }
  }

  setupBackgroundHealthCheck() {
    // Proactively verify server availability every 60s & when user switches back to tab
    setInterval(() => this.detectAndSelectBestBackend(), 60000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        this.detectAndSelectBestBackend();
      }
    });
  }

  switchToNextBackend() {
    if (!this.backendList || this.backendList.length <= 1) return this.apiBase;
    this.currentBackendIndex = (this.currentBackendIndex + 1) % this.backendList.length;
    this.apiBase = this.backendList[this.currentBackendIndex];
    localStorage.setItem("musik_api_backend", this.apiBase);
    console.warn(`⚡ [AutoBackend] Автономно переключено на: ${this.apiBase}`);
    this.updateBackendStatusUI(this.apiBase, true);
    return this.apiBase;
  }

  api(path) {
    if (!path.startsWith("/")) path = "/" + path;
    const isPort8000 = window.location.port === "8000";
    const isLocalHost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    if (isLocalHost && isPort8000 && !this.forceRemote) {
      return path;
    }
    const base = this.apiBase || (this.backendList && this.backendList[0]) || "https://musik-5a7a.onrender.com";
    return `${base}${path}`;
  }

  clearStreamWatchdog() {
    if (this._streamWatchdog) {
      clearTimeout(this._streamWatchdog);
      this._streamWatchdog = null;
    }
  }

  startStreamWatchdog(track) {
    this.clearStreamWatchdog();
    if (!this.backendList || this.backendList.length <= 1) return;

    // If audio is stuck buffering for > 6 seconds on active backend, auto-failover to backup
    this._streamWatchdog = setTimeout(async () => {
      if (this.isBuffering && this.currentTrack && !this.currentTrack.stream_url && !this._isAudioRetrying) {
        console.warn("⚡ [AutoBackend] Поток завис (>6 сек). Плеер сам переключается на резервный сервер...");
        this._isAudioRetrying = true;
        this.switchToNextBackend();
        const retryStreamUrl = this.api(`/api/stream?title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artist)}`);
        this.audio.src = retryStreamUrl;
        try {
          await this.audio.play();
        } catch (e) {
          console.warn("⚡ [AutoBackend] Резервная попытка стрима:", e);
        } finally {
          this._isAudioRetrying = false;
        }
      }
    }, 6000);
  }

  async fetchApi(path, options = {}) {
    let apiPath = path;
    if (this.backendList) {
      for (const b of this.backendList) {
        if (apiPath.startsWith(b)) {
          apiPath = apiPath.substring(b.length);
          break;
        }
      }
    }
    if (!apiPath.startsWith("/")) apiPath = "/" + apiPath;

    const isPort8000 = window.location.port === "8000";
    const isLocalHost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    if (isLocalHost && isPort8000 && !this.forceRemote) {
      try {
        const resp = await fetch(apiPath, options);
        if (resp.status < 500) {
          return resp;
        }
      } catch (e) {
        console.warn("Local backend unreachable, trying remote backends...", e);
      }
    }

    const backends = [...(this.backendList || ["https://musik-5a7a.onrender.com", "https://musik-npzp.onrender.com"])];
    let lastError = null;

    for (let attempt = 0; attempt < backends.length; attempt++) {
      const idx = (this.currentBackendIndex + attempt) % backends.length;
      const targetBase = backends[idx];
      const targetUrl = `${targetBase}${apiPath}`;

      try {
        const controller = new AbortController();
        const timeoutMs = options.timeout || 12000;
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const fetchOpts = { ...options };
        if (!fetchOpts.signal) {
          fetchOpts.signal = controller.signal;
        }

        const resp = await fetch(targetUrl, fetchOpts);
        clearTimeout(timer);

        // Server down, suspended or error (500, 502, 503, 504) -> auto-failover!
        if (resp.status >= 500 && resp.status <= 504) {
          console.warn(`⚡ [AutoBackend] Сервер ${targetBase} вернул HTTP ${resp.status}. Сам переключаюсь на резервный...`);
          continue;
        }

        // Active server answered successfully
        if (this.apiBase !== targetBase) {
          this.currentBackendIndex = idx;
          this.apiBase = targetBase;
          localStorage.setItem("musik_api_backend", this.apiBase);
          this.updateBackendStatusUI(targetBase, true);
          const name = targetBase.replace(/^https?:\/\//, "");
          this.showToast(`⚡ Автоматически переключено на сервер: ${name}`, 2500);
        } else {
          this.updateBackendStatusUI(targetBase, true);
        }
        return resp;
      } catch (err) {
        console.warn(`⚡ [AutoBackend] Ошибка соединения с ${targetBase}:`, err.message || err);
        lastError = err;
      }
    }

    if (this.backendList.length > 1) {
      this.switchToNextBackend();
    }
    throw lastError || new Error("Все доступные серверы бэкенда временно недоступны");
  }

  // ==========================================
  // INVARIANT TRACK KEY & DEDUPLICATION
  // (1 song across all 4 streaming sources & formats)
  // ==========================================
  cleanTrackKey(artist, title) {
    const cyrToLat = {
      'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh',
      'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
      'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts',
      'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'
    };
    const artistAliases = {
      "король и шут": "korolishut",
      "korol i shut": "korolishut",
      "ундервуд": "undervud",
      "undervud": "undervud",
      "би-2": "bi2",
      "bi-2": "bi2",
      "bi 2": "bi2",
      "сплин": "splean",
      "splean": "splean",
      "кукрыниксы": "kukryniksy",
      "kukryniksy": "kukryniksy",
      "алексей горшенев": "gorshenev",
      "алексей горшенёв": "gorshenev",
      "горшенев": "gorshenev",
      "горшенёв": "gorshenev",
      "мумий тролль": "mumiytroll",
      "mumiy troll": "mumiytroll",
      "7б": "7b",
      "7b": "7b",
      "агата кристи": "agatakristi",
      "agata kristi": "agatakristi",
      "пикник": "piknik",
      "piknik": "piknik",
      "смысловые галлюцинации": "smyslovyegallyutsinatsii",
      "smyslovye gallyutsinatsii": "smyslovyegallyutsinatsii",
      "наутилус помпилиус": "nautiluspompilius",
      "nautilus pompilius": "nautiluspompilius",
      "бригадный подряд": "brigadnypodryad",
      "brigadny podryad": "brigadnypodryad",
      "the hatters": "thehatters",
      "шляпники": "thehatters",
      "кино": "kino",
      "kino": "kino",
      "серьга": "serga",
      "serga": "serga",
    };
    const translit = (str) => {
      return (str || '').toLowerCase().split('').map(c => cyrToLat[c] || c).join('');
    };

    let rawTitle = (title || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '');
    let cleanTitle = translit(rawTitle).replace(/[^a-z0-9]/g, '');

    let rawArtist = (artist || '').toLowerCase().trim().split(/[,&/]|(\bfeat\b)|(\bft\b)/)[0].trim();
    let cleanArtistKey = rawArtist.replace(/[^a-zа-яё0-9]/g, '');

    let cleanArtist = "";
    if (artistAliases[rawArtist]) {
      cleanArtist = artistAliases[rawArtist];
    } else if (artistAliases[cleanArtistKey]) {
      cleanArtist = artistAliases[cleanArtistKey];
    } else {
      cleanArtist = translit(rawArtist).replace(/[^a-z0-9]/g, '');
    }

    return `${cleanArtist}:::${cleanTitle}`;
  }

  isTrackMatch(trackA, trackB) {
    if (!trackA || !trackB) return false;
    if (trackA.id && trackB.id && String(trackA.id) === String(trackB.id)) return true;
    return this.cleanTrackKey(trackA.artist, trackA.title) === this.cleanTrackKey(trackB.artist, trackB.title);
  }

  async syncLibraryFromBackend() {
    if (!this.token) return;
    try {
      const resp = await this.fetchApi("/api/user/library", {
        headers: { "Authorization": `Bearer ${this.token}` }
      });
      if (resp.ok) {
        let data = null;
        try {
          const text = await resp.text();
          data = JSON.parse(text);
        } catch (jsonErr) {
          data = null;
        }
        if (!data) return;
        // Invariant deduplication: each song exists strictly once across all 4 streams
        const seenFav = new Set();
        this.favorites = (data.likes || []).filter(t => {
          const k = this.cleanTrackKey(t.artist, t.title);
          if (seenFav.has(k)) return false;
          seenFav.add(k);
          return true;
        });

        const seenDis = new Set();
        this.dislikes = (data.dislikes || []).filter(t => {
          const k = this.cleanTrackKey(t.artist, t.title);
          if (seenDis.has(k)) return false;
          seenDis.add(k);
          return true;
        });

        this.history = data.history || [];
        localStorage.setItem("musik_favorites", JSON.stringify(this.favorites));
        localStorage.setItem("musik_dislikes", JSON.stringify(this.dislikes));
        this.updatePillCounts();
        this.updateLikeDislikeButtons();
      }
    } catch (e) {
      console.error("Failed to sync library:", e);
    }
  }

  renderAvatarEqualizer(elem) {
    if (!elem) return;
    if (elem.querySelector(".avatar-eq")) return;
    elem.innerHTML = `
      <div class="avatar-eq">
        <span class="eq-bar eq-b1"></span>
        <span class="eq-bar eq-b2"></span>
        <span class="eq-bar eq-b3"></span>
        <span class="eq-bar eq-b4"></span>
      </div>
    `;
  }

  updateUserUI(user) {
    this.renderAvatarEqualizer(this.dom.userAvatar);
    this.renderAvatarEqualizer(this.dom.mobileUserAvatar);

    if (user) {
      if (this.dom.userAvatar) this.dom.userAvatar.classList.add("logged-in");
      if (this.dom.mobileUserAvatar) this.dom.mobileUserAvatar.classList.add("logged-in");
      this.dom.userName.textContent = user.display_name || user.username;
      this.dom.userStatus.textContent = "Облачная синхронизация";
      this.dom.userStatus.style.color = "#1db954";
      this.dom.userActionBtn.title = "Выйти из аккаунта";
      this.dom.userActionBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      `;
    } else {
      if (this.dom.userAvatar) this.dom.userAvatar.classList.remove("logged-in");
      if (this.dom.mobileUserAvatar) this.dom.mobileUserAvatar.classList.remove("logged-in");
      this.dom.userName.textContent = "Гость";
      this.dom.userStatus.textContent = "Нажмите, чтобы войти";
      this.dom.userStatus.style.color = "var(--text-secondary)";
      this.dom.userActionBtn.title = "Войти в аккаунт";
      this.dom.userActionBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
      `;
    }
  }

  updatePillCounts() {
    this.dom.favCountPill.textContent = this.favorites.length;
    this.dom.dislikeCountPill.textContent = this.dislikes.length;
    if (this.dom.mobileFavCount) this.dom.mobileFavCount.textContent = this.favorites.length;
    this.dom.waveLikesCount.textContent = `❤️ Лайков: ${this.favorites.length}`;
    this.dom.waveDislikesCount.textContent = `👎 Дизлайков: ${this.dislikes.length}`;
  }

  setAuthMode(mode) {
    this.authMode = mode;
    this.dom.authErrorMsg.classList.add("hidden");
    if (mode === "login") {
      this.dom.tabLogin.classList.add("active");
      this.dom.tabRegister.classList.remove("active");
      this.dom.regEmailGroup.style.display = "none";
      this.dom.authSubmitBtn.textContent = "Войти";
    } else {
      this.dom.tabLogin.classList.remove("active");
      this.dom.tabRegister.classList.add("active");
      this.dom.regEmailGroup.style.display = "block";
      this.dom.authSubmitBtn.textContent = "Зарегистрироваться";
    }
  }

  openAuthModal(mode = "login") {
    this.dom.authForm.reset();
    this.setAuthMode(mode);
    this.dom.authModal.classList.remove("hidden");
    this.dom.authUsername.focus();
  }

  closeAuthModal() {
    this.dom.authModal.classList.add("hidden");
  }

  async handleAuthSubmit(e) {
    e.preventDefault();
    this.dom.authErrorMsg.classList.add("hidden");
    const username = this.dom.authUsername.value.trim();
    const password = this.dom.authPassword.value;
    const email = this.dom.authEmail.value.trim();

    if (!username || !password) {
      this.dom.authErrorMsg.textContent = "Заполните логин и пароль";
      this.dom.authErrorMsg.classList.remove("hidden");
      return;
    }

    this.dom.authSubmitBtn.disabled = true;
    this.dom.authSubmitBtn.textContent = "Обработка...";

    // Standalone fallback: Store accounts directly in localStorage (works 100% on GitHub Pages without backend!)
    const localAuthFallback = () => {
      let localUsers = {};
      try {
        localUsers = JSON.parse(localStorage.getItem("musik_local_users") || "{}");
      } catch (err) {
        localUsers = {};
      }

      const key = username.toLowerCase();
      if (this.authMode === "register") {
        if (localUsers[key]) {
          throw new Error("Пользователь с таким именем уже существует");
        }
        const newUser = {
          id: "local_" + Date.now(),
          username: username,
          display_name: username,
          email: email || null,
          password: password,
          created_at: new Date().toISOString()
        };
        localUsers[key] = newUser;
        localStorage.setItem("musik_local_users", JSON.stringify(localUsers));

        this.token = "local_token_" + newUser.id;
        this.currentUser = newUser;
        localStorage.setItem("musik_token", this.token);
        localStorage.setItem("musik_user", JSON.stringify(newUser));
        this.updateUserUI(newUser);
        this.closeAuthModal();
        this.showToast(`Регистрация успешна! Добро пожаловать, ${username}!`);
        return true;
      } else {
        // Login
        const existing = localUsers[key];
        if (existing) {
          if (existing.password && existing.password !== password) {
            throw new Error("Неверный пароль");
          }
          this.token = "local_token_" + existing.id;
          this.currentUser = existing;
          localStorage.setItem("musik_token", this.token);
          localStorage.setItem("musik_user", JSON.stringify(existing));
          this.updateUserUI(existing);
          this.closeAuthModal();
          this.showToast(`С возвращением, ${existing.display_name || existing.username}!`);
          return true;
        } else {
          // Direct auto-create for smooth single-click access
          const newUser = {
            id: "local_" + Date.now(),
            username: username,
            display_name: username,
            email: email || null,
            password: password,
            created_at: new Date().toISOString()
          };
          localUsers[key] = newUser;
          localStorage.setItem("musik_local_users", JSON.stringify(localUsers));
          this.token = "local_token_" + newUser.id;
          this.currentUser = newUser;
          localStorage.setItem("musik_token", this.token);
          localStorage.setItem("musik_user", JSON.stringify(newUser));
          this.updateUserUI(newUser);
          this.closeAuthModal();
          this.showToast(`Добро пожаловать, ${username}!`);
          return true;
        }
      }
    };

    try {
      const endpoint = this.authMode === "login" ? "/api/auth/login" : "/api/auth/register";
      const payload = this.authMode === "login"
        ? { login: username, password, device_name: "Web Device" }
        : { username, password, email: email || null, display_name: username };

      let resp;
      try {
        resp = await this.fetchApi(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } catch (fetchErr) {
        throw new Error("Не удалось связаться с сервером. Проверьте подключение к бэкенду!");
      }

      // Safe JSON parsing: NEVER crash or expose raw JSON.parse error to user
      let data = null;
      try {
        const text = await resp.text();
        data = JSON.parse(text);
      } catch (jsonErr) {
        data = null;
      }

      if (!resp.ok) {
        if (resp.status === 409) {
          // User already registered in cloud Supabase!
          if (this.authMode === "register") {
            this.setAuthMode("login");
            this.dom.authUsername.value = username;
            this.dom.authPassword.value = password;
            throw new Error(`Аккаунт «${username}» уже существует в облаке! Мы переключили вас на «Вход» — нажмите «Войти».`);
          } else {
            throw new Error(data && data.detail ? data.detail : "Пользователь с таким именем уже существует");
          }
        }
        if (resp.status === 401 || resp.status === 403) {
          throw new Error(data && data.detail ? data.detail : "Неверный логин или пароль");
        }
        if (resp.status === 502 || resp.status === 503) {
          throw new Error("Облачный сервер Render временно приостановлен или просыпается... Если запускаете локально, откройте http://localhost:8000");
        }
        throw new Error(data && data.detail ? data.detail : `Ошибка авторизации (${resp.status})`);
      }

      if (!data || !data.token) {
        throw new Error("Не удалось получить данные сессии от сервера");
      }

      // Successful cloud authentication via Supabase!
      this.token = data.token;
      this.currentUser = data.user;
      localStorage.setItem("musik_token", this.token);
      localStorage.setItem("musik_user", JSON.stringify(data.user));
      // Remove any legacy local tokens
      localStorage.removeItem("musik_local_users");

      this.updateUserUI(data.user);
      this.closeAuthModal();
      this.showToast(`Облачный профиль подключен! Добро пожаловать, ${data.user.display_name || data.user.username}!`);
      await this.syncLibraryFromBackend();
      this.loadWave(this.waveMode, false);

    } catch (err) {
      this.dom.authErrorMsg.textContent = err.message;
      this.dom.authErrorMsg.classList.remove("hidden");
    } finally {
      this.dom.authSubmitBtn.disabled = false;
      this.dom.authSubmitBtn.textContent = this.authMode === "login" ? "Войти" : "Зарегистрироваться";
    }
  }

  async logout() {
    if (this.token) {
      try {
        await this.fetchApi("/api/auth/logout", {
          method: "POST",
          headers: { "Authorization": `Bearer ${this.token}` }
        });
      } catch (e) {}
    }
    this.token = null;
    this.currentUser = null;
    localStorage.removeItem("musik_token");
    localStorage.removeItem("musik_user");
    localStorage.removeItem("musik_local_users");
    this.updateUserUI(null);
    this.showToast("Вы вышли из аккаунта");
    await this.checkAuthAndSync();
    this.loadWave(this.waveMode, false);
  }

  // ==========================================
  // "МОЙ ПОТОК" (МОЯ ВОЛНА) ALGORITHM ENGINE
  // ==========================================
  async loadWave(mode = "default", autoPlay = false) {
    this.waveMode = mode;
    this.isLoadingWave = true;
    this.dom.waveTrackList.innerHTML = '<div class="lyrics-loading" style="padding: 40px 0;">Алгоритм подбирает персональные треки для вас...</div>';

    const headers = {};
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    try {
      if (this.dom.startWaveBtnText) {
        this.dom.startWaveBtnText.textContent = "Загрузка...";
      }
      const resp = await this.fetchApi(`/api/stream/wave?mode=${mode}&limit=15&country=${this.dom.countrySelect.value}`, {
        headers
      });
      if (!resp.ok) {
        throw new Error(`HTTP error ${resp.status}`);
      }
      let data = null;
      try {
        const text = await resp.text();
        data = JSON.parse(text);
      } catch (jsonErr) {
        data = null;
      }
      if (!data) throw new Error("Неверный формат ответа волны");
      const rawTracks = data.results || [];

      // Deduplicate by canonical key: 1 song across all 4 streams
      const seenKeys = new Set();
      const tracks = [];
      for (const t of rawTracks) {
        const k = this.cleanTrackKey(t.artist, t.title);
        if (!seenKeys.has(k)) {
          seenKeys.add(k);
          tracks.push(t);
        }
      }

      this.waveQueue = tracks;
      this.waveIndex = 0;

      // Update meta stats
      if (data.meta) {
        if (data.meta.top_genres && data.meta.top_genres.length > 0) {
          this.dom.waveTopGenres.textContent = `Жанры: ${data.meta.top_genres.join(', ')}`;
        }
      }

      this.renderWaveTracks();

      if (autoPlay && tracks.length > 0) {
        this.isWaveActive = true;
        this.queue = [...this.waveQueue];
        this.queueIndex = 0;
        this.renderQueue();
        this.playTrack(tracks[0], false);
        this.dom.startWaveBtnText.textContent = "Волна активна";
        this.showToast("🌊 «Мой поток» запущен!");
      } else {
        this.dom.startWaveBtnText.textContent = this.isWaveActive ? "Волна активна" : "Включить Мой поток";
      }
    } catch (e) {
      console.warn("Backend wave unavailable, using client-side wave engine:", e);
      let localWave = [];
      if (this.favorites.length > 0) {
        localWave = [...this.favorites].sort(() => Math.random() - 0.5);
      }
      if (localWave.length < 15) {
        try {
          const itUrl = `https://itunes.apple.com/ru/rss/topsongs/limit=25/json`;
          const itResp = await fetch(itUrl);
          const itData = await itResp.json();
          const items = (itData.feed?.entry || []).map((entry, idx) => ({
            id: `wave_it_${idx}_${Date.now()}`,
            title: entry["im:name"]?.label || "Hit",
            artist: entry["im:artist"]?.label || "Artist",
            artwork: (entry["im:image"]?.[2]?.label || "").replace("170x170bb", "600x600bb"),
            stream_url: entry.link?.find(l => l.attributes?.type?.includes("audio"))?.attributes?.href || null,
            source: "itunes"
          }));
          localWave = [...localWave, ...items.sort(() => Math.random() - 0.5)];
        } catch (itErr) {}
      }

      if (localWave.length === 0) {
        localWave = [
          { id: "def_1", title: "Никто", artist: "Алексей Горшенёв", artwork: "logo.jpg" },
          { id: "def_2", title: "Мгновение", artist: "ГОРШЕНЕВ", artwork: "logo.jpg" },
          { id: "def_3", title: "Кровавая Мэри", artist: "Ундервуд", artwork: "logo.jpg" },
          { id: "def_4", title: "Цветут цветы", artist: "Танцы Минус", artwork: "logo.jpg" },
          { id: "def_5", title: "Демоны", artist: "Смысловые Галлюцинации", artwork: "logo.jpg" },
          { id: "def_6", title: "Питер рок-н-ролл", artist: "Бригадный подряд, Михаил Горшенёв", artwork: "logo.jpg" },
          { id: "def_7", title: "Лесник", artist: "Король и Шут", artwork: "logo.jpg" },
          { id: "def_8", title: "Прыгну со скалы", artist: "Король и Шут", artwork: "logo.jpg" },
          { id: "def_9", title: "Кукла колдуна", artist: "Король и Шут", artwork: "logo.jpg" },
          { id: "def_10", title: "Blinding Lights", artist: "The Weeknd", artwork: "logo.jpg" }
        ];
      }

      // Filter out dislikes
      const dislikeKeys = new Set(this.dislikes.map(t => this.cleanTrackKey(t.artist, t.title)));
      localWave = localWave.filter(t => !dislikeKeys.has(this.cleanTrackKey(t.artist, t.title)));

      this.waveQueue = localWave.slice(0, 15);
      this.waveIndex = 0;
      this.renderWaveTracks();

      if (autoPlay && this.waveQueue.length > 0) {
        this.isWaveActive = true;
        this.queue = [...this.waveQueue];
        this.queueIndex = 0;
        this.renderQueue();
        this.playTrack(this.waveQueue[0], false);
        this.dom.startWaveBtnText.textContent = "Волна активна";
        this.showToast("🌊 «Мой поток» запущен!");
      } else {
        this.dom.startWaveBtnText.textContent = this.isWaveActive ? "Волна активна" : "Включить Мой поток";
      }
    } finally {
      this.isLoadingWave = false;
    }
  }

  async fetchNextWaveChunk() {
    if (this.isLoadingWave) return;
    this.isLoadingWave = true;

    const headers = {};
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    try {
      const resp = await this.fetchApi(`/api/stream/wave?mode=${this.waveMode}&limit=10&country=${this.dom.countrySelect.value}`, {
        headers
      });
      const data = await resp.json();
      const newTracks = data.results || [];

      // Append tracks strictly avoiding duplicates
      const existingKeys = new Set(this.waveQueue.map(t => this.cleanTrackKey(t.artist, t.title)));
      const existingIds = new Set(this.waveQueue.map(t => String(t.id)));
      const filtered = [];

      for (const t of newTracks) {
        const k = this.cleanTrackKey(t.artist, t.title);
        if (!existingIds.has(String(t.id)) && !existingKeys.has(k)) {
          existingKeys.add(k);
          existingIds.add(String(t.id));
          filtered.push(t);
        }
      }

      this.waveQueue.push(...filtered);

      // Append to active queue if wave is playing
      if (this.isWaveActive) {
        for (const t of filtered) {
          if (!this.queue.some(q => this.isTrackMatch(q, t))) {
            this.queue.push(t);
          }
        }
        this.renderQueue();
      }
      this.renderWaveTracks();
    } catch (e) {
      console.warn("Wave chunk fetch failed:", e);
    } finally {
      this.isLoadingWave = false;
    }
  }

  renderWaveTracks() {
    this.dom.waveTrackList.innerHTML = "";
    if (!this.waveQueue.length) {
      this.dom.waveTrackList.innerHTML = '<div class="lyrics-empty" style="padding: 40px 0;">Поток пуст. Поставьте лайки понравившимся трекам!</div>';
      return;
    }

    this.renderTrackList(this.dom.waveTrackList, this.waveQueue, { isWave: true });
  }

  startPersonalWave() {
    this.isWaveActive = true;
    if (this.waveQueue.length === 0) {
      this.dom.startWaveBtnText.textContent = "Загрузка...";
      this.loadWave(this.waveMode, true);
    } else {
      this.queue = [...this.waveQueue];
      this.queueIndex = 0;
      this.renderQueue();
      this.playTrack(this.waveQueue[0], false);
      this.dom.startWaveBtnText.textContent = "Волна активна";
      this.showToast("🌊 «Мой поток» запущен! Музыка непрерывно подстраивается под вас.");
    }
  }

  // ==========================================
  // PLAYLIST IMPORT & AUTO-LIKE
  // ==========================================
  openImportModal() {
    this.dom.importUrlInput.value = "";
    if (this.dom.importCounterBadge) this.dom.importCounterBadge.textContent = "";
    this.dom.importStatusArea.classList.add("hidden");
    this.dom.importResultCard.classList.add("hidden");
    this.dom.doImportBtn.disabled = false;
    this.dom.importModal.classList.remove("hidden");
    this.dom.importUrlInput.focus();
  }

  closeImportModal() {
    this.dom.importModal.classList.add("hidden");
  }

  async executePlaylistImport() {
    const inputVal = this.dom.importUrlInput.value.trim();
    if (!inputVal) {
      this.showToast("Вставьте ссылку или список треков");
      return;
    }

    this.dom.importStatusArea.classList.remove("hidden");
    this.dom.importResultCard.classList.add("hidden");
    this.dom.importStatusText.textContent = "Извлечение треков и автоматическая простановка лайков...";
    this.dom.doImportBtn.disabled = true;

    try {
      const headers = { "Content-Type": "application/json" };
      if (this.token) {
        headers["Authorization"] = `Bearer ${this.token}`;
      }

      const resp = await this.fetchApi("/api/import/playlist", {
        method: "POST",
        headers,
        body: JSON.stringify({ url: inputVal })
      });
      const data = await resp.json();

      if (!resp.ok) {
        throw new Error(data.detail || "Ошибка импорта");
      }

      // Success
      this.dom.importStatusArea.classList.add("hidden");
      this.dom.importResultCard.classList.remove("hidden");
      this.dom.importResultTitle.textContent = `Импортировано: ${data.playlist_name || "Плейлист"}`;
      this.dom.importResultDesc.textContent = `Добавлено ${data.imported_count} треков в ваши Любимые! Мой поток перенастроен.`;

      this.showToast(`🎉 Успешно! Добавлено ${data.imported_count} лайков.`);

      // If tracks returned, update local favorites
      if (data.tracks && Array.isArray(data.tracks) && data.tracks.length > 0) {
        const newTracks = data.tracks;
        const existingKeys = new Set(this.favorites.map(t => this.cleanTrackKey(t.artist, t.title)));
        const toAdd = [];
        for (const t of newTracks) {
          const k = this.cleanTrackKey(t.artist, t.title);
          if (!existingKeys.has(k)) {
            existingKeys.add(k);
            toAdd.push(t);
          }
        }
        this.favorites = [...toAdd, ...this.favorites];
        localStorage.setItem("musik_favorites", JSON.stringify(this.favorites));

        // Auto-download new favorites for offline listening if enabled
        if (window.offlineStorage && window.offlineStorage.isAutoDownloadEnabled) {
          window.offlineStorage.enqueueMultipleFavorites(toAdd);
        }
      }

      if (this.token) {
        await this.syncLibraryFromBackend();
      }

      this.updatePillCounts();
      if (this.dom.favoritesView.classList.contains("active-view")) {
        this.renderFavorites();
      }

      // Recalculate wave with new likes
      this.loadWave(this.waveMode, false);

      setTimeout(() => {
        this.closeImportModal();
        this.switchView("favorites");
      }, 1500);

    } catch (err) {
      this.dom.importStatusArea.classList.add("hidden");
      this.showToast(`Ошибка: ${err.message}`);
      this.dom.doImportBtn.disabled = false;
    }
  }

  // ==========================================
  // DISLIKES & LIKES LOGIC
  // ==========================================
  async toggleLike(track) {
    if (!track) return;
    const isLiked = this.favorites.some(t => this.isTrackMatch(t, track));

    if (isLiked) {
      // Remove like across all streaming representations
      this.favorites = this.favorites.filter(t => !this.isTrackMatch(t, track));
      if (this.token) {
        try {
          await this.fetchApi(`/api/user/like/${encodeURIComponent(track.id)}?artist=${encodeURIComponent(track.artist || '')}&title=${encodeURIComponent(track.title || '')}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${this.token}` }
          });
        } catch (e) {}
      } else {
        localStorage.setItem("musik_favorites", JSON.stringify(this.favorites));
      }

      if (window.offlineStorage) {
        window.offlineStorage.markFavorite(track, false);
      }
      this.showToast(`Удалено из любимых: ${track.title}`);
    } else {
      // Add like: 1 song invariant across all 4 streams
      this.favorites = this.favorites.filter(t => !this.isTrackMatch(t, track));
      this.favorites.unshift(track);
      // Remove from dislikes if present
      this.dislikes = this.dislikes.filter(t => !this.isTrackMatch(t, track));

      if (this.token) {
        try {
          await this.fetchApi("/api/user/like", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${this.token}`
            },
            body: JSON.stringify(track)
          });
        } catch (e) {}
      } else {
        localStorage.setItem("musik_favorites", JSON.stringify(this.favorites));
        localStorage.setItem("musik_dislikes", JSON.stringify(this.dislikes));
      }
      this.showToast(`❤️ Добавлено в любимые, поток подстраивается...`);

      // Auto-download for offline if enabled
      if (window.offlineStorage && window.offlineStorage.isAutoDownloadEnabled) {
        window.offlineStorage.enqueueDownload(track);
      }

      // Immediately adjust wave if active
      if (this.isWaveActive) {
        this.fetchNextWaveChunk();
      }
    }

    this.updatePillCounts();
    this.updateLikeDislikeButtons();
    if (this.dom.favoritesView.classList.contains("active-view")) {
      this.renderFavorites();
    }
  }

  async toggleDislike(track) {
    if (!track) return;
    const isDisliked = this.dislikes.some(t => this.isTrackMatch(t, track));

    if (isDisliked) {
      // Undislike
      this.dislikes = this.dislikes.filter(t => !this.isTrackMatch(t, track));
      if (this.token) {
        try {
          await this.fetchApi(`/api/user/dislike/${encodeURIComponent(track.id)}?artist=${encodeURIComponent(track.artist || '')}&title=${encodeURIComponent(track.title || '')}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${this.token}` }
          });
        } catch (e) {}
      } else {
        localStorage.setItem("musik_dislikes", JSON.stringify(this.dislikes));
      }
      this.showToast(`Убран из скрытых: ${track.title}`);
    } else {
      // Add dislike
      this.dislikes = this.dislikes.filter(t => !this.isTrackMatch(t, track));
      this.dislikes.unshift(track);
      // Remove from favorites if present
      this.favorites = this.favorites.filter(t => !this.isTrackMatch(t, track));

      // Remove from queues so it is never played again
      this.waveQueue = this.waveQueue.filter(t => !this.isTrackMatch(t, track));
      this.queue = this.queue.filter(t => !this.isTrackMatch(t, track));

      if (this.token) {
        try {
          await this.fetchApi("/api/user/dislike", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${this.token}`
            },
            body: JSON.stringify(track)
          });
        } catch (e) {}
      } else {
        localStorage.setItem("musik_favorites", JSON.stringify(this.favorites));
        localStorage.setItem("musik_dislikes", JSON.stringify(this.dislikes));
      }

      this.showToast(`👎 Трек скрыт и пропущен: ${track.title}`);

      // If currently playing, skip immediately!
      if (this.currentTrack && this.isTrackMatch(this.currentTrack, track)) {
        this.playNext();
      }

      // If wave queue is running low after removing disliked tracks, fetch more
      if (this.isWaveActive && this.queue.length <= 2) {
        this.fetchNextWaveChunk();
      }
    }

    this.updatePillCounts();
    this.updateLikeDislikeButtons();
    if (this.dom.dislikesView.classList.contains("active-view")) {
      this.renderDislikes();
    }
  }

  updateLikeDislikeButtons() {
    if (!this.currentTrack) return;
    const isLiked = this.favorites.some(t => this.isTrackMatch(t, this.currentTrack));
    const isDisliked = this.dislikes.some(t => this.isTrackMatch(t, this.currentTrack));

    this.dom.playerLikeBtn.classList.toggle("liked", isLiked);
    this.dom.playerDislikeBtn.classList.toggle("disliked", isDisliked);

    if (this.dom.mLikeBtn) this.dom.mLikeBtn.classList.toggle("active", isLiked);
    if (this.dom.mDislikeBtn) this.dom.mDislikeBtn.classList.toggle("active", isDisliked);
  }

  renderFavorites() {
    this.dom.favoritesTrackList.innerHTML = "";
    if (this.favorites.length === 0) {
      this.dom.favoritesTrackList.innerHTML = `
        <div class="lyrics-empty" style="padding: 40px 0;">
          У вас пока нет любимых треков.<br>
          Нажмите на кнопку <strong>«Импорт ссылки»</strong> вверху или ставьте ❤️ понравившимся песням!
        </div>`;
      return;
    }
    // Invariant deduplication: 1 song across all streams & formats
    const seen = new Set();
    const deduped = [];
    for (const t of this.favorites) {
      const k = this.cleanTrackKey(t.artist, t.title);
      if (!seen.has(k)) {
        seen.add(k);
        deduped.push(t);
      }
    }
    this.favorites = deduped;
    this.renderTrackList(this.dom.favoritesTrackList, this.favorites);
  }

  renderDislikes() {
    this.dom.dislikesTrackList.innerHTML = "";
    // Invariant deduplication
    const seen = new Set();
    const deduped = [];
    for (const t of this.dislikes) {
      const k = this.cleanTrackKey(t.artist, t.title);
      if (!seen.has(k)) {
        seen.add(k);
        deduped.push(t);
      }
    }
    this.dislikes = deduped;

    if (this.dislikes.length === 0) {
      this.dom.dislikesTrackList.innerHTML = `
        <div class="lyrics-empty" style="padding: 40px 0;">
          У вас нет скрытых треков. Когда вы нажимаете 👎, трек исключается из вашего потока навсегда.
        </div>`;
      return;
    }

    this.dislikes.forEach((track, idx) => {
      const row = document.createElement("div");
      row.className = "track-row";
      row.dataset.id = track.id;
      row.innerHTML = `
        <div class="track-num">${idx + 1}</div>
        <img class="track-cover-mini" src="${track.artwork || ''}" alt="" />
        <div class="track-info-col">
          <div class="track-info-title">
            ${this.escapeHtml(track.title)}
            <span class="track-download-badge hidden" data-track-id="${track.id}" title="Скачано на устройство (офлайн доступно)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            </span>
          </div>
          <div class="track-info-artist">${this.escapeHtml(track.artist)}</div>
        </div>
        <div class="track-album-col">${this.escapeHtml(track.genre || 'Музыка')}</div>
        <div class="track-actions-col">
          <button class="btn btn-secondary btn-sm undislike-btn" title="Вернуть в рекомендации">
            Убрать из скрытых
          </button>
        </div>
      `;

      row.querySelector(".undislike-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleDislike(track);
      });

      this.dom.dislikesTrackList.appendChild(row);
    });
  }

  // ==========================================
  // AUDIO ENGINE & PLAYBACK
  // ==========================================
  setupAudioListeners() {
    this.audio.addEventListener("waiting", () => {
      this.isBuffering = true;
      this.updatePlayState();
    });

    this.audio.addEventListener("playing", () => {
      this.clearStreamWatchdog();
      this.isBuffering = false;
      this.isPlaying = true;
      this.updatePlayState();
    });

    this.audio.addEventListener("pause", () => {
      this.clearStreamWatchdog();
      this.isPlaying = false;
      this.updatePlayState();
    });

    this.audio.addEventListener("timeupdate", () => {
      if (!this.audio.duration) return;
      const current = this.audio.currentTime;
      if (current > 0) {
        this.clearStreamWatchdog();
      }
      const duration = this.audio.duration;
      const pct = (current / duration) * 100;
      this.dom.progressFill.style.width = `${pct}%`;
      this.dom.currentTime.textContent = this.formatTime(current);
      if (this.dom.mProgressFill) this.dom.mProgressFill.style.width = `${pct}%`;
      if (this.dom.mCurrentTime) this.dom.mCurrentTime.textContent = this.formatTime(current);
      this.syncLyrics(current);
    });

    this.audio.addEventListener("durationchange", () => {
      if (this.audio.duration && !isNaN(this.audio.duration)) {
        this.dom.totalDuration.textContent = this.formatTime(this.audio.duration);
        if (this.dom.mTotalDuration) this.dom.mTotalDuration.textContent = this.formatTime(this.audio.duration);
      }
    });

    this.audio.addEventListener("progress", () => {
      if (this.audio.buffered.length > 0 && this.audio.duration) {
        const bufferedEnd = this.audio.buffered.end(this.audio.buffered.length - 1);
        const pct = (bufferedEnd / this.audio.duration) * 100;
        this.dom.progressBuffer.style.width = `${pct}%`;
      }
    });

    this.audio.addEventListener("ended", () => {
      // Record complete play in history
      if (this.currentTrack) {
        this.recordHistory(this.currentTrack, Math.floor(this.audio.currentTime), false);
      }

      if (this.repeatMode === 2) {
        this.audio.currentTime = 0;
        this.audio.play();
      } else {
        this.playNext();
      }
    });

    this.audio.addEventListener("error", async (e) => {
      this.clearStreamWatchdog();
      console.error("Audio error:", e);
      if (!navigator.onLine) {
        console.warn("Audio playback failed while offline, triggering fallback...");
        await this.activateOfflineFallback();
      } else {
        // Multi-backend stream failover retry
        if (this.currentTrack && !this.currentTrack.stream_url && this.backendList && this.backendList.length > 1 && !this._isAudioRetrying) {
          this._isAudioRetrying = true;
          this.switchToNextBackend();
          const retryStreamUrl = this.api(`/api/stream?title=${encodeURIComponent(this.currentTrack.title)}&artist=${encodeURIComponent(this.currentTrack.artist)}`);
          console.warn("⚡ [AutoBackend] Ошибка потока. Автоматический перезапуск с резервного сервера:", retryStreamUrl);
          this.audio.src = retryStreamUrl;
          try {
            await this.audio.play();
            this._isAudioRetrying = false;
            return;
          } catch (retryErr) {
            console.warn("⚡ [AutoBackend] Ошибка резервного потока:", retryErr);
            this._isAudioRetrying = false;
          }
        }
        this.showToast("Ошибка воспроизведения потока трека");
      }
      this.isBuffering = false;
      this.updatePlayState();
    });
  }

  async playTrack(track, addToQueueList = true) {
    if (!track) return;
    this.currentTrack = track;
    this.savePlayerState();

    // UI Updates
    this.dom.playerTitle.textContent = track.title;
    this.dom.playerArtist.textContent = track.artist;
    this.dom.playerCover.src = track.artwork || "logo.jpg";
    if (this.dom.mPlayerTitle) this.dom.mPlayerTitle.textContent = track.title;
    if (this.dom.mPlayerArtist) this.dom.mPlayerArtist.textContent = track.artist;
    if (this.dom.mPlayerCover) this.dom.mPlayerCover.src = track.artwork || "logo.jpg";
    this.updateLikeDislikeButtons();

    // Lyrics overlay update
    this.dom.lyricsTrackTitle.textContent = track.title;
    this.dom.lyricsTrackArtist.textContent = track.artist;
    this.dom.lyricsTrackCover.src = track.artwork || "";
    this.dom.lyricsBg.style.backgroundImage = `url("${track.artwork || ''}")`;

    // Active row highlight
    document.querySelectorAll(".track-row").forEach(r => r.classList.remove("active"));
    const activeRow = document.querySelector(`.track-row[data-id="${track.id}"]`);
    if (activeRow) activeRow.classList.add("active");

    // Buffering indicator
    this.isBuffering = true;
    this.updatePlayState();

    // Queue management
    if (addToQueueList) {
      const existingIdx = this.queue.findIndex(t => this.isTrackMatch(t, track));
      if (existingIdx === -1) {
        this.queue.push(track);
        this.queueIndex = this.queue.length - 1;
      } else {
        this.queueIndex = existingIdx;
      }
      this.renderQueue();
    }

    // Resolve audio source: IndexedDB cache first, then online stream!
    let audioSrc = null;
    if (window.offlineStorage) {
      audioSrc = await window.offlineStorage.getTrackAudioUrl(track.id);
    }

    if (audioSrc) {
      // INSTANT PLAYBACK FROM LOCAL CACHE!
      this.audio.src = audioSrc;
    } else if (track.stream_url) {
      // Direct audio stream (from iTunes / web stream / cached URL)
      this.audio.src = track.stream_url;
    } else if (this.apiBase) {
      // ONLINE STREAMING via remote backend with automatic watchdog failover
      this.startStreamWatchdog(track);
      const streamUrl = this.api(`/api/stream?title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artist)}`);
      this.audio.src = streamUrl;
    } else if (navigator.onLine) {
      // Standalone client fallback for GitHub Pages
      try {
        const itQuery = `${track.artist} ${track.title}`;
        const itRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(itQuery)}&entity=song&limit=1`);
        const itData = await itRes.json();
        if (itData.results && itData.results.length > 0 && itData.results[0].previewUrl) {
          track.stream_url = itData.results[0].previewUrl;
          this.audio.src = track.stream_url;
        }
      } catch (err) {
        console.warn("Direct stream fetch error:", err);
      }
    } else {
      // NO NETWORK AND TRACK NOT PRELOADED -> OFFLINE FALLBACK!
      console.warn("Track not available offline. Triggering offline fallback to downloaded favorites...");
      await this.activateOfflineFallback();
      return;
    }

    try {
      await this.audio.play();
      this.isPlaying = true;
    } catch (err) {
      console.warn("Autoplay / play failed:", err);
    } finally {
      this.isBuffering = false;
      this.updatePlayState();
    }

    this.updateMediaSession(track);
    this.fetchLyrics(track);

    // Preload next 5 tracks for seamless transitions and offline tolerance
    this.preloadUpcomingTracks(5);
    this.updateBufferStatus();

    // Pre-buffer next track in secondary audio element for instantaneous transition
    const nextTrack = (this.queue && this.queue[this.queueIndex + 1]) || (this.waveQueue && this.waveQueue[this.waveIndex + 1]);
    if (nextTrack && this.preloaderAudio) {
      const nextStreamUrl = this.api(`/api/stream?title=${encodeURIComponent(nextTrack.title)}&artist=${encodeURIComponent(nextTrack.artist)}`);
      this.preloaderAudio.src = nextStreamUrl;
    }

    // Wave continuous refill check: if only 2 tracks remain, fetch next chunk!
    if (this.isWaveActive && this.queueIndex >= this.queue.length - 2 && navigator.onLine) {
      this.fetchNextWaveChunk();
    }
  }

  togglePlay() {
    if (!this.currentTrack) {
      if (this.queue.length > 0) {
        this.playTrack(this.queue[0]);
      } else if (this.waveQueue.length > 0) {
        this.startPersonalWave();
      }
      return;
    }
    if (this.audio.paused) {
      this.audio.play();
    } else {
      this.audio.pause();
    }
  }

  async playNext() {
    if (this.queue.length === 0) {
      if (!navigator.onLine) {
        await this.activateOfflineFallback();
      }
      return;
    }

    // Record skip if played under 20s
    if (this.currentTrack && this.audio.currentTime < 20 && navigator.onLine) {
      this.recordHistory(this.currentTrack, Math.floor(this.audio.currentTime), true);
    }

    if (this.isShuffle) {
      const nextIdx = Math.floor(Math.random() * this.queue.length);
      this.queueIndex = nextIdx;
      await this.playTrack(this.queue[nextIdx], false);
      return;
    }

    if (this.queueIndex < this.queue.length - 1) {
      const nextCandidate = this.queue[this.queueIndex + 1];
      // If offline, check if next candidate is available in cache
      if (!navigator.onLine && window.offlineStorage) {
        const isCached = await window.offlineStorage.isTrackCached(nextCandidate.id);
        if (!isCached) {
          console.log("5 preloaded tracks finished while offline. Falling back to downloaded favorites.");
          await this.activateOfflineFallback();
          return;
        }
      }

      this.queueIndex++;
      await this.playTrack(this.queue[this.queueIndex], false);
    } else if (this.isWaveActive && navigator.onLine) {
      // Endless stream: fetch more tracks!
      await this.fetchNextWaveChunk();
      if (this.queueIndex < this.queue.length - 1) {
        this.queueIndex++;
        await this.playTrack(this.queue[this.queueIndex], false);
      }
    } else if (!navigator.onLine) {
      // Offline and queue finished -> offline fallback
      await this.activateOfflineFallback();
    } else if (this.repeatMode === 1) {
      this.queueIndex = 0;
      await this.playTrack(this.queue[0], false);
    } else {
      this.isPlaying = false;
      this.updatePlayState();
    }
  }

  playPrev() {
    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      return;
    }
    if (this.queueIndex > 0) {
      this.queueIndex--;
      this.playTrack(this.queue[this.queueIndex], false);
    } else {
      this.audio.currentTime = 0;
    }
  }

  seek(percentage) {
    if (!this.audio.duration) return;
    this.audio.currentTime = (percentage / 100) * this.audio.duration;
  }

  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, val));
    this.audio.volume = this.volume;
    localStorage.setItem("musik_volume", this.volume);
    this.dom.volumeFill.style.width = `${this.volume * 100}%`;
    this.updateVolumeIcon();
  }

  updateVolumeIcon() {
    if (this.volume === 0 || this.audio.muted) {
      this.dom.volumeIcon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>`;
    } else if (this.volume < 0.5) {
      this.dom.volumeIcon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>`;
    } else {
      this.dom.volumeIcon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>`;
    }
  }

  updatePlayState() {
    if (this.isBuffering) {
      this.dom.playerSpinner.classList.remove("hidden");
      this.dom.playIcon.classList.add("hidden");
      this.dom.pauseIcon.classList.add("hidden");
    } else {
      this.dom.playerSpinner.classList.add("hidden");
      if (this.isPlaying) {
        this.dom.playIcon.classList.add("hidden");
        this.dom.pauseIcon.classList.remove("hidden");
        if (this.dom.mPlayIcon) this.dom.mPlayIcon.classList.add("hidden");
        if (this.dom.mPauseIcon) this.dom.mPauseIcon.classList.remove("hidden");
      } else {
        this.dom.playIcon.classList.remove("hidden");
        this.dom.pauseIcon.classList.add("hidden");
        if (this.dom.mPlayIcon) this.dom.mPlayIcon.classList.remove("hidden");
        if (this.dom.mPauseIcon) this.dom.mPauseIcon.classList.add("hidden");
      }
    }
  }

  async recordHistory(track, listenedSeconds, skipped) {
    if (!this.token) return;
    try {
      await this.fetchApi("/api/user/history", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.token}`
        },
        body: JSON.stringify({
          id: String(track.id),
          title: track.title,
          artist: track.artist,
          artwork: track.artwork,
          genre: track.genre,
          duration: track.duration,
          listened_seconds: listenedSeconds,
          skipped: skipped
        })
      });
    } catch (e) {}
  }

  // ==========================================
  // MEDIA SESSION & LOCK SCREEN
  // ==========================================
  updateMediaSession(track) {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album || "Single",
        artwork: [
          { src: track.artwork || "", sizes: "512x512", type: "image/jpeg" }
        ]
      });

      navigator.mediaSession.setActionHandler("play", () => this.togglePlay());
      navigator.mediaSession.setActionHandler("pause", () => this.togglePlay());
      navigator.mediaSession.setActionHandler("previoustrack", () => this.playPrev());
      navigator.mediaSession.setActionHandler("nexttrack", () => this.playNext());
      navigator.mediaSession.setActionHandler("seekto", (details) => {
        if (details.seekTime !== undefined) {
          this.audio.currentTime = details.seekTime;
        }
      });
    }
  }

  // ==========================================
  // SYNCHRONIZED LYRICS (KARAOKE)
  // ==========================================
  async fetchLyrics(track) {
    this.lyricsData = [];
    this.currentLyricIndex = -1;
    this.dom.lyricsBody.innerHTML = '<div class="lyrics-loading">Поиск текста песни...</div>';

    try {
      const resp = await this.fetchApi(`/api/lyrics?title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artist)}&duration=${track.duration || 0}`);
      const data = await resp.json();

      if (data.syncedLyrics) {
        this.parseLrc(data.syncedLyrics);
        this.renderLyrics();
      } else if (data.plainLyrics) {
        this.renderPlainLyrics(data.plainLyrics);
      } else if (data.instrumental) {
        this.dom.lyricsBody.innerHTML = '<div class="lyrics-empty">🎵 Инструментальная композиция</div>';
      } else {
        this.dom.lyricsBody.innerHTML = '<div class="lyrics-empty">Текст для этого трека пока не найден</div>';
      }
    } catch (e) {
      this.dom.lyricsBody.innerHTML = '<div class="lyrics-empty">Не удалось загрузить текст песни</div>';
    }
  }

  parseLrc(lrcText) {
    const lines = lrcText.split("\n");
    const parsed = [];
    const timeRegex = /\[(\d{2}):(\d{2})\.?(\d{2,3})?\]/;

    for (const line of lines) {
      const match = timeRegex.exec(line);
      if (match) {
        const min = parseInt(match[1], 10);
        const sec = parseInt(match[2], 10);
        const ms = match[3] ? parseInt(match[3].padEnd(3, "0"), 10) : 0;
        const totalTime = min * 60 + sec + ms / 1000;
        const text = line.replace(timeRegex, "").trim();
        if (text) {
          parsed.push({ time: totalTime, text });
        }
      }
    }
    this.lyricsData = parsed.sort((a, b) => a.time - b.time);
  }

  renderLyrics() {
    this.dom.lyricsBody.innerHTML = "";
    this.lyricsData.forEach((item, index) => {
      const div = document.createElement("div");
      div.className = "lyrics-line";
      div.dataset.index = index;
      div.dataset.time = item.time;
      div.textContent = item.text;
      div.addEventListener("click", () => {
        this.audio.currentTime = item.time;
      });
      this.dom.lyricsBody.appendChild(div);
    });
  }

  renderPlainLyrics(plainText) {
    this.dom.lyricsBody.innerHTML = "";
    const lines = plainText.split("\n");
    lines.forEach(text => {
      if (!text.trim()) return;
      const div = document.createElement("div");
      div.className = "lyrics-line plain";
      div.textContent = text;
      this.dom.lyricsBody.appendChild(div);
    });
  }

  syncLyrics(currentTime) {
    if (!this.lyricsData.length || !this.lyricsOpen) return;

    let activeIdx = -1;
    for (let i = 0; i < this.lyricsData.length; i++) {
      if (currentTime >= this.lyricsData[i].time) {
        activeIdx = i;
      } else {
        break;
      }
    }

    if (activeIdx !== this.currentLyricIndex && activeIdx !== -1) {
      this.currentLyricIndex = activeIdx;
      const lines = this.dom.lyricsBody.querySelectorAll(".lyrics-line");
      lines.forEach((l, idx) => {
        if (idx === activeIdx) {
          l.classList.add("active");
          const containerHeight = this.dom.lyricsBody.clientHeight;
          const lineOffset = l.offsetTop - this.dom.lyricsBody.offsetTop;
          this.dom.lyricsBody.scrollTo({
            top: lineOffset - containerHeight / 2 + l.clientHeight / 2,
            behavior: "smooth"
          });
        } else {
          l.classList.remove("active");
        }
      });
    }
  }

  toggleLyricsOverlay() {
    this.lyricsOpen = !this.lyricsOpen;
    if (this.lyricsOpen) {
      this.dom.lyricsOverlay.classList.remove("hidden");
      this.dom.lyricsBtn.classList.add("active");
      if (this.currentTrack) {
        this.dom.lyricsBg.style.backgroundImage = `url("${this.currentTrack.artwork || ''}")`;
        this.syncLyrics(this.audio.currentTime);
      }
    } else {
      this.dom.lyricsOverlay.classList.add("hidden");
      this.dom.lyricsBtn.classList.remove("active");
    }
  }

  // ==========================================
  // QUEUE & PLAYLISTS
  // ==========================================
  addToQueue(track) {
    if (!track) return;
    const exists = this.queue.some(t => this.isTrackMatch(t, track));
    if (exists) {
      this.showToast(`Трек уже в очереди: ${track.title}`);
      return;
    }
    this.queue.push(track);
    this.renderQueue();
    this.showToast(`Добавлено в очередь: ${track.title}`);
  }

  renderQueue() {
    this.dom.queueList.innerHTML = "";
    this.dom.queueCount.textContent = this.queue.length;
    this.dom.queueBadge.textContent = this.queue.length;
    if (this.queue.length > 0) {
      this.dom.queueBadge.classList.remove("hidden");
    } else {
      this.dom.queueBadge.classList.add("hidden");
    }

    this.queue.forEach((track, idx) => {
      const item = document.createElement("div");
      item.className = `track-row ${idx === this.queueIndex ? 'active' : ''}`;
      item.innerHTML = `
        <span class="track-num">${idx + 1}</span>
        <img class="track-cover-mini" src="${track.artwork || ''}" alt="" />
        <div class="track-info-col">
          <div class="track-info-title">
            ${this.escapeHtml(track.title)}
            <span class="track-download-badge hidden" data-track-id="${track.id}" title="Скачано на устройство (офлайн доступно)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            </span>
          </div>
          <div class="track-info-artist">${this.escapeHtml(track.artist)}</div>
        </div>
      `;
      item.addEventListener("click", () => {
        this.queueIndex = idx;
        this.playTrack(track, false);
      });
      this.dom.queueList.appendChild(item);
    });
  }

  toggleQueueDrawer() {
    this.dom.queueDrawer.classList.toggle("open");
  }

  // ==========================================
  // TRENDING & SEARCH
  // ==========================================
  async loadTrending(country = "ru") {
    this.dom.trendingGrid.innerHTML = '<div class="lyrics-loading" style="grid-column: 1/-1;">Загрузка популярных треков...</div>';
    let loaded = false;
    if (this.apiBase) {
      try {
        const resp = await this.fetchApi(`/api/trending?country=${country}&limit=30`);
        const ctype = resp.headers.get("content-type") || "";
        if (ctype.includes("application/json")) {
          const data = await resp.json();
          if (data.results && data.results.length) {
            this.renderTrendingGrid(data.results);
            loaded = true;
          }
        }
      } catch (e) {}
    }

    if (!loaded) {
      try {
        const itCountry = country.toLowerCase() === "ru" ? "ru" : "us";
        const resp = await fetch(`https://itunes.apple.com/${itCountry}/rss/topsongs/limit=30/json`);
        const data = await resp.json();
        const entries = data.feed?.entry || [];
        const results = entries.map((entry, idx) => ({
          id: `top_${idx}_${Date.now()}`,
          title: entry["im:name"]?.label || "Unknown Title",
          artist: entry["im:artist"]?.label || "Unknown Artist",
          artwork: (entry["im:image"]?.[2]?.label || "").replace("170x170bb", "600x600bb"),
          stream_url: entry.link?.find(l => l.attributes?.type?.includes("audio"))?.attributes?.href || null,
          source: "itunes_top"
        }));
        if (results.length) {
          this.renderTrendingGrid(results);
          loaded = true;
        }
      } catch (e) {
        console.warn("iTunes top songs fallback error:", e);
      }
    }

    if (!loaded) {
      const defaultTracks = [
        { id: "def_1", title: "Никто", artist: "Алексей Горшенёв", artwork: "logo.jpg" },
        { id: "def_2", title: "Мгновение", artist: "ГОРШЕНЕВ", artwork: "logo.jpg" },
        { id: "def_3", title: "Кровавая Мэри", artist: "Ундервуд", artwork: "logo.jpg" },
        { id: "def_4", title: "Цветут цветы", artist: "Танцы Минус", artwork: "logo.jpg" },
        { id: "def_5", title: "Демоны", artist: "Смысловые Галлюцинации", artwork: "logo.jpg" },
        { id: "def_6", title: "Питер рок-н-ролл", artist: "Бригадный подряд, Михаил Горшенёв", artwork: "logo.jpg" },
        { id: "def_7", title: "Лесник", artist: "Король и Шут", artwork: "logo.jpg" },
        { id: "def_8", title: "Прыгну со скалы", artist: "Король и Шут", artwork: "logo.jpg" },
        { id: "def_9", title: "Кукла колдуна", artist: "Король и Шут", artwork: "logo.jpg" },
        { id: "def_10", title: "Blinding Lights", artist: "The Weeknd", artwork: "logo.jpg" },
        { id: "def_11", title: "Believer", artist: "Imagine Dragons", artwork: "logo.jpg" },
        { id: "def_12", title: "Bohemian Rhapsody", artist: "Queen", artwork: "logo.jpg" }
      ];
      this.renderTrendingGrid(defaultTracks);
    }
  }

  renderTrendingGrid(tracks) {
    this.dom.trendingGrid.innerHTML = "";
    const seen = new Set();
    const unique = [];
    for (const t of (tracks || [])) {
      const k = this.cleanTrackKey(t.artist, t.title);
      if (!seen.has(k)) {
        seen.add(k);
        unique.push(t);
      }
    }

    unique.forEach(track => {
      const card = document.createElement("div");
      card.className = "track-card";
      card.innerHTML = `
        <div class="card-img-wrapper">
          <img src="${track.artwork || ''}" alt="${this.escapeHtml(track.title)}" loading="lazy" />
          <button class="card-play-btn" title="Воспроизвести">
            <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </button>
        </div>
        <div class="card-title">${this.escapeHtml(track.title)}</div>
        <div class="card-artist">${this.escapeHtml(track.artist)}</div>
      `;
      card.addEventListener("click", () => {
        this.isWaveActive = false;
        this.playTrack(track);
      });
      this.dom.trendingGrid.appendChild(card);
    });
  }

  async performSearch(query) {
    if (!query || !query.trim()) return;
    this.switchView("search");
    this.dom.searchQueryLabel.textContent = `"${query}"`;
    this.dom.searchTrackList.innerHTML = '<div class="lyrics-loading" style="padding: 40px 0;">Поиск треков в каталоге...</div>';

    let results = [];
    if (this.apiBase) {
      try {
        const resp = await this.fetchApi(`/api/search?q=${encodeURIComponent(query)}&limit=30`);
        const ctype = resp.headers.get("content-type") || "";
        if (ctype.includes("application/json")) {
          const data = await resp.json();
          results = data.results || [];
        }
      } catch (e) {}
    }

    if (!results.length) {
      try {
        const itUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=30`;
        const itResp = await fetch(itUrl);
        const itData = await itResp.json();
        results = (itData.results || []).map(r => ({
          id: `itunes_${r.trackId}`,
          title: r.trackName,
          artist: r.artistName,
          album: r.collectionName,
          artwork: (r.artworkUrl100 || "").replace("100x100bb", "600x600bb"),
          duration: Math.round(r.trackTimeMillis / 1000),
          stream_url: r.previewUrl,
          source: "itunes"
        }));
      } catch (err) {
        console.warn("iTunes search error:", err);
      }
    }

    this.dom.searchResultsCount.textContent = `${results.length} треков найдено`;
    this.renderTrackList(this.dom.searchTrackList, results);
  }

  renderTrackList(container, tracks, options = {}) {
    container.innerHTML = "";
    if (!tracks || !tracks.length) {
      container.innerHTML = '<div class="lyrics-empty" style="padding: 40px 0;">Ничего не найдено</div>';
      return;
    }

    // Invariant: strictly 1 song across all 4 streams & formats
    const seen = new Set();
    const unique = [];
    for (const t of tracks) {
      const k = this.cleanTrackKey(t.artist, t.title);
      if (!seen.has(k)) {
        seen.add(k);
        unique.push(t);
      }
    }

    unique.forEach((track, idx) => {
      const isFav = this.favorites.some(t => this.isTrackMatch(t, track));
      const isDisliked = this.dislikes.some(t => this.isTrackMatch(t, track));
      const isCurrent = this.currentTrack && this.isTrackMatch(this.currentTrack, track);

      const row = document.createElement("div");
      row.className = `track-row ${isCurrent ? 'active' : ''}`;
      row.dataset.id = track.id;
      row.innerHTML = `
        <div class="track-num">${idx + 1}</div>
        <img class="track-cover-mini" src="${track.artwork || ''}" alt="" />
        <div class="track-info-col">
          <div class="track-info-title">
            ${this.escapeHtml(track.title)}
            <span class="track-download-badge hidden" data-track-id="${track.id}" title="Скачано на устройство (офлайн доступно)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            </span>
          </div>
          <div class="track-info-artist">${this.escapeHtml(track.artist)}</div>
        </div>
        <div class="track-album-col">${this.escapeHtml(track.album || track.genre || 'Single')}</div>
        <div class="track-time-col">${track.duration ? this.formatTime(track.duration) : '--:--'}</div>
        <div class="track-actions-col">
          <button class="icon-btn like-item-btn ${isFav ? 'liked' : ''}" title="Мне нравится (лайк)">
            <svg viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
          </button>
          <button class="icon-btn dislike-item-btn ${isDisliked ? 'disliked' : ''}" title="Не нравится (скрыть и исключить)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
              <line x1="3" y1="3" x2="21" y2="21" stroke-width="2.2"/>
            </svg>
          </button>
          <button class="icon-btn queue-item-btn" title="В очередь">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
      `;

      // Play on click
      row.addEventListener("click", (e) => {
        if (e.target.closest(".track-actions-col")) return;
        if (options.isWave) {
          this.isWaveActive = true;
          this.queue = [...this.waveQueue];
          this.queueIndex = idx;
          this.playTrack(track, false);
        } else {
          this.isWaveActive = false;
          this.playTrack(track);
        }
      });

      // Like item
      row.querySelector(".like-item-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleLike(track);
        const btn = row.querySelector(".like-item-btn");
        btn.classList.toggle("liked");
      });

      // Dislike item
      row.querySelector(".dislike-item-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleDislike(track);
        const btn = row.querySelector(".dislike-item-btn");
        btn.classList.toggle("disliked");
        // Animate row removal if in wave list
        if (options.isWave) {
          row.style.opacity = "0.3";
          row.style.pointerEvents = "none";
        }
      });

      // Queue item
      row.querySelector(".queue-item-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        this.addToQueue(track);
      });

      container.appendChild(row);

      // Check if downloaded offline
      if (window.offlineStorage) {
        window.offlineStorage.isTrackCached(track.id).then(isCached => {
          if (isCached) {
            const badge = row.querySelector(`.track-download-badge[data-track-id="${track.id}"]`);
            if (badge) badge.classList.remove("hidden");
          }
        });
      }
    });
  }

  // ==========================================
  // UI & NAVIGATION
  // ==========================================
  switchView(viewName) {
    document.querySelectorAll(".nav-item").forEach(item => {
      item.classList.toggle("active", item.dataset.view === viewName);
    });
    document.querySelectorAll(".m-nav-item").forEach(item => {
      item.classList.toggle("active", item.dataset.view === viewName);
    });

    this.dom.waveView.classList.add("hidden");
    this.dom.homeView.classList.add("hidden");
    this.dom.searchView.classList.add("hidden");
    this.dom.favoritesView.classList.add("hidden");
    this.dom.favoritesView.classList.remove("active-view");
    this.dom.dislikesView.classList.add("hidden");
    this.dom.dislikesView.classList.remove("active-view");

    if (viewName === "wave") {
      this.dom.waveView.classList.remove("hidden");
    } else if (viewName === "home" || viewName === "charts") {
      this.dom.homeView.classList.remove("hidden");
    } else if (viewName === "search") {
      this.dom.searchView.classList.remove("hidden");
    } else if (viewName === "favorites") {
      this.dom.favoritesView.classList.remove("hidden");
      this.dom.favoritesView.classList.add("active-view");
      this.renderFavorites();
    } else if (viewName === "dislikes") {
      this.dom.dislikesView.classList.remove("hidden");
      this.dom.dislikesView.classList.add("active-view");
      this.renderDislikes();
    }
  }

  setupUIListeners() {
    // Navigation
    document.querySelectorAll(".nav-item").forEach(btn => {
      btn.addEventListener("click", () => {
        const view = btn.dataset.view;
        if (view) this.switchView(view);
      });
    });

    // Mobile Navigation & Header
    document.querySelectorAll(".m-nav-item").forEach(btn => {
      btn.addEventListener("click", () => {
        const view = btn.dataset.view;
        if (view) this.switchView(view);
      });
    });

    if (this.dom.mobileProfileNavBtn) {
      this.dom.mobileProfileNavBtn.addEventListener("click", () => {
        if (this.currentUser) {
          this.openSettingsModal();
        } else {
          this.openAuthModal("login");
        }
      });
    }

    if (this.dom.mobileUserAvatar) {
      this.dom.mobileUserAvatar.addEventListener("click", () => {
        if (this.currentUser) {
          this.openSettingsModal();
        } else {
          this.openAuthModal("login");
        }
      });
    }

    if (this.dom.mobileSettingsBtn) {
      this.dom.mobileSettingsBtn.addEventListener("click", () => this.openSettingsModal());
    }

    if (this.dom.mobileLogoBtn) {
      this.dom.mobileLogoBtn.addEventListener("click", () => this.switchView("wave"));
    }

    if (this.dom.mobileSearchToggleBtn) {
      this.dom.mobileSearchToggleBtn.addEventListener("click", () => {
        this.switchView("search");
        setTimeout(() => this.dom.searchInput && this.dom.searchInput.focus(), 150);
      });
    }

    // Mini-player click on mobile -> open full mobile player
    const openMobileFullPlayer = () => {
      if (window.innerWidth <= 768 && this.dom.mobileFullPlayer) {
        this.dom.mobileFullPlayer.classList.remove("hidden");
      }
    };
    const playerBar = document.querySelector("footer.player-bar");
    if (playerBar) {
      playerBar.addEventListener("click", (e) => {
        if (window.innerWidth <= 768 && !e.target.closest("button") && !e.target.closest(".slider-wrapper")) {
          openMobileFullPlayer();
        }
      });
    }

    if (this.dom.closeFullPlayerBtn) {
      this.dom.closeFullPlayerBtn.addEventListener("click", () => {
        this.dom.mobileFullPlayer.classList.add("hidden");
      });
    }

    if (this.dom.mPlayBtn) this.dom.mPlayBtn.addEventListener("click", () => this.togglePlay());
    if (this.dom.mNextBtn) this.dom.mNextBtn.addEventListener("click", () => this.playNext());
    if (this.dom.mPrevBtn) this.dom.mPrevBtn.addEventListener("click", () => this.playPrev());
    if (this.dom.mLikeBtn) this.dom.mLikeBtn.addEventListener("click", () => this.toggleLike(this.currentTrack));
    if (this.dom.mDislikeBtn) this.dom.mDislikeBtn.addEventListener("click", () => this.toggleDislike(this.currentTrack));
    if (this.dom.mShuffleBtn) this.dom.mShuffleBtn.addEventListener("click", () => this.dom.shuffleBtn.click());
    if (this.dom.mRepeatBtn) this.dom.mRepeatBtn.addEventListener("click", () => this.dom.repeatBtn.click());
    if (this.dom.mPlayerQueueBtn) this.dom.mPlayerQueueBtn.addEventListener("click", () => {
      this.dom.mobileFullPlayer.classList.add("hidden");
      this.toggleQueue();
    });
    if (this.dom.mLyricsBtn) this.dom.mLyricsBtn.addEventListener("click", () => {
      this.dom.mobileFullPlayer.classList.add("hidden");
      this.toggleLyrics();
    });
    if (this.dom.mDownloadBtn) this.dom.mDownloadBtn.addEventListener("click", async () => {
      if (window.offlineStorage && this.currentTrack) {
        await window.offlineStorage.fetchAndCacheTrack(this.currentTrack, { isFavorite: true, isPreloaded: false });
        this.showToast("Трек сохранен для оффлайн!");
      }
    });

    if (this.dom.mProgressWrapper) {
      this.dom.mProgressWrapper.addEventListener("click", (e) => {
        const rect = this.dom.mProgressWrapper.getBoundingClientRect();
        const pct = ((e.clientX - rect.left) / rect.width) * 100;
        this.seek(pct);
      });
    }

    // Genre items
    document.querySelectorAll(".genre-item").forEach(btn => {
      btn.addEventListener("click", () => {
        const genre = btn.dataset.genre;
        this.dom.searchInput.value = genre;
        this.performSearch(genre);
      });
    });

    // Country select
    this.dom.countrySelect.addEventListener("change", (e) => {
      this.loadTrending(e.target.value);
    });

    // Live search
    let searchTimeout = null;
    this.dom.searchInput.addEventListener("input", (e) => {
      const val = e.target.value.trim();
      this.dom.searchClearBtn.classList.toggle("hidden", val.length === 0);
      clearTimeout(searchTimeout);
      if (val.length >= 2) {
        searchTimeout = setTimeout(() => this.performSearch(val), 400);
      }
    });

    this.dom.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        clearTimeout(searchTimeout);
        this.performSearch(this.dom.searchInput.value.trim());
      }
    });

    this.dom.searchClearBtn.addEventListener("click", () => {
      this.dom.searchInput.value = "";
      this.dom.searchClearBtn.classList.add("hidden");
      this.switchView("wave");
    });

    // Wave Mode Chips
    document.querySelectorAll(".wave-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        document.querySelectorAll(".wave-chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        const mode = chip.dataset.mode;
        this.loadWave(mode, this.isWaveActive);
      });
    });

    // Wave Action Buttons
    this.dom.startWaveBtn.addEventListener("click", () => this.startPersonalWave());
    this.dom.refreshWaveBtn.addEventListener("click", () => this.loadWave(this.waveMode, false));

    // Home Hero Buttons
    this.dom.heroWaveBtn.addEventListener("click", () => {
      this.switchView("wave");
      this.startPersonalWave();
    });
    this.dom.heroPlayBtn.addEventListener("click", () => {
      const firstCard = this.dom.trendingGrid.querySelector(".track-card");
      if (firstCard) firstCard.click();
    });
    this.dom.heroImportBtn.addEventListener("click", () => this.openImportModal());

    // Favorites Listen All
    this.dom.playAllFavsBtn.addEventListener("click", () => {
      if (this.favorites.length > 0) {
        this.isWaveActive = false;
        // Invariant deduplication: 1 song across all 4 streams
        const seen = new Set();
        const unique = [];
        for (const t of this.favorites) {
          const k = this.cleanTrackKey(t.artist, t.title);
          if (!seen.has(k)) {
            seen.add(k);
            unique.push(t);
          }
        }
        this.queue = unique;
        this.queueIndex = 0;
        this.renderQueue();
        this.playTrack(this.queue[0], false);
      }
    });

    // Player Buttons
    this.dom.playBtn.addEventListener("click", () => this.togglePlay());
    this.dom.nextBtn.addEventListener("click", () => this.playNext());
    this.dom.prevBtn.addEventListener("click", () => this.playPrev());

    this.dom.playerLikeBtn.addEventListener("click", () => {
      this.toggleLike(this.currentTrack);
    });

    this.dom.playerDislikeBtn.addEventListener("click", () => {
      this.toggleDislike(this.currentTrack);
    });

    this.dom.shuffleBtn.addEventListener("click", () => {
      this.isShuffle = !this.isShuffle;
      this.dom.shuffleBtn.classList.toggle("active", this.isShuffle);
      this.showToast(this.isShuffle ? "Случайный порядок включен" : "Случайный порядок выключен");
    });

    this.dom.repeatBtn.addEventListener("click", () => {
      this.repeatMode = (this.repeatMode + 1) % 3;
      if (this.repeatMode === 0) {
        this.dom.repeatBtn.classList.remove("active");
        this.dom.repeatOneIndicator.classList.add("hidden");
        this.showToast("Повтор выключен");
      } else if (this.repeatMode === 1) {
        this.dom.repeatBtn.classList.add("active");
        this.dom.repeatOneIndicator.classList.add("hidden");
        this.showToast("Повтор всех треков включен");
      } else {
        this.dom.repeatBtn.classList.add("active");
        this.dom.repeatOneIndicator.classList.remove("hidden");
        this.showToast("Повтор текущего трека включен");
      }
    });

    // Sliders
    this.dom.progressWrapper.addEventListener("click", (e) => {
      const rect = this.dom.progressWrapper.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      this.seek(pct);
    });

    this.dom.volumeWrapper.addEventListener("click", (e) => {
      const rect = this.dom.volumeWrapper.getBoundingClientRect();
      const val = (e.clientX - rect.left) / rect.width;
      this.setVolume(val);
    });

    this.dom.volumeBtn.addEventListener("click", () => {
      this.audio.muted = !this.audio.muted;
      this.updateVolumeIcon();
    });

    // Lyrics Triggers
    this.dom.lyricsBtn.addEventListener("click", () => this.toggleLyricsOverlay());
    this.dom.quickLyricsBtn.addEventListener("click", () => this.toggleLyricsOverlay());
    this.dom.playerCoverWrapper.addEventListener("click", () => this.toggleLyricsOverlay());
    this.dom.closeLyricsBtn.addEventListener("click", () => this.toggleLyricsOverlay());

    // Queue Triggers
    this.dom.queueBtn.addEventListener("click", () => this.toggleQueueDrawer());
    this.dom.closeQueueBtn.addEventListener("click", () => this.toggleQueueDrawer());
    this.dom.clearQueueBtn.addEventListener("click", () => {
      this.queue = this.currentTrack ? [this.currentTrack] : [];
      this.queueIndex = 0;
      this.renderQueue();
      this.showToast("Очередь очищена");
    });

    // User Profile & Auth Modal Triggers
    this.dom.userCard.addEventListener("click", () => {
      if (this.currentUser) {
        this.logout();
      } else {
        this.openAuthModal("login");
      }
    });
    this.dom.userActionBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.currentUser) {
        this.logout();
      } else {
        this.openAuthModal("login");
      }
    });

    this.dom.closeAuthModalBtn.addEventListener("click", () => this.closeAuthModal());
    this.dom.tabLogin.addEventListener("click", () => this.setAuthMode("login"));
    this.dom.tabRegister.addEventListener("click", () => this.setAuthMode("register"));
    this.dom.authForm.addEventListener("submit", (e) => this.handleAuthSubmit(e));

    // Import Modal Triggers
    this.dom.sidebarImportBtn.addEventListener("click", () => this.openImportModal());
    this.dom.topbarImportBtn.addEventListener("click", () => this.openImportModal());
    this.dom.closeImportModalBtn.addEventListener("click", () => this.closeImportModal());
    this.dom.cancelImportBtn.addEventListener("click", () => this.closeImportModal());
    this.dom.doImportBtn.addEventListener("click", () => this.executePlaylistImport());

    if (this.dom.importUrlInput && this.dom.importCounterBadge) {
      this.dom.importUrlInput.addEventListener("input", () => {
        const val = this.dom.importUrlInput.value.trim();
        if (!val) {
          this.dom.importCounterBadge.textContent = "";
          return;
        }
        if (val.startsWith("http")) {
          this.dom.importCounterBadge.textContent = "🔗 Ссылка";
        } else {
          const lines = val.split("\n").filter(l => l.trim().length > 0);
          this.dom.importCounterBadge.textContent = `📋 Треков: ${lines.length}`;
        }
      });
    }

    // Quick provider tags click to fill example in import textarea
    document.querySelectorAll(".provider-tag").forEach(tag => {
      tag.addEventListener("click", () => {
        const text = tag.textContent;
        if (text.includes("Spotify")) {
          this.dom.importUrlInput.value = "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M";
        } else if (text.includes("YouTube")) {
          this.dom.importUrlInput.value = "https://music.youtube.com/playlist?list=PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj";
        } else if (text.includes("Яндекс")) {
          this.dom.importUrlInput.value = "https://music.yandex.ru/users/yamusic-top/playlists/1076";
        } else if (text.includes("Apple")) {
          this.dom.importUrlInput.value = "https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb";
        } else if (text.includes("Текстовый")) {
          this.dom.importUrlInput.value = "Queen - Bohemian Rhapsody\nImagine Dragons - Believer\nThe Weeknd - Blinding Lights\nLinkin Park - Numb";
        }
      });
    });

    // Settings & Offline Triggers
    if (this.dom.topbarSettingsBtn) {
      this.dom.topbarSettingsBtn.addEventListener("click", () => this.openSettingsModal());
    }
    if (this.dom.sidebarSettingsBtn) {
      this.dom.sidebarSettingsBtn.addEventListener("click", () => this.openSettingsModal());
    }
    if (this.dom.closeSettingsModalBtn) {
      this.dom.closeSettingsModalBtn.addEventListener("click", () => this.closeSettingsModal());
    }
    this.updateBackendStatusUI();

    const recheckBtn = document.getElementById("recheckBackendBtn");
    if (recheckBtn) {
      recheckBtn.addEventListener("click", async () => {
        recheckBtn.disabled = true;
        recheckBtn.textContent = "Проверка...";
        await this.detectAndSelectBestBackend(true);
        recheckBtn.disabled = false;
        recheckBtn.textContent = "Проверить связь";
      });
    }
    if (this.dom.saveSettingsCloseBtn) {
      this.dom.saveSettingsCloseBtn.addEventListener("click", () => this.closeSettingsModal());
    }
    if (this.dom.favsDownloadAllQuickBtn) {
      this.dom.favsDownloadAllQuickBtn.addEventListener("click", () => this.downloadAllFavoritesAction());
    }
    if (this.dom.downloadAllFavoritesBtn) {
      this.dom.downloadAllFavoritesBtn.addEventListener("click", () => this.downloadAllFavoritesAction());
    }
    if (this.dom.clearStorageBtn) {
      this.dom.clearStorageBtn.addEventListener("click", () => this.clearStorageAction());
    }
    if (this.dom.saveYandexTokenBtn) {
      this.dom.saveYandexTokenBtn.addEventListener("click", () => this.saveYandexTokenAction());
    }
    if (this.dom.settingAutoDownloadToggle) {
      this.dom.settingAutoDownloadToggle.addEventListener("change", (e) => this.toggleAutoDownloadSetting(e.target.checked));
    }
    if (this.dom.settingPreloadToggle) {
      this.dom.settingPreloadToggle.addEventListener("change", (e) => this.togglePreloadSetting(e.target.checked));
    }
    if (this.dom.offlineBannerDismissBtn) {
      this.dom.offlineBannerDismissBtn.addEventListener("click", () => this.hideOfflineBanner());
    }
  }

  // ==========================================
  // KEYBOARD SHORTCUTS
  // ==========================================
  setupKeyboardShortcuts() {
    window.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
        if (e.key === "Escape") {
          e.target.blur();
          this.closeAuthModal();
          this.closeImportModal();
        }
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        this.togglePlay();
      } else if (e.code === "ArrowRight") {
        if (this.audio.duration) {
          this.audio.currentTime = Math.min(this.audio.duration, this.audio.currentTime + 5);
        }
      } else if (e.code === "ArrowLeft") {
        if (this.audio.duration) {
          this.audio.currentTime = Math.max(0, this.audio.currentTime - 5);
        }
      } else if (e.code === "ArrowUp") {
        e.preventDefault();
        this.setVolume(this.volume + 0.05);
      } else if (e.code === "ArrowDown") {
        e.preventDefault();
        this.setVolume(this.volume - 0.05);
      } else if (e.key === "l" || e.key === "L" || e.key === "д" || e.key === "Д") {
        this.toggleLyricsOverlay();
      } else if (e.key === "m" || e.key === "M" || e.key === "ь" || e.key === "Ь") {
        this.audio.muted = !this.audio.muted;
        this.updateVolumeIcon();
      } else if (e.key === "f" || e.key === "F" || e.key === "а" || e.key === "А") {
        // Toggle like shortcut
        this.toggleLike(this.currentTrack);
      } else if (e.key === "x" || e.key === "X" || e.key === "ч" || e.key === "Ч") {
        // Toggle dislike & skip shortcut
        this.toggleDislike(this.currentTrack);
      } else if (e.key === "/") {
        e.preventDefault();
        this.dom.searchInput.focus();
      } else if (e.key === "Escape") {
        if (this.lyricsOpen) this.toggleLyricsOverlay();
        this.dom.queueDrawer.classList.remove("open");
        this.closeAuthModal();
        this.closeImportModal();
      }
    });
  }

  // ==========================================
  // OFFLINE & PRELOAD BUFFER SUBSYSTEM
  // ==========================================
  setupNetworkAndOfflineListeners() {
    window.addEventListener("online", () => this.handleNetworkStateChange(true));
    window.addEventListener("offline", () => this.handleNetworkStateChange(false));

    // Listen to storage events (download finished, cleared, etc.)
    if (window.offlineStorage) {
      window.offlineStorage.addListener((track, status) => {
        if (status === "downloaded" && track) {
          // Update track row badge if rendered on screen
          const badge = document.querySelector(`.track-download-badge[data-track-id="${track.id}"]`);
          if (badge) badge.classList.remove("hidden");
          this.updateOfflineStats();
        } else if (status === "cleared" || status === "deleted") {
          this.updateOfflineStats();
          document.querySelectorAll(".track-download-badge").forEach(b => b.classList.add("hidden"));
        }
      });
    }

    this.updateNetworkBadge(navigator.onLine);
  }

  handleNetworkStateChange(isOnline) {
    this.isOnline = isOnline;
    this.updateNetworkBadge(isOnline);

    if (!isOnline) {
      this.showToast("📶 Соединение потеряно. Доигрываются 5 предзагруженных треков.");
      this.showOfflineBanner("Соединение с интернетом потеряно. Плеер использует предзагруженный буфер (до 5 песен).");
    } else {
      this.showToast("🟢 Интернет восстановлен! Синхронизация активна.");
      if (this.isOfflineFallbackActive) {
        this.showOfflineBanner("🟢 Интернет снова доступен! Нажмите «Мой поток», чтобы вернуться в онлайн-режим.");
      } else {
        this.hideOfflineBanner();
      }
      // Resume background preloading / downloads
      this.preloadUpcomingTracks(5);
    }
  }

  updateNetworkBadge(isOnline) {
    if (!this.dom.networkStatusBadge) return;
    if (isOnline) {
      this.dom.networkStatusBadge.className = "network-badge online";
      if (this.dom.networkStatusText) this.dom.networkStatusText.textContent = "В сети";
      this.dom.networkStatusBadge.title = "Интернет-соединение стабильно";
    } else {
      this.dom.networkStatusBadge.className = "network-badge offline";
      if (this.dom.networkStatusText) this.dom.networkStatusText.textContent = "Офлайн";
      this.dom.networkStatusBadge.title = "Нет подключения к интернету. Работает локальный буфер.";
    }
  }

  showOfflineBanner(message) {
    if (!this.dom.offlineBanner) return;
    if (this.dom.offlineBannerMessage && message) {
      this.dom.offlineBannerMessage.textContent = message;
    }
    this.dom.offlineBanner.classList.remove("hidden");
  }

  hideOfflineBanner() {
    if (!this.dom.offlineBanner) return;
    this.dom.offlineBanner.classList.add("hidden");
  }

  async initOfflineBadges() {
    this.updateNetworkBadge(navigator.onLine);
    this.updateBufferStatus();
    this.updateOfflineStats();
  }

  async updateBufferStatus() {
    if (!this.dom.bufferStatusText) return;
    if (!window.offlineStorage || this.queueIndex < 0) {
      this.dom.bufferStatusText.textContent = "Буфер: 5";
      return;
    }
    const upcoming = this.queue.slice(this.queueIndex + 1, this.queueIndex + 6);
    let ready = 0;
    for (const t of upcoming) {
      if (await window.offlineStorage.isTrackCached(t.id)) {
        ready++;
      }
    }
    this.dom.bufferStatusText.textContent = `Буфер: ${ready}/${upcoming.length || 5}`;
  }

  async preloadUpcomingTracks(count = 5) {
    if (!navigator.onLine || !window.offlineStorage) return;
    const preloadCount = await window.offlineStorage.getSetting("preload_count", 5);
    if (!preloadCount || preloadCount <= 0) return;

    // In wave mode, ensure we have at least `count` songs ahead in the queue
    if (this.isWaveActive && this.queue.length - this.queueIndex <= count) {
      try {
        await this.fetchNextWaveChunk();
      } catch (e) {}
    }

    const upcoming = this.queue.slice(this.queueIndex + 1, this.queueIndex + 1 + count);
    if (upcoming.length > 0) {
      window.offlineStorage.preloadUpcomingTracks(upcoming, count);
    }
    this.updateBufferStatus();
  }

  async activateOfflineFallback() {
    if (!window.offlineStorage) {
      this.showToast("📶 Офлайн: хранилище недоступно");
      return;
    }

    const downloaded = await window.offlineStorage.getDownloadedFavorites();
    if (downloaded && downloaded.length > 0) {
      this.isOfflineFallbackActive = true;
      if (this.queue.length > 0 && !this.savedOnlineQueue.length) {
        this.savedOnlineQueue = [...this.queue];
        this.savedOnlineQueueIndex = this.queueIndex;
      }

      // Convert downloaded records to track items
      const offlineTracks = downloaded.map(d => ({
        id: d.id,
        title: d.title,
        artist: d.artist,
        album: d.album || "Офлайн-коллекция",
        duration: d.duration || 0,
        artwork: d.artwork || "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=120&auto=format&fit=crop"
      }));

      this.queue = offlineTracks;
      this.queueIndex = 0;
      this.renderQueue();

      this.showOfflineBanner(`Буфер исчерпан. Включены ваши скачанные любимые песни (${offlineTracks.length} шт.)`);
      this.showToast(`📶 Офлайн: Играют скачанные любимые треки (${offlineTracks.length} шт.)`);

      await this.playTrack(offlineTracks[0], false);
    } else {
      this.showOfflineBanner("Интернет недоступен и нет скачанных любимых песен. Включите интернет для продолжения.");
      this.showToast("📶 Нет подключения к сети и нет скачанных песен");
      this.isPlaying = false;
      this.updatePlayState();
    }
  }

  // ==========================================
  // SETTINGS MODAL & OFFLINE ACTIONS
  // ==========================================
  async openSettingsModal() {
    if (!this.dom.settingsModal) return;

    if (window.offlineStorage) {
      const autoDl = await window.offlineStorage.getSetting("auto_download_favorites", true);
      const preload = await window.offlineStorage.getSetting("preload_count", 5);
      if (this.dom.settingAutoDownloadToggle) this.dom.settingAutoDownloadToggle.checked = !!autoDl;
      if (this.dom.settingPreloadToggle) this.dom.settingPreloadToggle.checked = preload > 0;
      await this.updateOfflineStats();
    }

    this.updateBackendStatusUI();

    // Check yandex token
    try {
      const res = await this.fetchApi("/api/settings/yandex-token");
      const data = await res.json();
      if (data.has_token && this.dom.yandexTokenInput) {
        this.dom.yandexTokenInput.placeholder = "Токен Яндекс.Музыки сохранён (введите новый для замены)";
      }
    } catch (e) {}

    this.dom.settingsModal.classList.remove("hidden");
  }

  closeSettingsModal() {
    if (this.dom.settingsModal) {
      this.dom.settingsModal.classList.add("hidden");
    }
  }

  async updateOfflineStats() {
    if (!window.offlineStorage) return;
    try {
      const stats = await window.offlineStorage.getStorageStats();
      if (this.dom.offlineFavsCount) this.dom.offlineFavsCount.textContent = stats.favCount;
      if (this.dom.offlineStorageSize) this.dom.offlineStorageSize.textContent = stats.formattedSize;
      if (this.dom.btnFavsTotalCount) this.dom.btnFavsTotalCount.textContent = this.favorites.length;
    } catch (e) {
      console.warn("Error updating offline stats:", e);
    }
  }

  async toggleAutoDownloadSetting(enabled) {
    if (!window.offlineStorage) return;
    await window.offlineStorage.setSetting("auto_download_favorites", enabled);
    this.showToast(enabled ? "✅ Автоскачивание любимых песен включено" : "❌ Автоскачивание выключено");

    if (enabled && this.favorites.length > 0) {
      window.offlineStorage.enqueueMultipleFavorites(this.favorites);
      this.showToast(`Начато фоновое скачивание ${this.favorites.length} любимых треков...`);
    }
  }

  async togglePreloadSetting(enabled) {
    if (!window.offlineStorage) return;
    await window.offlineStorage.setSetting("preload_count", enabled ? 5 : 0);
    this.showToast(enabled ? "⚡ Предзагрузка 5 песен включена" : "Предзагрузка выключена");
    if (enabled && this.currentTrack) {
      this.preloadUpcomingTracks(5);
    }
  }

  async downloadAllFavoritesAction() {
    if (!window.offlineStorage) return;
    if (this.favorites.length === 0) {
      this.showToast("В «Любимых треках» пока ничего нет");
      return;
    }

    if (!navigator.onLine) {
      this.showToast("📶 Для скачивания песен требуется подключение к интернету");
      return;
    }

    this.showToast(`Начато скачивание ${this.favorites.length} любимых треков в память...`);
    if (this.dom.downloadProgressBar) this.dom.downloadProgressBar.classList.remove("hidden");

    let total = this.favorites.length;
    let completed = 0;

    for (let i = 0; i < this.favorites.length; i++) {
      const track = this.favorites[i];
      const isDownloaded = await window.offlineStorage.isTrackFavoriteDownloaded(track.id);
      if (!isDownloaded) {
        await window.offlineStorage.fetchAndCacheTrack(track, { isFavorite: true, isPreloaded: false });
      }
      completed++;
      const pct = Math.round((completed / total) * 100);
      if (this.dom.downloadProgressFill) this.dom.downloadProgressFill.style.width = `${pct}%`;
      if (this.dom.downloadProgressLabel) this.dom.downloadProgressLabel.textContent = `${completed}/${total} (${pct}%)`;
    }

    await this.updateOfflineStats();
    setTimeout(() => {
      if (this.dom.downloadProgressBar) this.dom.downloadProgressBar.classList.add("hidden");
    }, 2000);
    this.showToast(`🎉 Все ${total} любимых треков скачаны в память устройства!`);
  }

  async clearStorageAction() {
    if (!window.offlineStorage) return;
    if (!confirm("Очистить все сохранённые аудиофайлы из памяти браузера?")) return;

    await window.offlineStorage.clearAllStorage();
    await this.updateOfflineStats();
    this.showToast("🗑️ Локальный кэш треков успешно очищен");
  }

  async saveYandexTokenAction() {
    const token = this.dom.yandexTokenInput ? this.dom.yandexTokenInput.value.trim() : "";
    if (!token) {
      this.showToast("Введите токен Яндекс Музыки");
      return;
    }

    try {
      const resp = await this.fetchApi("/api/settings/yandex-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
      });
      const data = await resp.json();
      if (resp.ok) {
        this.showToast("✅ Токен Яндекс.Музыки успешно сохранён!");
        if (this.dom.yandexTokenInput) this.dom.yandexTokenInput.value = "";
      } else {
        this.showToast(`Ошибка: ${data.detail || 'Не удалось сохранить'}`);
      }
    } catch (e) {
      this.showToast(`Ошибка соединения: ${e.message}`);
    }
  }

  savePlayerState() {
    if (this.currentTrack) {
      try {
        localStorage.setItem("musik_last_track", JSON.stringify(this.currentTrack));
        localStorage.setItem("musik_last_queue", JSON.stringify(this.queue.slice(0, 30)));
        localStorage.setItem("musik_last_index", String(this.queueIndex));
      } catch (e) {}
    }
  }

  restorePlayerState() {
    try {
      const lastTrack = JSON.parse(localStorage.getItem("musik_last_track") || "null");
      const lastQueue = JSON.parse(localStorage.getItem("musik_last_queue") || "[]");
      const lastIndex = parseInt(localStorage.getItem("musik_last_index") || "0", 10);
      if (lastTrack && !this.currentTrack) {
        this.currentTrack = lastTrack;
        this.queue = lastQueue.length ? lastQueue : [lastTrack];
        this.queueIndex = Math.max(0, lastIndex);
        this.dom.playerTitle.textContent = lastTrack.title;
        this.dom.playerArtist.textContent = lastTrack.artist;
        this.dom.playerCover.src = lastTrack.artwork || "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=120&auto=format&fit=crop";
        this.updateLikeDislikeButtons();
        this.renderQueue();
      }
    } catch (e) {}
  }

  // ==========================================
  // UTILITIES
  // ==========================================
  formatTime(secs) {
    if (!secs || isNaN(secs)) return "0:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  showToast(message) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    this.dom.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3200);
  }
}

// Launch app when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  window.app = new MusikApp();
});
