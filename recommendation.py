import random
import asyncio
from typing import List, Dict, Any, Optional, Set
import httpx
import db

# Genre clusters for energy & chill modes
ENERGY_GENRES = {
    "rock", "alternative", "hard rock", "metal", "punk", "electronic",
    "dance", "house", "techno", "drum & bass", "hip-hop", "hip hop",
    "rap", "pop", "club", "trap", "edm"
}

CHILL_GENRES = {
    "lofi", "lo-fi", "chill", "ambient", "acoustic", "classical",
    "neoclassical", "jazz", "soul", "blues", "downtempo", "indie",
    "singer/songwriter", "folk", "instrumental"
}


async def fetch_artist_top_tracks(client: httpx.AsyncClient, artist: str, limit: int = 5) -> List[Dict[str, Any]]:
    """Fetches top songs by an artist from iTunes catalog."""
    url = "https://itunes.apple.com/search"
    params = {
        "term": artist,
        "entity": "song",
        "attribute": "artistTerm",
        "limit": limit,
    }
    try:
        resp = await client.get(url, params=params, timeout=5.0)
        if resp.status_code == 200:
            data = resp.json()
            tracks = []
            for item in data.get("results", []):
                artwork = item.get("artworkUrl100", "").replace("100x100bb", "600x600bb")
                tracks.append({
                    "id": str(item.get("trackId")),
                    "title": item.get("trackName", "Unknown"),
                    "artist": item.get("artistName", artist),
                    "album": item.get("collectionName", "Single"),
                    "duration": (item.get("trackTimeMillis", 0) or 0) // 1000,
                    "artwork": artwork,
                    "genre": item.get("primaryGenreName", "Pop"),
                })
            return tracks
    except Exception:
        pass
    return []


async def fetch_genre_discovery_tracks(client: httpx.AsyncClient, genre: str, limit: int = 10) -> List[Dict[str, Any]]:
    """Discovers tracks in a specific genre or mood."""
    url = "https://itunes.apple.com/search"
    params = {
        "term": f"{genre} hits",
        "entity": "song",
        "limit": limit,
    }
    try:
        resp = await client.get(url, params=params, timeout=5.0)
        if resp.status_code == 200:
            data = resp.json()
            tracks = []
            for item in data.get("results", []):
                artwork = item.get("artworkUrl100", "").replace("100x100bb", "600x600bb")
                tracks.append({
                    "id": str(item.get("trackId")),
                    "title": item.get("trackName", "Unknown"),
                    "artist": item.get("artistName", "Unknown"),
                    "album": item.get("collectionName", "Single"),
                    "duration": (item.get("trackTimeMillis", 0) or 0) // 1000,
                    "artwork": artwork,
                    "genre": item.get("primaryGenreName", genre),
                })
            return tracks
    except Exception:
        pass
    return []


async def get_personalized_wave(
    user_id: Optional[int],
    mode: str = "default",
    limit: int = 15,
    country: str = "ru"
) -> Dict[str, Any]:
    """
    Computes a personalized continuous music wave ('Моя волна') for a user.
    Adapts based on:
    - User likes (favorites)
    - User dislikes (exclusions & negative weights)
    - Listening history (positive plays vs skips)
    - Chosen mode ('default', 'energy', 'chill', 'favorites', 'discover')
    """
    mode = mode.lower().strip()
    if mode not in ["default", "energy", "chill", "favorites", "discover"]:
        mode = "default"

    # 1. Fetch user data if logged in
    liked_tracks: List[Dict[str, Any]] = []
    disliked_tracks: List[Dict[str, Any]] = []
    history_tracks: List[Dict[str, Any]] = []

    if user_id:
        liked_tracks = db.get_user_likes(user_id)
        disliked_tracks = db.get_user_dislikes(user_id)
        history_tracks = db.get_user_history(user_id, limit=40)

    # Sets of track IDs and canonical keys to filter out
    disliked_ids: Set[str] = {str(t["id"]) for t in disliked_tracks}
    disliked_keys: Set[str] = {db.get_canonical_key(t.get("artist", ""), t.get("title", "")) for t in disliked_tracks}

    liked_ids: Set[str] = {str(t["id"]) for t in liked_tracks}
    liked_keys: Set[str] = {db.get_canonical_key(t.get("artist", ""), t.get("title", "")) for t in liked_tracks}

    recent_history_ids: Set[str] = {str(t["id"]) for t in history_tracks[:20]}
    recent_history_keys: Set[str] = {db.get_canonical_key(t.get("artist", ""), t.get("title", "")) for t in history_tracks[:20]}

    # Penalized artists from dislikes
    disliked_artists: Dict[str, int] = {}
    for t in disliked_tracks:
        art = t.get("artist", "").lower()
        if art:
            disliked_artists[art] = disliked_artists.get(art, 0) + 1

    # Strongly disliked artists (2 or more dislikes) get completely blocked
    blocked_artists = {art for art, count in disliked_artists.items() if count >= 2}

    # Top liked artists and genres
    artist_counts: Dict[str, int] = {}
    genre_counts: Dict[str, int] = {}
    for t in liked_tracks:
        art = t.get("artist", "").strip()
        gen = t.get("genre", "Music").strip()
        if art and art.lower() not in blocked_artists:
            artist_counts[art] = artist_counts.get(art, 0) + 1
        if gen:
            genre_counts[gen] = genre_counts.get(gen, 0) + 1

    # Sorted favorite artists
    top_artists = [a for a, _ in sorted(artist_counts.items(), key=lambda x: x[1], reverse=True)[:6]]
    top_genres = [g for g, _ in sorted(genre_counts.items(), key=lambda x: x[1], reverse=True)[:4]]

    # Fallback genres if new user has no likes yet
    if not top_genres:
        top_genres = ["Rock", "Pop", "Hip-Hop", "Electronic", "Indie"]
    if not top_artists:
        top_artists = ["The Weeknd", "Imagine Dragons", "Coldplay", "Dua Lipa", "Queen"]

    candidate_pool: List[Dict[str, Any]] = []

    # 2. Gather candidates according to mode
    async with httpx.AsyncClient(timeout=8.0) as client:
        # A) If mode is 'favorites', prioritize user's liked tracks + top artists
        if mode == "favorites" and liked_tracks:
            candidate_pool.extend(liked_tracks)
            # Fetch some extra tracks from top artists
            if top_artists:
                tasks = [fetch_artist_top_tracks(client, art, limit=4) for art in top_artists[:3]]
                artist_batches = await asyncio.gather(*tasks, return_exceptions=True)
                for b in artist_batches:
                    if isinstance(b, list):
                        candidate_pool.extend(b)

        # B) Default / Energy / Chill / Discover modes
        else:
            # Add a portion of liked tracks (unless discover mode)
            if mode != "discover" and liked_tracks:
                sample_count = min(len(liked_tracks), 6)
                candidate_pool.extend(random.sample(liked_tracks, sample_count))

            # Fetch tracks from user's favorite artists
            artist_sample = random.sample(top_artists, min(len(top_artists), 3))
            artist_tasks = [fetch_artist_top_tracks(client, art, limit=5) for art in artist_sample]

            # Fetch genre discovery tracks
            genre_sample = random.sample(top_genres, min(len(top_genres), 2))
            genre_tasks = [fetch_genre_discovery_tracks(client, g, limit=8) for g in genre_sample]

            results = await asyncio.gather(*(artist_tasks + genre_tasks), return_exceptions=True)
            for res in results:
                if isinstance(res, list):
                    candidate_pool.extend(res)

    # 3. Filter candidates:
    # - Strict exclusion: any track in user's dislikes (by ID or canonical key)
    # - Strict exclusion: any duplicate track across all 4 streaming sources
    # - Strict exclusion: any artist with 2+ dislikes
    # - If discover mode: exclude already liked tracks
    # - Exclude recently played tracks from last few minutes
    filtered_pool = []
    seen_ids = set()
    seen_keys = set()

    for track in candidate_pool:
        t_id = str(track.get("id"))
        t_artist = track.get("artist", "")
        t_title = track.get("title", "")
        t_genre = track.get("genre", "").lower()
        t_key = db.get_canonical_key(t_artist, t_title)

        # Hard exclusions & Invariant Deduplication
        if not t_key or t_key in seen_keys or t_id in seen_ids:
            continue
        if t_id in disliked_ids or t_key in disliked_keys:
            continue
        if t_artist.lower() in blocked_artists:
            continue
        if mode == "discover" and (t_id in liked_ids or t_key in liked_keys):
            continue
        if (t_id in recent_history_ids or t_key in recent_history_keys) and len(candidate_pool) > limit:
            continue

        # Mode-specific genre filtering
        if mode == "energy":
            if not any(g in t_genre for g in ENERGY_GENRES):
                continue
        elif mode == "chill":
            if not any(g in t_genre for g in CHILL_GENRES):
                continue

        seen_ids.add(t_id)
        seen_keys.add(t_key)
        filtered_pool.append(track)

    # 4. If pool is too small, fallback to top trending tracks
    if len(filtered_pool) < limit:
        try:
            from main import get_trending
            trending = await get_trending(country=country, limit=30)
            for t in trending.get("results", []):
                t_id = str(t.get("id"))
                t_key = db.get_canonical_key(t.get("artist", ""), t.get("title", ""))
                if t_id not in disliked_ids and t_key not in disliked_keys and t_id not in seen_ids and t_key not in seen_keys:
                    seen_ids.add(t_id)
                    seen_keys.add(t_key)
                    filtered_pool.append(t)
                if len(filtered_pool) >= limit * 2:
                    break
        except Exception:
            pass

    # 5. Score candidates dynamically:
    # Likes affinity + Artist affinity + Genre affinity - Recency/Skip penalty
    scored_tracks = []
    for track in filtered_pool:
        t_artist = track.get("artist", "")
        t_genre = track.get("genre", "")
        score = 0.0

        # Positive boost for liked artists
        if t_artist in artist_counts:
            score += artist_counts[t_artist] * 1.5

        # Positive boost for preferred genres
        if t_genre in genre_counts:
            score += genre_counts[t_genre] * 1.0

        # Direct like boost (if not discover mode)
        if str(track.get("id")) in liked_ids and mode != "discover":
            score += 3.0

        # Penalize if artist has 1 dislike
        if t_artist.lower() in disliked_artists:
            score -= 2.0

        # Small random factor for exploration & delightful variety (exploration vs exploitation)
        score += random.uniform(0.1, 2.5)

        scored_tracks.append((score, track))

    # Sort by recommendation score descending
    scored_tracks.sort(key=lambda x: x[0], reverse=True)
    selected_tracks = [t for _, t in scored_tracks[:limit]]

    # Shuffle slightly so the flow feels organic rather than rigid
    random.shuffle(selected_tracks)

    return {
        "mode": mode,
        "count": len(selected_tracks),
        "results": selected_tracks,
        "meta": {
            "top_genres": top_genres[:3],
            "top_artists": top_artists[:3],
            "likes_count": len(liked_tracks),
            "dislikes_count": len(disliked_tracks),
        }
    }
