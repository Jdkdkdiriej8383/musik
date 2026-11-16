import sqlite3
import os
import re
import hashlib
import secrets
from typing import Optional, Dict, Any, List
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "musik.db")

CYR_TO_LAT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh',
    'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
    'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts',
    'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'
}

ARTIST_ALIASES = {
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
}

def transliterate_text(text: str) -> str:
    res = []
    for ch in (text or "").lower():
        if ch in CYR_TO_LAT:
            res.append(CYR_TO_LAT[ch])
        else:
            res.append(ch)
    return "".join(res)

def get_canonical_key(artist: str, title: str) -> str:
    """
    Computes an invariant canonical key for a track across all 4 streaming sources
    and catalogs to eliminate duplicates.
    Example: 'The Hatters - Russian Style (Live)' and 'the_hatters-russian_style'
    both resolve to 'thehatters:::russianstyle'.
    """
    raw_t = (title or "").lower()
    raw_t = re.sub(r'[\(\[].*?[\)\]]', '', raw_t)
    clean_t = transliterate_text(raw_t)
    clean_t = re.sub(r'[^a-z0-9]', '', clean_t)
    
    raw_a = (artist or "").lower().strip()
    raw_a = re.split(r'[,&/]|(\bfeat\b)|(\bft\b)', raw_a)[0].strip()
    raw_a_clean = re.sub(r'[^a-zа-яё0-9]', '', raw_a)
    
    if raw_a in ARTIST_ALIASES:
        clean_a = ARTIST_ALIASES[raw_a]
    elif raw_a_clean in ARTIST_ALIASES:
        clean_a = ARTIST_ALIASES[raw_a_clean]
    else:
        clean_a = transliterate_text(raw_a)
        clean_a = re.sub(r'[^a-z0-9]', '', clean_a)
        
    return f"{clean_a}:::{clean_t}"


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    cursor = conn.cursor()

    # Users table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        display_name TEXT,
        avatar_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Multi-device Auth tokens / sessions table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_name TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # User Likes / Favorites table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS likes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        track_id TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        album TEXT,
        duration INTEGER DEFAULT 0,
        artwork TEXT,
        genre TEXT,
        canonical_key TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, track_id)
    );
    """)

    # User Dislikes table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS dislikes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        track_id TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        album TEXT,
        duration INTEGER DEFAULT 0,
        artwork TEXT,
        genre TEXT,
        canonical_key TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, track_id)
    );
    """)

    # Play history / Listening behavior table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        track_id TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        artwork TEXT,
        genre TEXT,
        duration INTEGER DEFAULT 0,
        listened_seconds INTEGER DEFAULT 0,
        skipped INTEGER DEFAULT 0,
        canonical_key TEXT,
        played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Playlist imports log
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS imports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        source TEXT NOT NULL,
        name TEXT,
        tracks_count INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Ensure canonical_key columns exist on older tables
    for table_name in ["likes", "dislikes", "history"]:
        try:
            cursor.execute(f"ALTER TABLE {table_name} ADD COLUMN canonical_key TEXT")
        except sqlite3.OperationalError:
            pass  # Already exists

    # Indices for high performance queries
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_likes_user ON likes(user_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_likes_canon ON likes(user_id, canonical_key);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_dislikes_user ON dislikes(user_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_dislikes_canon ON dislikes(user_id, canonical_key);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_history_user ON history(user_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);")

    # System settings table (for integration tokens, etc.)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    );
    """)

    conn.commit()
    conn.close()


def hash_password(password: str, salt: Optional[str] = None) -> tuple[str, str]:
    if not salt:
        salt = secrets.token_hex(16)
    pwd_hash = hashlib.pbkdf2_hmac(
        'sha256',
        password.encode('utf-8'),
        salt.encode('utf-8'),
        100000
    ).hex()
    return pwd_hash, salt


def verify_password(password: str, salt: str, expected_hash: str) -> bool:
    pwd_hash, _ = hash_password(password, salt)
    return secrets.compare_digest(pwd_hash, expected_hash)


def create_user(username: str, password: str, email: Optional[str] = None, display_name: Optional[str] = None) -> Dict[str, Any]:
    username = username.strip().lower()
    email = email.strip().lower() if email else None
    display_name = display_name.strip() if display_name else username

    pwd_hash, salt = hash_password(password)
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            INSERT INTO users (username, email, password_hash, salt, display_name)
            VALUES (?, ?, ?, ?, ?)
            """,
            (username, email, pwd_hash, salt, display_name)
        )
        user_id = cursor.lastrowid
        conn.commit()
        return {
            "id": user_id,
            "username": username,
            "email": email,
            "display_name": display_name,
        }
    finally:
        conn.close()


def authenticate_user(login_identifier: str, password: str) -> Optional[Dict[str, Any]]:
    login_identifier = login_identifier.strip().lower()
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT id, username, email, password_hash, salt, display_name, avatar_url
            FROM users
            WHERE username = ? OR email = ?
            """,
            (login_identifier, login_identifier)
        )
        row = cursor.fetchone()
        if not row:
            return None

        if verify_password(password, row["salt"], row["password_hash"]):
            return {
                "id": row["id"],
                "username": row["username"],
                "email": row["email"],
                "display_name": row["display_name"] or row["username"],
                "avatar_url": row["avatar_url"],
            }
        return None
    finally:
        conn.close()


def create_session(user_id: int, device_name: str = "Web Browser") -> str:
    token = secrets.token_hex(32)
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            INSERT INTO sessions (token, user_id, device_name)
            VALUES (?, ?, ?)
            """,
            (token, user_id, device_name)
        )
        conn.commit()
        return token
    finally:
        conn.close()


def get_user_by_token(token: str) -> Optional[Dict[str, Any]]:
    if not token:
        return None
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT u.id, u.username, u.email, u.display_name, u.avatar_url, s.created_at
            FROM sessions s
            JOIN users u ON s.user_id = u.id
            WHERE s.token = ?
            """,
            (token,)
        )
        row = cursor.fetchone()
        if row:
            # Update last_active
            cursor.execute(
                "UPDATE sessions SET last_active = CURRENT_TIMESTAMP WHERE token = ?",
                (token,)
            )
            conn.commit()
            return {
                "id": row["id"],
                "username": row["username"],
                "email": row["email"],
                "display_name": row["display_name"] or row["username"],
                "avatar_url": row["avatar_url"],
            }
        return None
    finally:
        conn.close()


def delete_session(token: str) -> bool:
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


# --- LIKES ---
def add_like(user_id: int, track: Dict[str, Any]) -> bool:
    conn = get_db()
    cursor = conn.cursor()
    try:
        title = track.get("title", "Unknown")
        artist = track.get("artist", "Unknown")
        track_id = str(track.get("id"))
        canon_key = get_canonical_key(artist, title)

        # 1. Remove from dislikes if present (by ID or canonical key)
        cursor.execute(
            "DELETE FROM dislikes WHERE user_id = ? AND (track_id = ? OR canonical_key = ?)",
            (user_id, track_id, canon_key)
        )

        # 2. Check if a like already exists with this canonical key
        cursor.execute(
            "SELECT id, track_id, duration, artwork FROM likes WHERE user_id = ? AND canonical_key = ?",
            (user_id, canon_key)
        )
        existing = cursor.fetchone()

        if existing:
            # Update existing row with newest / best data
            cursor.execute(
                """
                UPDATE likes SET
                    track_id = ?,
                    title = ?,
                    artist = ?,
                    album = ?,
                    duration = CASE WHEN ? > 0 THEN ? ELSE duration END,
                    artwork = CASE WHEN ? != '' THEN ? ELSE artwork END,
                    genre = ?,
                    canonical_key = ?,
                    created_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (
                    track_id,
                    title,
                    artist,
                    track.get("album", "Single"),
                    track.get("duration", 0), track.get("duration", 0),
                    track.get("artwork", ""), track.get("artwork", ""),
                    track.get("genre", "Music"),
                    canon_key,
                    existing["id"]
                )
            )
        else:
            cursor.execute(
                """
                INSERT INTO likes (user_id, track_id, title, artist, album, duration, artwork, genre, canonical_key)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, track_id) DO UPDATE SET
                    title = excluded.title,
                    artist = excluded.artist,
                    album = excluded.album,
                    duration = excluded.duration,
                    artwork = excluded.artwork,
                    genre = excluded.genre,
                    canonical_key = excluded.canonical_key,
                    created_at = CURRENT_TIMESTAMP
                """,
                (
                    user_id,
                    track_id,
                    title,
                    artist,
                    track.get("album", "Single"),
                    track.get("duration", 0),
                    track.get("artwork", ""),
                    track.get("genre", "Music"),
                    canon_key
                )
            )
        conn.commit()
        return True
    finally:
        conn.close()


def remove_like(user_id: int, track_id: str, artist: str = "", title: str = "") -> bool:
    conn = get_db()
    cursor = conn.cursor()
    try:
        canon_key = get_canonical_key(artist, title) if (artist and title) else ""
        if canon_key:
            cursor.execute(
                "DELETE FROM likes WHERE user_id = ? AND (track_id = ? OR canonical_key = ?)",
                (user_id, str(track_id), canon_key)
            )
        else:
            cursor.execute("SELECT canonical_key FROM likes WHERE user_id = ? AND track_id = ?", (user_id, str(track_id)))
            row = cursor.fetchone()
            if row and row["canonical_key"]:
                cursor.execute(
                    "DELETE FROM likes WHERE user_id = ? AND (track_id = ? OR canonical_key = ?)",
                    (user_id, str(track_id), row["canonical_key"])
                )
            else:
                cursor.execute("DELETE FROM likes WHERE user_id = ? AND track_id = ?", (user_id, str(track_id)))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def get_user_likes(user_id: int) -> List[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT track_id as id, title, artist, album, duration, artwork, genre, canonical_key, created_at
            FROM likes
            WHERE user_id = ?
            ORDER BY created_at DESC
            """,
            (user_id,)
        )
        rows = cursor.fetchall()
        seen = set()
        deduped = []
        for r in rows:
            k = r["canonical_key"] or get_canonical_key(r["artist"], r["title"])
            if k not in seen:
                seen.add(k)
                d = dict(r)
                d.pop("canonical_key", None)
                deduped.append(d)
        return deduped
    finally:
        conn.close()


# --- DISLIKES ---
def add_dislike(user_id: int, track: Dict[str, Any]) -> bool:
    conn = get_db()
    cursor = conn.cursor()
    try:
        title = track.get("title", "Unknown")
        artist = track.get("artist", "Unknown")
        track_id = str(track.get("id"))
        canon_key = get_canonical_key(artist, title)

        # 1. Remove from likes if present (by ID or canonical key)
        cursor.execute(
            "DELETE FROM likes WHERE user_id = ? AND (track_id = ? OR canonical_key = ?)",
            (user_id, track_id, canon_key)
        )

        # 2. Check if a dislike already exists with this canonical key
        cursor.execute(
            "SELECT id, track_id, duration, artwork FROM dislikes WHERE user_id = ? AND canonical_key = ?",
            (user_id, canon_key)
        )
        existing = cursor.fetchone()

        if existing:
            cursor.execute(
                """
                UPDATE dislikes SET
                    track_id = ?,
                    title = ?,
                    artist = ?,
                    album = ?,
                    duration = CASE WHEN ? > 0 THEN ? ELSE duration END,
                    artwork = CASE WHEN ? != '' THEN ? ELSE artwork END,
                    genre = ?,
                    canonical_key = ?,
                    created_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (
                    track_id,
                    title,
                    artist,
                    track.get("album", "Single"),
                    track.get("duration", 0), track.get("duration", 0),
                    track.get("artwork", ""), track.get("artwork", ""),
                    track.get("genre", "Music"),
                    canon_key,
                    existing["id"]
                )
            )
        else:
            cursor.execute(
                """
                INSERT INTO dislikes (user_id, track_id, title, artist, album, duration, artwork, genre, canonical_key)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, track_id) DO UPDATE SET
                    title = excluded.title,
                    artist = excluded.artist,
                    album = excluded.album,
                    duration = excluded.duration,
                    artwork = excluded.artwork,
                    genre = excluded.genre,
                    canonical_key = excluded.canonical_key,
                    created_at = CURRENT_TIMESTAMP
                """,
                (
                    user_id,
                    track_id,
                    title,
                    artist,
                    track.get("album", "Single"),
                    track.get("duration", 0),
                    track.get("artwork", ""),
                    track.get("genre", "Music"),
                    canon_key
                )
            )
        conn.commit()
        return True
    finally:
        conn.close()


def remove_dislike(user_id: int, track_id: str, artist: str = "", title: str = "") -> bool:
    conn = get_db()
    cursor = conn.cursor()
    try:
        canon_key = get_canonical_key(artist, title) if (artist and title) else ""
        if canon_key:
            cursor.execute(
                "DELETE FROM dislikes WHERE user_id = ? AND (track_id = ? OR canonical_key = ?)",
                (user_id, str(track_id), canon_key)
            )
        else:
            cursor.execute("SELECT canonical_key FROM dislikes WHERE user_id = ? AND track_id = ?", (user_id, str(track_id)))
            row = cursor.fetchone()
            if row and row["canonical_key"]:
                cursor.execute(
                    "DELETE FROM dislikes WHERE user_id = ? AND (track_id = ? OR canonical_key = ?)",
                    (user_id, str(track_id), row["canonical_key"])
                )
            else:
                cursor.execute("DELETE FROM dislikes WHERE user_id = ? AND track_id = ?", (user_id, str(track_id)))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def get_user_dislikes(user_id: int) -> List[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT track_id as id, title, artist, album, duration, artwork, genre, canonical_key, created_at
            FROM dislikes
            WHERE user_id = ?
            ORDER BY created_at DESC
            """,
            (user_id,)
        )
        rows = cursor.fetchall()
        seen = set()
        deduped = []
        for r in rows:
            k = r["canonical_key"] or get_canonical_key(r["artist"], r["title"])
            if k not in seen:
                seen.add(k)
                d = dict(r)
                d.pop("canonical_key", None)
                deduped.append(d)
        return deduped
    finally:
        conn.close()


# --- HISTORY & BEHAVIOR TRACKING ---
def record_history(user_id: int, track: Dict[str, Any], listened_seconds: int = 0, skipped: bool = False):
    conn = get_db()
    cursor = conn.cursor()
    try:
        title = track.get("title", "Unknown")
        artist = track.get("artist", "Unknown")
        canon_key = get_canonical_key(artist, title)
        cursor.execute(
            """
            INSERT INTO history (user_id, track_id, title, artist, artwork, genre, duration, listened_seconds, skipped, canonical_key)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                str(track.get("id")),
                title,
                artist,
                track.get("artwork", ""),
                track.get("genre", "Music"),
                track.get("duration", 0),
                listened_seconds,
                1 if skipped else 0,
                canon_key
            )
        )
        conn.commit()
    finally:
        conn.close()


def get_user_history(user_id: int, limit: int = 50) -> List[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT track_id as id, title, artist, artwork, genre, duration, listened_seconds, skipped, canonical_key, played_at
            FROM history
            WHERE user_id = ?
            ORDER BY played_at DESC
            LIMIT ?
            """,
            (user_id, limit * 2)
        )
        rows = cursor.fetchall()
        seen = set()
        deduped = []
        for r in rows:
            k = r["canonical_key"] or get_canonical_key(r["artist"], r["title"])
            if k not in seen:
                seen.add(k)
                d = dict(r)
                d.pop("canonical_key", None)
                deduped.append(d)
                if len(deduped) >= limit:
                    break
        return deduped
    finally:
        conn.close()


def set_setting(key: str, value: str):
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """, (key, value))
        conn.commit()
    finally:
        conn.close()


def get_setting(key: str) -> Optional[str]:
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT value FROM settings WHERE key = ?", (key,))
        row = cursor.fetchone()
        return row["value"] if row else None
    finally:
        conn.close()


# Initialize database tables on module import
init_db()
