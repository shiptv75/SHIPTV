// ===================================================
// Cloudflare Pages Function
// এই ফাইলটি রাখুন: functions/api/proxy.js
// অ্যাক্সেস হবে: https://shamimiptv.pages.dev/api/proxy
// ===================================================

// সিক্রেট আইডি (প্রয়োজনে পরিবর্তন করুন)
const EXPIRE_CODE = "554075";

// ---------------------------------------------------------
// একাধিক প্লেলিস্ট এখানে যোগ করুন — key হবে শর্টকাট নাম (URL-এ ব্যবহৃত হবে)
// লিংক হবে: /api/proxy/<key>-554075.m3u
// যেমন: /api/proxy/shiptv-554075.m3u , /api/proxy/tapmad-554075.m3u
// ---------------------------------------------------------
const PLAYLISTS = {
  shiptv: "https://raw.githubusercontent.com/shiptv75/SHIPTV/main/playlist.m3u",
  fastiptv: "https://raw.githubusercontent.com/ahan443/FAST-IPTV/refs/heads/main/z.m3u",
  tapmad: "https://raw.githubusercontent.com/srhady/tapmad-bd/refs/heads/main/tapmad_bd.m3u",
  fancode: "https://raw.githubusercontent.com/sportlive18/Fancode-New-Auto-Update/refs/heads/main/fancode.m3u",
  xniptv: "https://raw.githubusercontent.com/tvbd/m3uplayer/refs/heads/main/m3u/xniptv.m3u"
  // নোট: HridoyTV সোর্সটি JSON ফরম্যাটে, তাই এই M3U-রিরাইট রুটে যোগ করা হয়নি।
  // ওটা লাগলে ?url= দিয়ে সরাসরি CORS পাস-থ্রু হিসেবে ব্যবহার করুন (নিচে দেখুন)।
};

// যদি কেউ পুরনো লিংক (/api/proxy/playlist-...) ব্যবহার করে, সেটা কোন প্লেলিস্ট দেখাবে (ডিফল্ট)
const DEFAULT_PLAYLIST_KEY = "shiptv";
// ===================================================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*'
};

export async function onRequest(context) {
  const { request } = context;

  // OPTIONS (CORS preflight)
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const host = url.host;
  const protocol = url.protocol.replace(':', '');
  const requestUrl = url.pathname + url.search;
  const targetUrlParam = url.searchParams.get('url');

  // ---------------------------------------------------------
  // ১. M3U প্লেলিস্ট রিকোয়েস্ট
  //    সাপোর্টেড ফরম্যাট:
  //      /api/proxy/live-554075.m3u      → PLAYLISTS.live
  //      /api/proxy/movies-554075.m3u    → PLAYLISTS.movies
  //      /api/proxy/playlist-554075.m3u  → DEFAULT_PLAYLIST_KEY (পুরনো লিংক ব্যাকওয়ার্ড কম্প্যাটিবিলিটি)
  // ---------------------------------------------------------
  const m3uFilename = url.pathname.split('/').pop() || '';
  const m3uMatch = m3uFilename.match(/^([a-zA-Z0-9_]+)(?:-[a-zA-Z0-9]+)?\.m3u8?$/i);

  if (!targetUrlParam && m3uMatch) {

    // সিকিউরিটি কোড যাচাইকরণ
    if (EXPIRE_CODE && !requestUrl.includes(EXPIRE_CODE)) {
      return jsonResponse({ error: 'Access Denied: Invalid or Expired ID' }, 403);
    }

    // নাম থেকে সঠিক প্লেলিস্ট বের করা ("playlist" মানে ডিফল্ট প্লেলিস্ট)
    let playlistKey = m3uMatch[1].toLowerCase();
    if (playlistKey === 'playlist') playlistKey = DEFAULT_PLAYLIST_KEY;

    const selectedPlaylistUrl = PLAYLISTS[playlistKey];

    if (!selectedPlaylistUrl) {
      return jsonResponse({ error: `Unknown playlist: "${playlistKey}"` }, 404);
    }

    try {
      const response = await fetch(selectedPlaylistUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        }
      });

      if (!response.ok) {
        return jsonResponse({ error: 'Failed to fetch playlist' }, response.status);
      }

      const content = await response.text();
      const baseUrl = response.url; // Redirect সামলানোর জন্য

      // প্লেলিস্টের প্রতিটি চ্যানেলকে প্রক্সি লিংকে রূপান্তর
      const lines = content.split('\n');
      const rewrittenLines = lines.map(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          try {
            const absUrl = new URL(trimmed, baseUrl).href;
            return `${protocol}://${host}/api/proxy?url=${encodeURIComponent(absUrl)}`;
          } catch (e) {
            return line;
          }
        }
        return line;
      });

      return new Response(rewrittenLines.join('\n'), {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8'
        }
      });

    } catch (error) {
      return jsonResponse({ error: error.message }, 500);
    }
  }

  // ---------------------------------------------------------
  // ২. নির্দিষ্ট চ্যানেল ও ভিডিও স্ট্রিম ফেচিং
  // ---------------------------------------------------------
  const targetUrl = targetUrlParam;
  if (!targetUrl) {
    return jsonResponse({ error: 'No URL provided' }, 400);
  }

  try {
    const targetOrigin = new URL(targetUrl).origin;

    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Referer': targetOrigin + '/',
        'Origin': targetOrigin
      }
    });

    if (!response.ok) {
      return jsonResponse({ error: `Stream failed (${response.status})` }, response.status);
    }

    const contentType = response.headers.get('content-type') || '';
    const finalUrl = response.url;

    // M3U8 বা সাব-প্লেলিস্ট চেক
    const isPlaylist = targetUrl.includes('.m3u') ||
                       contentType.includes('mpegurl') ||
                       contentType.includes('m3u') ||
                       contentType.includes('text/plain');

    if (isPlaylist) {
      const text = await response.text();

      if (text.trim().startsWith('#EXTM3U') || targetUrl.includes('.m3u8')) {
        const lines = text.split('\n');
        const rewrittenLines = lines.map(line => {
          const trimmed = line.trim();
          if (!trimmed) return line;

          // #EXT-X-KEY (AES Encryption) ও #EXT-X-MEDIA ট্যাগের URI প্রক্সি রিরাইট
          if (trimmed.startsWith('#')) {
            if (trimmed.includes('URI=')) {
              return trimmed.replace(/URI=["']([^"']+)["']/g, (match, uri) => {
                try {
                  const abs = new URL(uri, finalUrl).href;
                  return `URI="${protocol}://${host}/api/proxy?url=${encodeURIComponent(abs)}"`;
                } catch (e) {
                  return match;
                }
              });
            }
            return line;
          }

          // ভিডিও সেগমেন্ট (.ts) বা সাব-প্লেলিস্ট রিরাইট
          try {
            const abs = new URL(trimmed, finalUrl).href;
            return `${protocol}://${host}/api/proxy?url=${encodeURIComponent(abs)}`;
          } catch (e) {
            return line;
          }
        });

        return new Response(rewrittenLines.join('\n'), {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8'
          }
        });
      }

      return new Response(text, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': contentType || 'text/plain'
        }
      });
    }

    // TS/AAC/MP4 ভিডিও সেগমেন্ট প্লেয়ারে পাঠানো
    const arrayBuffer = await response.arrayBuffer();
    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': contentType || 'video/mp2t',
        'Cache-Control': 'public, max-age=3600'
      }
    });

  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

// ছোট হেল্পার ফাংশন JSON রেসপন্স তৈরির জন্য
function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json'
    }
  });
}
