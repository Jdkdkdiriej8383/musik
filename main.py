import asyncio
import os
import re
import urllib.parse
from typing import Optional, Dict, Any, List

import httpx
from fastapi import FastAPI, Query, Request, HTTPException, Header, Depends
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import yt_dlp
import uvicorn

import db
import recommendation
import importer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

# Ensure database tables exist
db.init_db()

app = FastAPI(title="Musik 2.0 API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if not os.path.exists(STATIC_DIR):
    os.makedirs(STATIC_DIR, exist_ok=True)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# In-memory stream cache: query -> {url, headers, title, duration}
STREAM_CACHE: Dict[str, Dict[str, Any]] = {}
resolve_lock = asyncio.Lock()


# ==========================================
# AUTH HELPERS
# ==========================================
def get_current_user(authorization: Optional[str] = Header(None)) -> Optional[Dict[str, Any]]:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.split("Bearer ", 1)[1].strip()
    return db.get_user_by_token(token)


# ==========================================
# 0. ROOT & STATIC FILES
# ==========================================
@app.get("/")
async def get_index():
    index_file = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {"message": "Musik 2.0 backend running."}


# ==========================================
# 1. AUTH ENDPOINTS (MULTI-DEVICE ACCOUNTS)
# ==========================================
@app.post("/api/auth/register")
async def register(payload: Dict[str, Any]):
    username = payload.get("username", "").strip()
    password = payload.get("password", "")
    email = payload.get("email")
    display_name = payload.get("display_name") or username

    if not username or len(username) < 2:
        raise HTTPException(status_code=400, detail="Имя пользователя должно содержать не менее 2 символов")
    if not password or len(password) < 4:
        raise HTTPException(status_code=400, detail="Пароль должен содержать не менее 4 символов")

    try:
        user = db.create_user(username=username, password=password, email=email, display_name=display_name)
    except Exception as e:
        raise HTTPException(status_code=409, detail="Пользователь с таким именем или email уже существует")

    token = db.create_session(user["id"], device_name=payload.get("device_name", "Web Browser"))
    return {
        "token": token,
        "user": user
    }


@app.post("/api/auth/login")
async def login(payload: Dict[str, Any]):
    login_name = (payload.get("login") or payload.get("username") or "").strip()
    password = payload.get("password", "")
    device_name = payload.get("device_name", "Web Browser")

    if not login_name or not password:
        raise HTTPException(status_code=400, detail="Введите логин и пароль")

    user = db.authenticate_user(login_name, password)
    if not user:
        raise HTTPException(status_code=401, detail="Неверное имя пользователя или пароль")

    token = db.create_session(user["id"], device_name=device_name)
    return {
        "token": token,
        "user": user
    }


@app.get("/api/auth/me")
async def get_me(user: Optional[Dict[str, Any]] = Depends(get_current_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Не авторизован")
    return {"authenticated": True, "user": user}


@app.post("/api/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split("Bearer ", 1)[1].strip()
        db.delete_session(token)
    return {"status": "ok"}


# ==========================================
# 2. USER DATA & LIBRARY
# ==========================================
@app.get("/api/user/library")
async def get_library(user: Optional[Dict[str, Any]] = Depends(get_current_user)):
    if not user:
        return {"likes": [], "dislikes": [], "history": []}

    user_id = user["id"]
    likes = db.get_user_likes(user_id)
    dislikes = db.get_user_dislikes(user_id)
    history = db.get_user_history(user_id, limit=60)
    return {"likes": likes, "dislikes": dislikes, "history": history}


@app.post("/api/user/like")
async def add_like(track: Dict[str, Any], user: Optional[Dict[str, Any]] = Depends(get_current_user)):
    if not user:
        return {"status": "guest_ok"}
    db.add_like(user["id"], track)
    return {"status": "ok"}


@app.delete("/api/user/like/{track_id}")
async def remove_like(track_id: str, artist: str = "", title: str = "", user: Optional[Dict[str, Any]] = Depends(get_current_user)):
    if not user:
        return {"status": "guest_ok"}
    db.remove_like(user["id"], track_id, artist=artist, title=title)
    return {"status": "ok"}


@app.post("/api/user/dislike")
async def add_dislike(track: Dict[str, Any], user: Optional[Dict[str, Any]] = Depends(get_current_user)):
    if not user:
        return {"status": "guest_ok"}
    db.add_dislike(user["id"], track)
    return {"status": "ok"}


@app.delete("/api/user/dislike/{track_id}")
async def remove_dislike(track_id: str, artist: str = "", title: str = "", user: Optional[Dict[str, Any]] = Depends(get_current_user)):
    if not user:
        return {"status": "guest_ok"}
    db.remove_dislike(user["id"], track_id, artist=artist, title=title)
    return {"status": "ok"}


@app.post("/api/user/history")
async def record_history(payload: Dict[str, Any], user: Optional[Dict[str, Any]] = Depends(get_current_user)):
    if not user:
        return {"status": "guest_ok"}
    track = payload.get("track") or payload
    listened = payload.get("listened_seconds", 0)
    skipped = bool(payload.get("skipped", False))
    db.record_history(user["id"], track, listened_seconds=listened, skipped=skipped)
    return {"status": "ok"}


# ==========================================
# 3. PERSONAL WAVE ("МОЙ ПОТОК") ENGINE
# ==========================================
@app.get("/api/stream/wave")
async def get_stream_wave(
    mode: str = "default",
    limit: int = 15,
    country: str = "ru",
    user: Optional[Dict[str, Any]] = Depends(get_current_user)
):
    """
    Intelligent recommendation engine:
    1. Reads user likes & dislikes.
    2. Builds personalized wave based on liked artists, genre preferences, and selected mode.
    3. Strictly filters out disliked songs.
    4. Falls back to curated trending + mood seeds if no likes.
    """
    user_id = user["id"] if user else None
    return await recommendation.get_personalized_wave(user_id=user_id, mode=mode, limit=limit, country=country)


# ==========================================
# 4. PLAYLIST IMPORT ENDPOINT
# ==========================================
@app.post("/api/import/playlist")
async def import_playlist(payload: Dict[str, Any], user: Optional[Dict[str, Any]] = Depends(get_current_user)):
    """
    Imports playlists from:
    1. Spotify playlists / albums
    2. Apple Music playlists / albums
    3. YouTube / YouTube Music playlist links
    4. Yandex Music lists
    5. Plain text lists in any format (Artist - Title, table-copied text, etc.)
    Automatically matches in iTunes, auto-likes for logged in users, and returns tracks to frontend!
    """
    input_str = (payload.get("url") or payload.get("text") or "").strip()
    if not input_str:
        raise HTTPException(status_code=400, detail="Введите ссылку на плейлист или список треков")

    user_id = user["id"] if user else None
    try:
        result = await importer.import_playlist_and_auto_like(user_id, input_str)
        return result
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка при импорте: {str(e)}")


# ==========================================
# 5. SEARCH & TRENDING ENDPOINTS
# ==========================================
@app.get("/api/search")
async def search_tracks(q: str = Query(..., min_length=1), limit: int = 30):
    url = "https://itunes.apple.com/search"
    params = {"term": q, "entity": "song", "limit": min(limit, 50)}
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Search service error: {str(e)}")

    results = []
    for item in data.get("results", []):
        art = item.get("artworkUrl100", "").replace("100x100bb", "600x600bb")
        results.append({
            "id": str(item.get("trackId")),
            "title": item.get("trackName", "Unknown Title"),
            "artist": item.get("artistName", "Unknown Artist"),
            "album": item.get("collectionName", "Single"),
            "duration": (item.get("trackTimeMillis", 0) or 0) // 1000,
            "artwork": art,
            "previewUrl": item.get("previewUrl"),
            "releaseDate": item.get("releaseDate", "")[:10],
            "genre": item.get("primaryGenreName", "Music"),
        })

    return {"results": results}


@app.get("/api/trending")
async def get_trending(country: str = "ru", limit: int = 30):
    country = country.lower().strip()
    if country not in ["us", "ru", "gb", "de", "fr", "jp", "kr"]:
        country = "ru"

    url = f"https://itunes.apple.com/{country}/rss/topsongs/limit={limit}/json"
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Failed to fetch trending: {str(e)}")

    entries = data.get("feed", {}).get("entry", [])
    results = []
    for item in entries:
        try:
            track_id = item.get("id", {}).get("attributes", {}).get("im:id", "")
            title = item.get("im:name", {}).get("label", "Unknown Title")
            artist = item.get("im:artist", {}).get("label", "Unknown Artist")
            images = item.get("im:image", [])
            artwork = images[-1]["label"].replace("170x170bb", "600x600bb") if images else ""

            results.append({
                "id": track_id or f"{artist}-{title}",
                "title": title,
                "artist": artist,
                "album": item.get("im:collection", {}).get("im:name", {}).get("label", "Single"),
                "duration": 0,
                "artwork": artwork,
                "genre": item.get("category", {}).get("attributes", {}).get("label", "Music"),
            })
        except Exception:
            continue

    return {"results": results}


# ==========================================
# 6. SYNCHRONIZED LYRICS (LRCLIB)
# ==========================================
@app.get("/api/lyrics")
async def get_lyrics(title: str, artist: str, duration: Optional[int] = None):
    url = "https://lrclib.net/api/get"
    params = {"track_name": title, "artist_name": artist}
    if duration and duration > 0:
        params["duration"] = duration

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(url, params=params)
            if resp.status_code == 200:
                data = resp.json()
                return {
                    "syncedLyrics": data.get("syncedLyrics"),
                    "plainLyrics": data.get("plainLyrics"),
                    "instrumental": data.get("instrumental", False),
                }
        except Exception:
            pass

        # Fallback search
        try:
            search_resp = await client.get("https://lrclib.net/api/search", params={"q": f"{artist} {title}"})
            if search_resp.status_code == 200:
                items = search_resp.json()
                if items and isinstance(items, list):
                    best = items[0]
                    return {
                        "syncedLyrics": best.get("syncedLyrics"),
                        "plainLyrics": best.get("plainLyrics"),
                        "instrumental": best.get("instrumental", False),
                    }
        except Exception:
            pass

    return {"syncedLyrics": None, "plainLyrics": None, "instrumental": False}


# ==========================================
# 7. AUDIO STREAM PROXY (HTTP 206 PARTIAL CONTENT)
# ==========================================
try:
    from yandex_music import Client as YMClient
except ImportError:
    YMClient = None


def clean_search_term(text: str) -> str:
    cleaned = re.sub(r'[\(\[].*?[\)\]]', '', text)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned


CYR_TO_LAT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh',
    'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
    'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts',
    'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu',
    'я': 'ya'
}

ARTIST_ALIASES = {
    "король и шут": "Korol i Shut",
    "ундервуд": "Undervud",
    "би-2": "Bi-2",
    "сплин": "Splean",
    "кукрыниксы": "Kukryniksy",
    "алексей горшенев": "Alexey Gorshenev",
    "алексей горшенёв": "Alexey Gorshenev",
    "горшенев": "Gorshenev",
    "горшенёв": "Gorshenev",
    "мумий тролль": "Mumiy Troll",
    "7б": "7B",
    "агата кристи": "Agata Kristi",
    "пикник": "Piknik",
    "смысловые галлюцинации": "Smyslovye Gallyutsinatsii",
    "наутилус помпилиус": "Nautilus Pompilius",
    "бригадный подряд": "Brigadny Podryad",
    "кино": "Kino",
}

def transliterate_text(text: str) -> str:
    res = []
    for ch in text:
        low = ch.lower()
        if low in CYR_TO_LAT:
            trans = CYR_TO_LAT[low]
            res.append(trans.upper() if ch.isupper() else trans)
        else:
            res.append(ch)
    return "".join(res)


def _try_yandex_music(artist: str, title: str) -> Optional[Dict[str, Any]]:
    """Tries resolving audio from Yandex Music with or without token."""
    if not YMClient:
        return None
    token = os.environ.get("YANDEX_MUSIC_TOKEN") or db.get_setting("yandex_music_token")
    try:
        client = YMClient(token=token).init() if token else YMClient().init()
        query = f"{artist} {title}".strip()
        search_res = client.search(query, type_="track")
        if search_res and search_res.tracks and search_res.tracks.results:
            t = search_res.tracks.results[0]
            try:
                dinfo = t.get_download_info()
                if dinfo:
                    direct_url = dinfo[0].get_direct_link()
                    return {
                        "url": direct_url,
                        "headers": {"User-Agent": "Yandex-Music-API"},
                        "title": f"{t.artists[0].name if t.artists else ''} - {t.title}",
                        "duration": t.duration_ms // 1000 if t.duration_ms else 0,
                        "source": "yandex_music"
                    }
            except Exception:
                pass
    except Exception:
        pass
    return None


def _extract_stream_sync(title: str, artist: str) -> Dict[str, Any]:
    query = f"{artist} - {title}".strip()
    cleaned_artist = clean_search_term(artist)
    cleaned_title = clean_search_term(title)
    cleaned_query = f"{cleaned_artist} - {cleaned_title}".strip()

    # Transliteration and alias fallback (e.g. Russian Rock & International tracks)
    trans_artist = ARTIST_ALIASES.get(cleaned_artist.lower(), transliterate_text(cleaned_artist))
    trans_title = transliterate_text(cleaned_title)
    trans_query = f"{trans_artist} - {trans_title}".strip()

    search_attempts = [
        f"ytsearch1:{query} audio",
        f"ytsearch1:{query}",
        f"ytsearch1:{cleaned_query} audio",
        f"ytsearch1:{cleaned_query}",
        f"ytsearch1:{cleaned_artist} {cleaned_title} official",
        f"ytsearch1:{cleaned_artist} {cleaned_title} spotify",
    ]
    if trans_query != cleaned_query and trans_query:
        search_attempts.append(f"ytsearch1:{trans_query} audio")
        search_attempts.append(f"ytsearch1:{trans_query}")

    ydl_opts = {
        "format": "bestaudio/best",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "extract_flat": False,
        "skip_download": True,
    }

    # 1. Primary: YouTube Music & YouTube with Spotify hints
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        for sa in search_attempts:
            try:
                info = ydl.extract_info(sa, download=False)
                if info and "entries" in info and info["entries"]:
                    entry = info["entries"][0]
                    return {
                        "url": entry["url"],
                        "headers": entry.get("http_headers", {}),
                        "title": entry.get("title", query),
                        "duration": entry.get("duration", 0),
                        "source": "youtube_music"
                    }
            except Exception:
                continue

    # 2. Secondary: Yandex Music fallback (without token or with token)
    ym_res = _try_yandex_music(artist, title)
    if ym_res:
        return ym_res

    # 3. Tertiary: SoundCloud
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            for sc_term in [f"scsearch1:{cleaned_query}", f"scsearch1:{trans_query}", f"scsearch1:{query}"]:
                try:
                    sc_info = ydl.extract_info(sc_term, download=False)
                    if sc_info and "entries" in sc_info and sc_info["entries"]:
                        entry = sc_info["entries"][0]
                        return {
                            "url": entry["url"],
                            "headers": entry.get("http_headers", {}),
                            "title": entry.get("title", query),
                            "duration": entry.get("duration", 0),
                            "source": "soundcloud"
                        }
                except Exception:
                    continue
    except Exception:
        pass

    raise Exception(f"Не удалось найти аудиодорожку ни на YouTube Music, ни на Яндекс.Музыке/Spotify: {query}")


async def get_stream_info(title: str, artist: str) -> Dict[str, Any]:
    query_key = f"{artist} - {title}".lower().strip()
    if query_key in STREAM_CACHE:
        return STREAM_CACHE[query_key]

    async with resolve_lock:
        if query_key in STREAM_CACHE:
            return STREAM_CACHE[query_key]
        loop = asyncio.get_running_loop()
        stream_data = await loop.run_in_executor(None, _extract_stream_sync, title, artist)
        STREAM_CACHE[query_key] = stream_data
        return stream_data


@app.get("/api/settings/yandex-token")
async def get_yandex_token():
    token = db.get_setting("yandex_music_token")
    return {"has_token": bool(token)}


@app.post("/api/settings/yandex-token")
async def set_yandex_token(payload: Dict[str, Any]):
    token = (payload.get("token") or "").strip()
    db.set_setting("yandex_music_token", token)
    return {"status": "ok", "has_token": bool(token)}


@app.get("/api/stream")
async def stream_audio(title: str, artist: str, request: Request):
    try:
        info = await get_stream_info(title, artist)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Audio resolution failed: {str(e)}")

    stream_url = info["url"]
    upstream_headers = dict(info.get("headers", {}))

    client_range = request.headers.get("range")
    if client_range:
        upstream_headers["range"] = client_range

    # Use infinite read timeout so long pauses or scrubbing never trigger ReadTimeout
    client_timeout = httpx.Timeout(connect=15.0, read=None, write=15.0, pool=None)
    client = httpx.AsyncClient(timeout=client_timeout)
    try:
        req = client.build_request("GET", stream_url, headers=upstream_headers)
        upstream_resp = await client.send(req, stream=True)
    except Exception as e:
        await client.aclose()
        raise HTTPException(status_code=502, detail=f"Upstream stream connection error: {str(e)}")

    forward_headers = {}
    for h in ["content-type", "content-length", "content-range", "accept-ranges"]:
        if h in upstream_resp.headers:
            forward_headers[h] = upstream_resp.headers[h]

    if "accept-ranges" not in forward_headers:
        forward_headers["accept-ranges"] = "bytes"

    async def aiter_chunks():
        try:
            async for chunk in upstream_resp.aiter_bytes(chunk_size=65536):
                yield chunk
        except (httpx.HTTPError, asyncio.CancelledError):
            # Client disconnected, skipped track, or stream closed
            pass
        finally:
            await upstream_resp.aclose()
            await client.aclose()

    return StreamingResponse(
        aiter_chunks(),
        status_code=upstream_resp.status_code,
        headers=forward_headers,
    )


# Serve root static files (for seamless relative paths)
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="root_static")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    print("=" * 60)
    print("🎵 Musik 2.0 Server with Personal Wave & Multi-Device Auth")
    print(f"🌐 Server starting on http://0.0.0.0:{port}")
    print("=" * 60)
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
