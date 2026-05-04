const express          = require('express');
const router           = express.Router();
const path             = require('path');
const fs               = require('fs');
const { randomUUID }   = require('crypto');
const db               = require('../db');

const UPLOADS_DIR = 'tmp';
const TARGET_URL  =
  'https://m.place.naver.com/popupstore/list' +
  '?query=%ED%8C%9D%EC%97%85%EC%8A%A4%ED%86%A0%EC%96%B4' +
  '&originQuery=%ED%8C%9D%EC%97%85%EC%8A%A4%ED%86%A0%EC%96%B4' +
  '&x=126.9783882&y=37.5666103' +
  '&statuses=2%2C3&cidList=1006683' +
  '&region=%EC%84%B1%EC%88%98&level=top';

// ── 헬퍼 ────────────────────────────────────────────────────────
function toSeason(dateStr) {
  if (!dateStr) return 'all';
  const month = parseInt(dateStr.slice(5, 7), 10);
  if (month >= 3 && month <= 5)  return 'spring';
  if (month >= 6 && month <= 8)  return 'summer';
  if (month >= 9 && month <= 11) return 'fall';
  return 'winter';
}

async function downloadThumb(imageUrl) {
  if (!imageUrl || !imageUrl.startsWith('http')) return null;
  try {
    const extMatch = imageUrl.match(/\.(jpe?g|png|webp|gif)/i);
    const ext      = extMatch ? extMatch[1].replace('jpeg', 'jpg') : 'jpg';
    const filename = `${randomUUID()}.${ext}`;
    const dest     = path.join(UPLOADS_DIR, filename);
    const protocol = imageUrl.startsWith('https') ? require('https') : require('http');

    return await new Promise((resolve) => {
      const req = protocol.get(
        imageUrl,
        {
          timeout: 10000,
          headers: {
            'Referer': 'https://m.place.naver.com/',
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
          },
        },
        (resp) => {
          if (resp.statusCode !== 200) { resp.resume(); return resolve(null); }
          const stream = fs.createWriteStream(dest);
          resp.pipe(stream);
          stream.on('finish', () => resolve(filename));
          stream.on('error', () => { fs.unlink(dest, () => {}); resolve(null); });
        }
      );
      req.on('error',   () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
  } catch {
    return null;
  }
}

// ── 상세 페이지에서 좌표 추출 ────────────────────────────────────
async function fetchCoords(page, href) {
  const baseUrl = href.split('?')[0].replace(/\/(photo|review|menu|info)(\/.*)?$/, '');
  if (!baseUrl.match(/\/popupstore\/\d+$/)) return null;
  try {
    await page.goto(baseUrl + '?entry=ple', { waitUntil: 'networkidle2', timeout: 25000 });
    return await page.evaluate(() => {
      for (const s of document.querySelectorAll('script')) {
        const t = s.textContent || '';
        const m = t.match(/"y":"(3[5-9]\.\d{4,})","x":"(1[23]\d\.\d{4,})"/);
        if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
        const m2 = t.match(/"lat":(3[5-9]\.\d{4,}),"lng":(1[23]\d\.\d{4,})/);
        if (m2) return { lat: parseFloat(m2[1]), lng: parseFloat(m2[2]) };
      }
      return null;
    });
  } catch { return null; }
}

// ── 크롤링 함수 ──────────────────────────────────────────────────
async function crawlNaverPopups(maxItems) {
  const puppeteer = require('puppeteer');

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--lang=ko-KR,ko',
    ],
  });

  try {
    const page = await browser.newPage();

    // 자동화 탐지 우회
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
      'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    );
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8' });

    await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 45000 });

    // 리스트 렌더링 대기 — 여러 셀렉터 순서대로 시도
    const waitSelectors = [
      'a[href*="/popupstore/"]',
      'ul li a[href*="place.naver.com"]',
      'li[class*="item"]',
      'div[class*="list"] li',
    ];
    for (const sel of waitSelectors) {
      try { await page.waitForSelector(sel, { timeout: 8000 }); break; } catch {}
    }

    // 스크롤로 추가 항목 로드
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.85));
      await new Promise(r => setTimeout(r, 1000));
    }

    // DOM 데이터 추출
    const rawItems = await page.evaluate((max) => {
      const results = [];
      const seen    = new Set();

      function parseDates(text) {
        const y = new Date().getFullYear();
        // 2026.03.15 ~ 2026.05.31 또는 2026-03-15 ~ 2026-05-31
        let m = text.match(
          /(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})\s*[~\-–·]\s*(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})/
        );
        if (m) return {
          startDate: `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`,
          endDate:   `${m[4]}-${m[5].padStart(2,'0')}-${m[6].padStart(2,'0')}`,
        };
        // 26.03.15 ~ 26.05.31
        m = text.match(
          /(\d{2})[.\-](\d{1,2})[.\-](\d{1,2})\s*[~\-–·]\s*(\d{2})[.\-](\d{1,2})[.\-](\d{1,2})/
        );
        if (m) return {
          startDate: `20${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`,
          endDate:   `20${m[4]}-${m[5].padStart(2,'0')}-${m[6].padStart(2,'0')}`,
        };
        // 3.15 ~ 5.31 (연도 생략)
        m = text.match(/(\d{1,2})[.\-](\d{1,2})\s*[~\-–·]\s*(\d{1,2})[.\-](\d{1,2})/);
        if (m) return {
          startDate: `${y}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`,
          endDate:   `${y}-${m[3].padStart(2,'0')}-${m[4].padStart(2,'0')}`,
        };
        return { startDate: null, endDate: null };
      }

      // ── 전략 1: 팝업스토어 링크 기반 ──────────────────────────
      const anchors = [...document.querySelectorAll('a[href*="/popupstore/"]')];

      for (const anchor of anchors) {
        if (results.length >= max) break;

        // li 또는 article 조상으로 올라가기 (최대 8레벨)
        let container = anchor.parentElement;
        for (let i = 0; i < 8; i++) {
          if (!container) break;
          if (['LI', 'ARTICLE'].includes(container.tagName)) break;
          container = container.parentElement;
        }
        if (!container || container === document.body) continue;

        const text = container.textContent?.trim() || '';
        if (text.length < 3) continue;

        const nameEl =
          container.querySelector('strong, b') ||
          container.querySelector('h2, h3, h4') ||
          anchor;
        const name = nameEl?.textContent?.trim()?.split('\n')?.[0]?.trim();
        if (!name || name.length < 2 || seen.has(name)) continue;

        const addrEl = container.querySelector(
          '[class*="addr"], [class*="address"], address, [class*="road"]'
        );
        const address  = addrEl?.textContent?.trim() || '';
        const imgEl    = container.querySelector('img');
        const imageUrl = imgEl?.src || imgEl?.dataset?.src || null;
        const { startDate, endDate } = parseDates(text);

        if (anchor.href.includes('/photo')) continue;
        seen.add(name);
        results.push({ name, startDate, endDate, address, imageUrl, href: anchor.href });
      }

      // ── 전략 2: img를 가진 li 전체 탐색 (전략 1 실패 시 폴백) ──
      if (results.length === 0) {
        const listItems = [...document.querySelectorAll('li')].filter(li =>
          li.querySelector('img') && (li.textContent?.trim().length ?? 0) > 5
        );

        for (const li of listItems) {
          if (results.length >= max) break;

          const text    = li.textContent?.trim() || '';
          const nameEl  = li.querySelector('strong, b, a');
          const name    = nameEl?.textContent?.trim()?.split('\n')?.[0]?.trim();
          if (!name || name.length < 2 || seen.has(name)) continue;

          const imgEl    = li.querySelector('img');
          const imageUrl = imgEl?.src || null;
          const linkEl   = li.querySelector('a[href]');
          if (linkEl?.href?.includes('/photo')) continue;
          const { startDate, endDate } = parseDates(text);

          seen.add(name);
          results.push({ name, startDate, endDate, address: '', imageUrl, href: linkEl?.href || '' });
        }
      }

      return results;
    }, maxItems);

    // 각 팝업스토어 상세 페이지에서 실제 좌표 추출
    for (const item of rawItems) {
      if (item.href) {
        const coords = await fetchCoords(page, item.href);
        if (coords) { item.lat = coords.lat; item.lng = coords.lng; }
      }
    }

    return rawItems;
  } finally {
    await browser.close();
  }
}

// ── POST /api/naver-popup-crawl ──────────────────────────────────
router.post('/', async (req, res) => {
  const { adminPassword, maxItems = 30 } = req.body;

  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  }
  if (typeof maxItems !== 'number' || maxItems < 1 || maxItems > 100) {
    return res.status(400).json({ error: 'maxItems는 1~100 사이여야 합니다.' });
  }

  let rawItems;
  try {
    rawItems = await crawlNaverPopups(maxItems);
  } catch (err) {
    console.error('[naver-crawl] Puppeteer 오류:', err.message);
    return res.status(500).json({ error: '크롤링에 실패했습니다.', detail: err.message });
  }

  if (rawItems.length === 0) {
    return res.status(422).json({
      error: '페이지에서 아이템을 추출하지 못했습니다. 네이버 DOM 구조가 변경됐을 수 있습니다.',
    });
  }

  // ── DB 저장 ────────────────────────────────────────────────────
  const existing  = new Set(db.filter('popups', () => true).map(p => p.name));
  let inserted    = 0;
  let skipped     = 0;
  const savedItems = [];

  for (const item of rawItems) {
    if (!item.name) continue;

    if (existing.has(item.name)) {
      skipped++;
      continue;
    }

    const mediaPath = await downloadThumb(item.imageUrl);

    const popup = db.insert('popups', {
      name:          item.name,
      description:   '',
      lat:           item.lat  ?? 37.5666,
      lng:           item.lng  ?? 126.9784,
      address:       item.address || '',
      venue:         item.address || null,
      start_date:    item.startDate,
      end_date:      item.endDate,
      is_permanent:  item.startDate ? 0 : 1,
      season:        toSeason(item.startDate),
      category:      'popup_store',
      website_url:   item.href || '',
      opening_hours: null,
      closed_days:   null,
      admission_fee: null,
      keywords:      '팝업스토어,네이버플레이스',
      media_path:    mediaPath,
      media_items:   [],
      is_active:     1,
    });

    existing.add(item.name);
    savedItems.push(popup);
    inserted++;
  }

  res.json({ inserted, skipped, total: rawItems.length, items: savedItems });
});

module.exports = router;
