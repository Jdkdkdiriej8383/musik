import re
import json
import httpx
import requests
import asyncio
from typing import List, Dict, Any, Tuple, Optional
import yt_dlp
import db

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
}


def _clean_track_title(title: str) -> str:
    """Removes common YouTube fluff like '(Official Video)', '[HD]', etc."""
    cleaned = re.sub(r'\(.*?official.*?video.*?\)', '', title, flags=re.IGNORECASE)
    cleaned = re.sub(r'\[.*?official.*?video.*?\]', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\(.*?lyric.*?video.*?\)', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\[.*?lyric.*?video.*?\]', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\(.*?audio.*?\)', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\[.*?audio.*?\]', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\(.*?clip.*?\)', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\(.*?hd.*?\)', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\[.*?hd.*?\]', '', cleaned, flags=re.IGNORECASE)
    return cleaned.strip()


async def match_track_itunes(client: httpx.AsyncClient, artist: str, title: str) -> Dict[str, Any]:
    """
    Searches iTunes for artist + title to get canonical artwork, genre, album, and duration.
    Falls back gracefully if not found.
    """
    term = f"{artist} {title}".strip()
    search_url = "https://itunes.apple.com/search"
    params = {"term": term, "entity": "song", "limit": 1}
    try:
        resp = await client.get(search_url, params=params, timeout=5.0)
        if resp.status_code == 200:
            data = resp.json()
            results = data.get("results", [])
            if results:
                item = results[0]
                artwork = item.get("artworkUrl100", "").replace("100x100bb", "600x600bb")
                return {
                    "id": str(item.get("trackId")),
                    "title": title,
                    "artist": item.get("artistName", artist or "Unknown Artist"),
                    "album": item.get("collectionName", "Single"),
                    "duration": (item.get("trackTimeMillis", 0) or 0) // 1000,
                    "artwork": artwork or "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop",
                    "genre": item.get("primaryGenreName", "Rock"),
                }
    except Exception:
        pass

    # Secondary attempt with cleaned title (strip brackets like '(Radio Edit)', '(Концерт...)')
    clean_title = re.sub(r'[\(\[].*?[\)\]]', '', title).strip()
    if clean_title and clean_title != title:
        try:
            resp2 = await client.get(search_url, params={"term": f"{artist} {clean_title}", "entity": "song", "limit": 1}, timeout=5.0)
            if resp2.status_code == 200:
                results2 = resp2.json().get("results", [])
                if results2:
                    item = results2[0]
                    artwork = item.get("artworkUrl100", "").replace("100x100bb", "600x600bb")
                    return {
                        "id": str(item.get("trackId")),
                        "title": title,
                        "artist": item.get("artistName", artist or "Unknown Artist"),
                        "album": item.get("collectionName", "Single"),
                        "duration": (item.get("trackTimeMillis", 0) or 0) // 1000,
                        "artwork": artwork,
                        "genre": item.get("primaryGenreName", "Rock"),
                    }
        except Exception:
            pass

    # Fallback track representation (never drops any song!)
    clean_id = f"{artist.lower().replace(' ', '_')}-{title.lower().replace(' ', '_')}"
    return {
        "id": clean_id,
        "title": title,
        "artist": artist or "Various Artists",
        "album": "Imported",
        "duration": 0,
        "artwork": "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop",
        "genre": "Rock",
    }


def parse_spotify(url: str) -> Tuple[str, List[Dict[str, str]]]:
    """
    Extracts playlist/album title and raw tracks from Spotify embed.
    """
    embed_url = re.sub(r'open\.spotify\.com/(playlist|album)/', r'open.spotify.com/embed/\1/', url)
    if '?' in embed_url:
        embed_url = embed_url.split('?')[0]

    resp = requests.get(embed_url, headers=HEADERS, timeout=12)
    if resp.status_code != 200:
        raise ValueError(f"Не удалось открыть страницу Spotify (код {resp.status_code})")

    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', resp.text)
    if not m:
        raise ValueError("Не удалось извлечь данные плейлиста Spotify")

    data = json.loads(m.group(1))
    props = data.get("props", {}).get("pageProps", {})
    state = props.get("state", {}).get("data", {})
    entity = state.get("entity", {})
    playlist_name = entity.get("name", "Spotify Playlist")
    raw_tracks = entity.get("trackList", [])

    results = []
    for item in raw_tracks:
        title = item.get("title", "").strip()
        subtitle = item.get("subtitle", "").strip()
        artist = subtitle.replace('\xa0', ' ').strip()
        if title:
            results.append({"title": title, "artist": artist or "Unknown Artist"})

    return playlist_name, results


def parse_apple_music(url: str) -> Tuple[str, List[Dict[str, str]]]:
    """
    Extracts playlist/album title and tracks from Apple Music public page.
    """
    resp = requests.get(url, headers=HEADERS, timeout=12)
    if resp.status_code != 200:
        raise ValueError(f"Не удалось открыть страницу Apple Music (код {resp.status_code})")

    playlist_name = "Apple Music Playlist"
    title_match = re.search(r'<title>(.*?)</title>', resp.text)
    if title_match:
        playlist_name = title_match.group(1).split("—")[0].split(" - ")[0].strip()

    m = re.findall(r'<script type="application/json" id="serialized-server-data">(.*?)</script>', resp.text, re.DOTALL)
    if not m:
        raise ValueError("Не удалось извлечь данные плейлиста Apple Music")

    data = json.loads(m[0])

    def find_tracks(obj, depth=0):
        if depth > 8:
            return []
        found = []
        if isinstance(obj, dict):
            if "title" in obj and "artistName" in obj:
                found.append({"title": obj.get("title"), "artist": obj.get("artistName")})
            for v in obj.values():
                found.extend(find_tracks(v, depth + 1))
        elif isinstance(obj, list):
            for it in obj:
                found.extend(find_tracks(it, depth + 1))
        return found

    tracks = find_tracks(data)
    seen = set()
    unique_tracks = []
    for t in tracks:
        key = (t["title"].lower(), t["artist"].lower())
        if key not in seen:
            seen.add(key)
            unique_tracks.append(t)

    return playlist_name, unique_tracks


def parse_youtube(url: str) -> Tuple[str, List[Dict[str, str]]]:
    """
    Extracts playlist tracks from YouTube / YouTube Music using yt-dlp.
    """
    ydl_opts = {
        "extract_flat": True,
        "quiet": True,
        "no_warnings": True,
        "playlist_items": "1-500",
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
        if not info:
            raise ValueError("Не удалось извлечь плейлист YouTube")

        playlist_name = info.get("title", "YouTube Playlist")
        entries = info.get("entries", [])
        results = []
        for entry in entries:
            raw_title = entry.get("title", "")
            raw_uploader = entry.get("uploader", "")
            clean_title = _clean_track_title(raw_title)

            if " - " in clean_title:
                parts = clean_title.split(" - ", 1)
                artist = parts[0].strip()
                title = parts[1].strip()
            else:
                title = clean_title
                artist = raw_uploader.replace(" - Topic", "").strip()

            if title:
                results.append({"title": title, "artist": artist or "Unknown Artist"})

        return playlist_name, results


def parse_yandex(url: str) -> Tuple[str, List[Dict[str, str]]]:
    """
    Attempts to parse Yandex Music playlist / album.
    If blocked by geo/anti-bot protection, raises helpful instructions for copying track list.
    """
    fetch_url = url
    for d in ["music.yandex.ru", "music.yandex.com"]:
        if d in fetch_url:
            fetch_url = fetch_url.replace(d, "music.yandex.kz")

    try:
        resp = requests.get(fetch_url, headers=HEADERS, timeout=8)
    except Exception:
        resp = None

    playlist_name = "Плейлист Яндекс Музыки"
    results = []

    if resp and resp.status_code == 200:
        t_match = re.search(r'<title>(.*?)</title>', resp.text)
        if t_match:
            playlist_name = t_match.group(1).split("—")[0].split(" - ")[0].strip()

        patches = re.findall(r'window\.__STATE_PATCHES__.*?\.push\((.*?)\);', resp.text, re.DOTALL)
        for p in patches:
            try:
                items = json.loads(p)
                for it in items:
                    val = it.get("value")
                    if isinstance(val, dict):
                        if "title" in val and "artists" in val and isinstance(val["artists"], list):
                            title = val.get("title")
                            artists = ", ".join([a.get("name", "") for a in val["artists"] if isinstance(a, dict)])
                            results.append({"title": title, "artist": artists})
                        elif "tracks" in val and isinstance(val["tracks"], list):
                            for tr in val["tracks"]:
                                if isinstance(tr, dict) and "title" in tr:
                                    title = tr.get("title")
                                    artists = ", ".join([a.get("name", "") for a in tr.get("artists", []) if isinstance(a, dict)])
                                    results.append({"title": title, "artist": artists})
            except Exception:
                pass

        if not results:
            og_desc = re.findall(r'<meta[^>]+property="og:description"[^>]+content="([^"]+)"', resp.text)
            if og_desc:
                desc_text = og_desc[0]
                lines = desc_text.split(",")
                for l in lines:
                    if " - " in l:
                        parts = l.split(" - ", 1)
                        results.append({"artist": parts[0].strip(), "title": parts[1].strip()})

    if not results:
        raise ValueError(
            "Яндекс.Музыка защищает веб-ссылки от внешнего доступа. "
            "Решение: выделите треки в вашем плейлисте Яндекс.Музыки (или скопируйте список) и вставьте сюда текстом — система автоматически распознает все песни!"
        )

    return playlist_name, results


def parse_flexible_text(text: str) -> Tuple[str, List[Dict[str, str]]]:
    """
    Intelligently parses track listings in any common format:
    1. 'Artist - Title' or 'Artist — Title' (with or without numbers)
    2. Tab-separated rows copied from web tables (Title \t Artist \t Album \t Duration)
    3. Multi-line blocks (e.g. Number, Title, Artist, Duration on separate lines)
    4. Plain list of song titles
    """
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    if not lines:
        return "Импортированный список", []

    # Format A: Tab-separated lines (common when copied from browser tables)
    tab_separated = [l for l in lines if "\t" in l]
    if len(tab_separated) >= max(1, len(lines) * 0.4):
        results = []
        for line in lines:
            parts = [p.strip() for p in line.split("\t") if p.strip()]
            if len(parts) >= 2:
                if re.match(r'^\d+$', parts[0]) and len(parts) >= 3:
                    title, artist = parts[1], parts[2]
                else:
                    title, artist = parts[0], parts[1]
                if not re.match(r'^\d+:\d+$', title) and not re.match(r'^\d+:\d+$', artist):
                    results.append({"title": title, "artist": artist})
        if results:
            return "Импортированный список", results

    # Format B: Multi-line blocks or "Artist - Title" lines
    i = 0
    results = []
    while i < len(lines):
        line = lines[i]

        # Skip standalone number (track index like "1")
        if re.match(r'^\d+$', line):
            i += 1
            if i >= len(lines):
                break
            line = lines[i]

        # Check for "Artist - Title" or "Artist — Title"
        if " - " in line or " — " in line:
            sep = " - " if " - " in line else " — "
            parts = line.split(sep, 1)
            artist = re.sub(r'^\d+[\.\)\s]+', '', parts[0]).strip()
            title = parts[1].strip()
            results.append({"title": title, "artist": artist})
            i += 1
            continue

        # Check for multi-line Title / Artist pair
        if not re.match(r'^\d+:\d+$', line) and i + 1 < len(lines):
            next_line = lines[i + 1]
            if not re.match(r'^\d+:\d+$', next_line) and not re.match(r'^\d+$', next_line):
                title = line
                artist = next_line
                results.append({"title": title, "artist": artist})
                i += 2
                # Skip optional 3rd line if it's duration (e.g. "3:45")
                if i < len(lines) and re.match(r'^\d+:\d+$', lines[i]):
                    i += 1
                continue

        # Single line fallback
        cleaned = re.sub(r'^\d+[\.\)\s]+', '', line).strip()
        if cleaned and not re.match(r'^\d+:\d+$', cleaned):
            results.append({"title": cleaned, "artist": ""})
        i += 1

    return "Импортированный список", results


async def import_playlist_and_auto_like(user_id: Optional[int], url_or_text: str) -> Dict[str, Any]:
    """
    Main import engine:
    1. Identifies provider (Spotify, Apple Music, YouTube Music, Yandex Music, or flexible text)
    2. Extracts all tracks
    3. Resolves each track in iTunes API
    4. If user_id is provided, automatically adds every track to the user's liked tracks in DB!
    5. Returns full matched tracks so frontend can immediately adapt wave & store locally for guests.
    """
    input_str = url_or_text.strip()
    source = "text"
    playlist_name = "Импортированный плейлист"
    raw_tracks: List[Dict[str, str]] = []

    if "spotify.com" in input_str:
        source = "spotify"
        loop = asyncio.get_running_loop()
        playlist_name, raw_tracks = await loop.run_in_executor(None, parse_spotify, input_str)
    elif "apple.com" in input_str:
        source = "apple"
        loop = asyncio.get_running_loop()
        playlist_name, raw_tracks = await loop.run_in_executor(None, parse_apple_music, input_str)
    elif "youtube.com" in input_str or "youtu.be" in input_str:
        source = "youtube"
        loop = asyncio.get_running_loop()
        playlist_name, raw_tracks = await loop.run_in_executor(None, parse_youtube, input_str)
    elif "yandex." in input_str:
        source = "yandex"
        loop = asyncio.get_running_loop()
        playlist_name, raw_tracks = await loop.run_in_executor(None, parse_yandex, input_str)
    else:
        source = "text"
        playlist_name, raw_tracks = parse_flexible_text(input_str)

    if not raw_tracks:
        raise ValueError("Не найдено ни одного трека для импорта.")

    # Invariant Deduplication: 1 unique song across all streams & variations
    seen_raw_keys = set()
    deduped_raw_tracks = []
    for t in raw_tracks:
        c_key = db.get_canonical_key(t.get("artist", ""), t.get("title", ""))
        if c_key and c_key not in seen_raw_keys:
            seen_raw_keys.add(c_key)
            deduped_raw_tracks.append(t)
    raw_tracks = deduped_raw_tracks[:1000]

    matched_tracks = []
    seen_matched_keys = set()
    async with httpx.AsyncClient(timeout=8.0) as client:
        chunk_size = 20
        for i in range(0, len(raw_tracks), chunk_size):
            chunk = raw_tracks[i:i + chunk_size]
            tasks = [
                match_track_itunes(client, t.get("artist", ""), t.get("title", ""))
                for t in chunk
            ]
            batch_results = await asyncio.gather(*tasks, return_exceptions=True)
            for res in batch_results:
                if isinstance(res, dict) and res.get("title"):
                    m_key = db.get_canonical_key(res.get("artist", ""), res.get("title", ""))
                    if m_key not in seen_matched_keys:
                        seen_matched_keys.add(m_key)
                        matched_tracks.append(res)

    added_count = len(matched_tracks)

    # If user is logged in, auto-like in DB and log to imports
    if user_id:
        for track in matched_tracks:
            try:
                db.add_like(user_id, track)
            except Exception:
                pass

        try:
            conn = db.get_db()
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO imports (user_id, url, source, name, tracks_count)
                VALUES (?, ?, ?, ?, ?)
                """,
                (user_id, input_str[:500], source, playlist_name, added_count)
            )
            conn.commit()
            conn.close()
        except Exception:
            pass

    return {
        "success": True,
        "source": source,
        "playlist_name": playlist_name,
        "imported_count": added_count,
        "tracks": matched_tracks,
        "sample_tracks": matched_tracks[:10],
    }
