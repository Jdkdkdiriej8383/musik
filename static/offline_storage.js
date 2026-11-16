// ========================================================
// Musik 2.0 - Offline Storage & Caching Subsystem (IndexedDB)
// Handles:
// 1. Pre-buffering of 5 upcoming tracks for zero-latency seamless transitions
// 2. Offline audio storage for offline playback
// 3. Auto-downloading of favorite tracks (with Settings toggle)
// 4. Offline fallback queue when connection drops and buffer runs out
// ========================================================

class OfflineStorage {
  constructor() {
    this.dbName = "MusikOfflineDB";
    this.dbVersion = 2;
    this.db = null;
    this.isReady = false;

    // In-memory Object URL cache to ensure instant playback without async delays
    this.objectUrlCache = new Map(); // trackId -> objectUrl
    this.downloadQueue = [];
    this.activeDownloads = 0;
    this.maxConcurrentDownloads = 2;
    this.isProcessingQueue = false;

    // Listeners for download events: (track, status) => {}
    this.listeners = new Set();

    // Cache settings in memory
    this.settingsCache = {
      auto_download_favorites: true,
      preload_count: 5
    };

    // Track active fetch controllers to cancel if needed
    this.activeFetches = new Map();
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;

        // Tracks store: stores metadata and audio blob
        if (!db.objectStoreNames.contains("audio_cache")) {
          const trackStore = db.createObjectStore("audio_cache", { keyPath: "id" });
          trackStore.createIndex("isFavorite", "isFavorite", { unique: false });
          trackStore.createIndex("isPreloaded", "isPreloaded", { unique: false });
          trackStore.createIndex("savedAt", "savedAt", { unique: false });
        }

        // Settings store: key-value settings
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }
      };

      request.onsuccess = async (e) => {
        this.db = e.target.result;
        this.isReady = true;

        // Load settings
        await this.loadSettings();

        // Listen for online event to resume downloads
        window.addEventListener("online", () => {
          this.processDownloadQueue();
        });

        resolve(this);
      };

      request.onerror = (e) => {
        console.error("IndexedDB error:", e);
        reject(e);
      };
    });
  }

  // ==========================================
  // SETTINGS MANAGEMENT
  // ==========================================
  async loadSettings() {
    if (!this.db) return;
    try {
      const autoDl = await this.getSetting("auto_download_favorites", true);
      const preloadCount = await this.getSetting("preload_count", 5);
      this.settingsCache.auto_download_favorites = autoDl;
      this.settingsCache.preload_count = preloadCount;
    } catch (err) {
      console.warn("Failed loading offline settings:", err);
    }
  }

  async getSetting(key, defaultValue = null) {
    if (!this.db) return defaultValue;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction("settings", "readonly");
        const store = tx.objectStore("settings");
        const req = store.get(key);
        req.onsuccess = () => {
          if (req.result !== undefined && req.result !== null) {
            resolve(req.result.value);
          } else {
            resolve(defaultValue);
          }
        };
        req.onerror = () => resolve(defaultValue);
      } catch (e) {
        resolve(defaultValue);
      }
    });
  }

  async setSetting(key, value) {
    this.settingsCache[key] = value;
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction("settings", "readwrite");
        const store = tx.objectStore("settings");
        store.put({ key, value });
        tx.oncomplete = () => resolve(true);
        tx.onerror = (e) => reject(e);
      } catch (e) {
        reject(e);
      }
    });
  }

  get isAutoDownloadEnabled() {
    return !!this.settingsCache.auto_download_favorites;
  }

  // ==========================================
  // TRACK AUDIO BLOB STORAGE
  // ==========================================
  async saveTrackBlob(track, blob, options = {}) {
    if (!this.db || !track || !blob) return null;
    const isFavorite = options.isFavorite !== undefined ? Boolean(options.isFavorite) : false;
    const isPreloaded = options.isPreloaded !== undefined ? Boolean(options.isPreloaded) : true;

    // Check if track already exists, preserve isFavorite if previously favored
    const existing = await this.getTrack(track.id);
    const finalFavorite = isFavorite || (existing ? existing.isFavorite : false);

    const record = {
      id: String(track.id),
      title: track.title,
      artist: track.artist,
      album: track.album || track.genre || "",
      duration: track.duration || 0,
      artwork: track.artwork || "",
      blob: blob,
      mimeType: blob.type || "audio/webm",
      size: blob.size || 0,
      isFavorite: finalFavorite,
      isPreloaded: isPreloaded,
      savedAt: Date.now()
    };

    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction("audio_cache", "readwrite");
        const store = tx.objectStore("audio_cache");
        store.put(record);
        tx.oncomplete = () => {
          // Cache URL in memory
          const url = URL.createObjectURL(blob);
          this.objectUrlCache.set(String(track.id), url);
          this.notifyListeners(track, "downloaded");
          resolve(url);
        };
        tx.onerror = (e) => reject(e);
      } catch (e) {
        reject(e);
      }
    });
  }

  async getTrack(trackId) {
    if (!this.db || !trackId) return null;
    const strId = String(trackId);
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction("audio_cache", "readonly");
        const store = tx.objectStore("audio_cache");
        const req = store.get(strId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  async isTrackCached(trackId) {
    if (!trackId) return false;
    if (this.objectUrlCache.has(String(trackId))) return true;
    const track = await this.getTrack(trackId);
    return !!(track && track.blob);
  }

  async isTrackFavoriteDownloaded(trackId) {
    if (!trackId) return false;
    const track = await this.getTrack(trackId);
    return !!(track && track.blob && track.isFavorite);
  }

  async getTrackAudioUrl(trackId) {
    if (!trackId) return null;
    const strId = String(trackId);
    if (this.objectUrlCache.has(strId)) {
      return this.objectUrlCache.get(strId);
    }
    const item = await this.getTrack(strId);
    if (item && item.blob) {
      const url = URL.createObjectURL(item.blob);
      this.objectUrlCache.set(strId, url);
      return url;
    }
    return null;
  }

  async markFavorite(track, isFavorite = true) {
    if (!this.db || !track) return;
    const strId = String(track.id);
    const existing = await this.getTrack(strId);
    if (existing) {
      existing.isFavorite = isFavorite;
      const tx = this.db.transaction("audio_cache", "readwrite");
      tx.objectStore("audio_cache").put(existing);
    }
  }

  async deleteTrack(trackId) {
    if (!this.db || !trackId) return;
    const strId = String(trackId);

    // Revoke memory URL
    if (this.objectUrlCache.has(strId)) {
      try {
        URL.revokeObjectURL(this.objectUrlCache.get(strId));
      } catch (e) {}
      this.objectUrlCache.delete(strId);
    }

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction("audio_cache", "readwrite");
        tx.objectStore("audio_cache").delete(strId);
        tx.oncomplete = () => {
          this.notifyListeners({ id: strId }, "deleted");
          resolve(true);
        };
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  async getDownloadedFavorites() {
    if (!this.db) return [];
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction("audio_cache", "readonly");
        const store = tx.objectStore("audio_cache");
        const index = store.index("isFavorite");
        const req = index.getAll(true);
        req.onsuccess = () => {
          const results = (req.result || []).filter(item => item.blob && item.blob.size > 1024);
          resolve(results);
        };
        req.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
  }

  async getAllCachedTracks() {
    if (!this.db) return [];
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction("audio_cache", "readonly");
        const store = tx.objectStore("audio_cache");
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
  }

  async clearPreloadedCache() {
    if (!this.db) return;
    const all = await this.getAllCachedTracks();
    for (const item of all) {
      if (item.isPreloaded && !item.isFavorite) {
        await this.deleteTrack(item.id);
      }
    }
  }

  async clearAllStorage() {
    // Revoke all in-memory URLs
    for (const url of this.objectUrlCache.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch (e) {}
    }
    this.objectUrlCache.clear();

    if (!this.db) return;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction("audio_cache", "readwrite");
        tx.objectStore("audio_cache").clear();
        tx.oncomplete = () => {
          this.notifyListeners(null, "cleared");
          resolve(true);
        };
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  async getStorageStats() {
    const tracks = await this.getAllCachedTracks();
    let totalBytes = 0;
    let favCount = 0;
    let preloadedCount = 0;

    for (const t of tracks) {
      if (t.size) totalBytes += t.size;
      if (t.isFavorite) favCount++;
      if (t.isPreloaded && !t.isFavorite) preloadedCount++;
    }

    const mb = (totalBytes / (1024 * 1024)).toFixed(1);
    return {
      totalCount: tracks.length,
      favCount: favCount,
      preloadedCount: preloadedCount,
      totalBytes: totalBytes,
      formattedSize: `${mb} МБ`
    };
  }

  // ==========================================
  // PRELOAD BUFFER ENGINE (5 TRACKS AHEAD)
  // ==========================================
  async preloadUpcomingTracks(upcomingTracks, count = 5) {
    if (!navigator.onLine) return; // offline - cannot fetch
    const slice = upcomingTracks.slice(0, count);

    for (const track of slice) {
      if (!track || !track.id) continue;
      const strId = String(track.id);

      // Check if already in memory or indexedDB
      if (this.objectUrlCache.has(strId)) continue;
      const isCached = await this.isTrackCached(strId);
      if (isCached) {
        // Just warm up the memory URL
        await this.getTrackAudioUrl(strId);
        continue;
      }

      // Fetch in background
      this.fetchAndCacheTrack(track, { isFavorite: false, isPreloaded: true });
    }
  }

  async fetchAndCacheTrack(track, options = {}) {
    if (!track || !track.title || !track.artist) return null;
    const strId = String(track.id);

    // Prevent duplicate active fetches
    if (this.activeFetches.has(strId)) {
      return this.activeFetches.get(strId);
    }

    const fetchPromise = (async () => {
      try {
        const streamUrl = `/api/stream?title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artist)}`;
        const controller = new AbortController();
        const signal = controller.signal;

        const response = await fetch(streamUrl, { signal });
        if (!response.ok) {
          throw new Error(`Stream fetch failed: HTTP ${response.status}`);
        }

        const blob = await response.blob();
        if (blob && blob.size > 1024) {
          const url = await this.saveTrackBlob(track, blob, options);
          return url;
        }
        return null;
      } catch (err) {
        console.warn(`Preload/download failed for "${track.artist} - ${track.title}":`, err.message);
        return null;
      } finally {
        this.activeFetches.delete(strId);
      }
    })();

    this.activeFetches.set(strId, fetchPromise);
    return fetchPromise;
  }

  // ==========================================
  // AUTO-DOWNLOAD FAVORITES QUEUE
  // ==========================================
  enqueueDownload(track, force = false) {
    if (!track) return;
    if (!force && !this.isAutoDownloadEnabled) {
      return; // Setting is disabled
    }

    const strId = String(track.id);
    // Don't enqueue if already queued or downloading
    if (this.downloadQueue.some(t => String(t.id) === strId)) return;
    if (this.activeFetches.has(strId)) return;

    this.downloadQueue.push(track);
    this.notifyListeners(track, "queued");
    this.processDownloadQueue();
  }

  async enqueueMultipleFavorites(tracks, force = false) {
    if (!force && !this.isAutoDownloadEnabled) return;
    for (const track of tracks) {
      if (track) this.enqueueDownload(track, force);
    }
  }

  async processDownloadQueue() {
    if (this.isProcessingQueue) return;
    if (!navigator.onLine) return; // Wait until online

    this.isProcessingQueue = true;

    while (this.downloadQueue.length > 0 && navigator.onLine) {
      const track = this.downloadQueue.shift();
      const strId = String(track.id);

      // Check if already downloaded
      const isAlready = await this.isTrackFavoriteDownloaded(strId);
      if (isAlready) {
        this.notifyListeners(track, "already_downloaded");
        continue;
      }

      this.notifyListeners(track, "downloading");
      await this.fetchAndCacheTrack(track, { isFavorite: true, isPreloaded: false });
    }

    this.isProcessingQueue = false;
  }

  // ==========================================
  // EVENT LISTENERS
  // ==========================================
  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notifyListeners(track, status) {
    for (const cb of this.listeners) {
      try {
        cb(track, status);
      } catch (e) {
        console.error("Listener error:", e);
      }
    }
  }
}

// Global instance
window.offlineStorage = new OfflineStorage();
window.addEventListener("DOMContentLoaded", () => {
  window.offlineStorage.init().then(() => {
    console.log("💾 OfflineStorage initialized successfully");
  }).catch((err) => {
    console.error("Failed to initialize OfflineStorage:", err);
  });
});
