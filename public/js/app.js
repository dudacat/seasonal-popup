'use strict';

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function mediaUrl(src) {
  if (!src) return '';
  return src.startsWith('http') ? src : `/uploads/${src}`;
}

async function safeJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch {
    return { error: res.status === 413 ? '파일이 너무 큽니다. 이미지는 4MB 이하로 업로드해주세요.' : '서버 오류가 발생했습니다.' };
  }
}

async function uploadToStorage(file) {
  const params = new URLSearchParams({ filename: file.name, contentType: file.type });
  const sigRes  = await fetch(`/api/upload/signed-url?${params}`);
  const sigData = await safeJson(sigRes);
  if (!sigRes.ok) throw new Error(sigData.error || '업로드 준비 실패');

  const { signedUrl, url, type, _path, _token } = sigData;

  const putRes = await fetch(signedUrl, {
    method:  'PUT',
    headers: { 'Content-Type': file.type },
    body:    file,
  });
  if (!putRes.ok) throw new Error('파일 전송에 실패했습니다.');

  await fetch('/api/upload/finalize', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ path: _path, token: _token }),
  });

  return { url, filename: url, type, size: file.size };
}

// ── 상수 ────────────────────────────────────────────────────────
const CATEGORY_ICON = {
  exhibition:  '🎨',
  popup_store: '🛍️',
  festival:    '🎪',
  market:      '🛒',
  museum:      '🏛️',
  library:     '📚',
  other:       '📍',
};
const CATEGORY_LABEL = {
  exhibition: '전시', popup_store: '팝업 스토어',
  festival: '페스티벌', market: '마켓',
  museum: '박물관', library: '도서관', other: '기타',
};
const SEASON_LABEL = {
  spring: '🌸 봄', summer: '☀️ 여름', fall: '🍂 가을', winter: '❄️ 겨울', all: '🗓️ 사계절',
};
const SEASON_EMOJI = { spring: '🌸', summer: '☀️', fall: '🍂', winter: '❄️' };
const SEASON_TEXT  = { spring: '봄 시즌', summer: '여름 시즌', fall: '가을 시즌', winter: '겨울 시즌' };

const ICON = {
  building: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>`,
  calendar: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  clock:    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  mapPin:   `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
  ban:      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`,
};

const VIDEO_EXTS   = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv']);
const SEOUL        = { lat: 37.5665, lng: 126.9780 };

// ── 상태 ────────────────────────────────────────────────────────
let map = null;
let markers = [];
let clusterMarkers = [];
let pendingScatterCenter = null;
let scatterDone = false;
let popups  = [];
let currentSeason        = 'all';
let selectedPopupId      = null;
let editingPopupId       = null;
let isAdminMode          = false;
let storedAdminPassword  = '';

// 동선 모드
let routeMode        = false;
let routePolyline    = null;
let routeStopMarkers = [];
let routeOrder       = [];
let _routeFetchCtrl  = null;

const activeFilters = new Set();
let filteredIds     = null; // null = 전체 표시

// ── 유틸 ────────────────────────────────────────────────────────
function getCurrentSeason() {
  const m = new Date().getMonth() + 1;
  if (m >= 3 && m <= 5) return 'spring';
  if (m >= 6 && m <= 8) return 'summer';
  if (m >= 9 && m <= 11) return 'fall';
  return 'winter';
}

function getDDay(endDate) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end   = new Date(endDate); end.setHours(0, 0, 0, 0);
  return Math.ceil((end - today) / 86400000);
}

function getDDayClass(d) {
  if (d < 0)   return 'dday-ended';
  if (d === 0) return 'dday-today';
  if (d <= 7)  return 'dday-urgent';
  if (d <= 30) return 'dday-warning';
  return 'dday-normal';
}

function ddayText(d) {
  if (d < 0)   return '종료';
  if (d === 0) return 'D-Day';
  return `D-${d}`;
}

function formatDate(s) {
  return s ? s.slice(0, 10).replace(/-/g, '.') : '';
}

function nl2br(s) {
  return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>') : '';
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function dDayBadge(endDateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end   = new Date(endDateStr); end.setHours(0, 0, 0, 0);
  const days  = Math.round((end - today) / 86400000);
  if (days < 0)  return `<span class="dday-badge dday-ended">종료</span>`;
  if (days === 0) return `<span class="dday-badge dday-today">오늘 마감</span>`;
  if (days <= 7)  return `<span class="dday-badge dday-urgent">종료 ${days}일 전</span>`;
  if (days <= 30) return `<span class="dday-badge dday-soon">종료 ${days}일 전</span>`;
  return `<span class="dday-badge dday-normal">종료 ${days}일 전</span>`;
}

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function isVideoFile(filename) {
  if (!filename) return false;
  return VIDEO_EXTS.has(filename.split('.').pop().toLowerCase());
}

// 사진이면 <img>, 영상이면 <video>
function buildCarouselHtml(popup) {
  const mainSrc = popup.media_path || popup.photo_path || null;
  const galleryItems = popup.media_items || [];

  const slides = [];
  if (mainSrc) slides.push({ src: mainSrc, type: isVideoFile(mainSrc) ? 'video' : 'image' });
  galleryItems.forEach((item, idx) => {
    slides.push({ src: item.filename, type: item.type === 'video' || isVideoFile(item.filename) ? 'video' : 'image', galleryIdx: idx });
  });

  if (slides.length === 0) {
    const addBtn = isAdminMode ? `
      <label class="carousel-add-btn">
        ＋ 사진·영상 추가
        <input type="file" accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime,video/x-msvideo" onchange="handleGalleryUpload('${popup.id}',this)" hidden>
      </label>` : '';
    return `<div class="detail-media-placeholder">${CATEGORY_ICON[popup.category]}${addBtn}</div>`;
  }

  const slidesHtml = slides.map((slide, i) => {
    const mediaEl = slide.type === 'video'
      ? `<video class="carousel-media" src="${mediaUrl(slide.src)}" controls playsinline></video>`
      : `<img class="carousel-media" src="${mediaUrl(slide.src)}" alt="">`;
    const deleteBtn = isAdminMode && slide.galleryIdx !== undefined
      ? `<button class="carousel-delete-btn" onclick="event.stopPropagation();removeMedia('${popup.id}',${slide.galleryIdx})">×</button>`
      : '';
    return `<div class="carousel-slide${i === 0 ? ' active' : ''}">${mediaEl}${deleteBtn}</div>`;
  }).join('');

  const multi = slides.length > 1;
  const dots = multi
    ? `<div class="carousel-dots" id="carouselDots">${slides.map((_, i) =>
        `<span class="carousel-dot${i === 0 ? ' active' : ''}" onclick="carouselGoTo(${i})"></span>`
      ).join('')}</div>`
    : '';
  const addBtn = isAdminMode ? `
    <label class="carousel-add-btn">
      ＋ 사진·영상 추가
      <input type="file" accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime,video/x-msvideo" onchange="handleGalleryUpload('${popup.id}',this)" hidden>
    </label>` : '';

  return `
    <div class="detail-carousel" id="detailCarousel" data-total="${slides.length}" data-current="0">
      <div class="carousel-track">${slidesHtml}</div>
      ${dots}
    </div>
    ${addBtn}`;
}

function carouselMove(dir) {
  const carousel = document.getElementById('detailCarousel');
  if (!carousel) return;
  const total   = parseInt(carousel.dataset.total);
  const current = parseInt(carousel.dataset.current);
  carouselGoTo((current + dir + total) % total);
}

function carouselGoTo(idx) {
  const carousel = document.getElementById('detailCarousel');
  if (!carousel) return;
  carousel.querySelectorAll('.carousel-slide').forEach((s, i) => s.classList.toggle('active', i === idx));
  carousel.dataset.current = idx;
  const dotsEl = document.getElementById('carouselDots');
  if (dotsEl) dotsEl.querySelectorAll('.carousel-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
}

function initCarouselSwipe() {
  const carousel = document.getElementById('detailCarousel');
  if (!carousel) return;
  let startX = 0, startY = 0;

  // touch (mobile)
  carousel.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  carousel.addEventListener('touchmove', e => {
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (Math.abs(dx) > Math.abs(dy)) e.preventDefault();
  }, { passive: false });
  carousel.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) carouselMove(dx < 0 ? 1 : -1);
  }, { passive: true });

  // mouse (desktop)
  let dragging = false;
  carousel.addEventListener('mousedown', e => {
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
  });
  carousel.addEventListener('mouseup', e => {
    if (!dragging) return;
    dragging = false;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) carouselMove(dx < 0 ? 1 : -1);
  });
  carousel.addEventListener('mouseleave', () => { dragging = false; });
}

// ── 관리자 모드 전환 ─────────────────────────────────────────────
function setAdminMode(active, password = '') {
  isAdminMode             = active;
  storedAdminPassword     = active ? password : '';

  const adminBtn = document.getElementById('adminBtn');
  const addBtn   = document.getElementById('addPopupBtn');

  if (active) {
    adminBtn.textContent = '관리자 모드 ON';
    adminBtn.classList.replace('btn-outline', 'btn-admin-active');
    adminBtn.style.display = 'inline-flex';
    addBtn.style.display = 'inline-flex';
  } else {
    adminBtn.textContent = '관리자';
    adminBtn.classList.replace('btn-admin-active', 'btn-outline');
    adminBtn.style.display = 'none';
    addBtn.style.display = 'none';
  }

  // 현재 열린 상세 패널 버튼 즉시 갱신
  if (selectedPopupId !== null) {
    const popup = popups.find(p => p.id === selectedPopupId);
    if (popup) showDetail(popup);
  }
}

// ── 계절 테마 ────────────────────────────────────────────────────
function applySeasonTheme(season) {
  ['spring','summer','fall','winter'].forEach(s => document.body.classList.remove(`season-${s}`));
  document.body.classList.add(`season-${season}`);
}

// ── 네이버 지도 초기화 ───────────────────────────────────────────
function initMap() {
  map = new naver.maps.Map('map', {
    center: new naver.maps.LatLng(SEOUL.lat, SEOUL.lng),
    zoom: 12,
    zoomControl: false,
    mapTypeControl: false,
  });

  naver.maps.Event.addListener(map, 'idle', renderClusters);
  naver.maps.Event.addListener(map, 'click', (e) => {
    if (document.getElementById('addModal').classList.contains('active')) {
      const form = document.getElementById('addForm');
      form.lat.value = e.coord.lat().toFixed(6);
      form.lng.value = e.coord.lng().toFixed(6);
      toast('위치가 설정되었습니다.', 'info');
    }
  });
}

// ── 마커 ────────────────────────────────────────────────────────
function createMarker(popup, addToMap = false) {
  const media = popup.media_path || popup.photo_path || null;
  const hasPhoto = media && !isVideoFile(media);

  const content = hasPhoto
    ? `<div class="custom-marker photo-marker" data-id="${popup.id}" title="${popup.name}">
         <div class="marker-photo-wrap">
           <img src="${mediaUrl(media)}" class="marker-photo" alt="${popup.name}" onerror="this.closest('.photo-marker').classList.add('photo-error')">
         </div>
       </div>`
    : `<div class="custom-marker" data-id="${popup.id}" title="${popup.name}">
         <div class="marker-pin ${popup.season}">
           <span class="marker-icon">${CATEGORY_ICON[popup.category] || '📍'}</span>
         </div>
       </div>`;

  const anchor = hasPhoto
    ? new naver.maps.Point(24, 52)
    : new naver.maps.Point(20, 30);

  const m = new naver.maps.Marker({
    position: new naver.maps.LatLng(popup.lat, popup.lng),
    map: addToMap ? map : null,
    icon: { content, anchor },
    title: popup.name,
  });

  naver.maps.Event.addListener(m, 'click', () => showDetail(popup));
  markers.push({ marker: m, popup });
  return m;
}

function clearMarkers() {
  clusterMarkers.forEach(m => m.setMap(null));
  clusterMarkers = [];
  markers.forEach(({ marker }) => marker.setMap(null));
  markers = [];
}

function onMultiThumbErr(img, icon) {
  img.parentNode.innerHTML = '<span class="multi-thumb-fallback">' + icon + '</span>';
}

// ── 클러스터링 ───────────────────────────────────────────────────
function clusterSize(n) {
  if (n <=  4) return { size: 44, font: 14 };
  if (n <=  9) return { size: 54, font: 15 };
  if (n <= 19) return { size: 64, font: 16 };
  return { size: 72, font: 17 };
}

function renderClusters() {
  if (!map) return;

  // 기존 클러스터 마커 제거 후 개별 마커도 모두 숨김
  clusterMarkers.forEach(m => m.setMap(null));
  clusterMarkers = [];
  markers.forEach(({ marker }) => marker.setMap(null));

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const notExpired = ({ popup }) => {
    if (isAdminMode) return true;
    if (popup.is_permanent) return true;
    if (!popup.end_date) return true;
    const end = new Date(popup.end_date); end.setHours(0, 0, 0, 0);
    return end >= today;
  };

  const activeItems = (filteredIds === null
    ? markers
    : markers.filter(({ popup }) => filteredIds.has(popup.id))
  ).filter(notExpired);

  if (activeItems.length === 0) return;

  const proj   = map.getProjection();
  const RADIUS = 55; // 묶음 판정 픽셀 반경

  const items = activeItems.map(({ marker, popup }) => ({
    marker, popup,
    px: proj.fromCoordToOffset(marker.getPosition()),
  }));

  const used = new Array(items.length).fill(false);

  for (let i = 0; i < items.length; i++) {
    if (used[i]) continue;
    const group = [i];
    used[i] = true;

    for (let j = i + 1; j < items.length; j++) {
      if (used[j]) continue;
      const dx = items[i].px.x - items[j].px.x;
      const dy = items[i].px.y - items[j].px.y;
      if (Math.sqrt(dx * dx + dy * dy) < RADIUS) {
        group.push(j);
        used[j] = true;
      }
    }

    if (group.length === 1) {
      items[i].marker.setMap(map);
    } else {
      const count  = group.length;
      const avgLat = group.reduce((s, k) => s + items[k].popup.lat, 0) / count;
      const avgLng = group.reduce((s, k) => s + items[k].popup.lng, 0) / count;
      const center = new naver.maps.LatLng(avgLat, avgLng);
      const groupPopups = group.map(k => items[k].popup);

      const sameLatLng = groupPopups.every(
        p => p.lat === groupPopups[0].lat && p.lng === groupPopups[0].lng
      );

      let cm;
      if (sameLatLng) {
        const displayCount = Math.min(count, 3);
        const pad = 4, thumbW = 40, gap = 3, tailH = 8;
        const totalW = pad * 2 + thumbW * displayCount + gap * (displayCount - 1);
        const totalH = pad * 2 + thumbW + tailH;
        const thumbsHtml = groupPopups.slice(0, displayCount).map(p => {
          const media = p.media_path || p.photo_path || null;
          const hasPhoto = media && !isVideoFile(media);
          const icon = CATEGORY_ICON[p.category] || '📍';
          const click = `event.stopPropagation();showDetail(popups.find(x=>x.id==='${p.id}'))`;
          if (hasPhoto) {
            return `<div class="multi-thumb" onclick="${click}"><img src="${mediaUrl(media)}" alt="" onerror="onMultiThumbErr(this,'${icon}')"></div>`;
          }
          return `<div class="multi-thumb multi-thumb-icon" onclick="${click}"><span class="multi-thumb-fallback">${icon}</span></div>`;
        }).join('');
        const extraIds = count > 3 ? groupPopups.slice(3).map(p => p.id).join(',') : '';
        const extraBadge = count > 3
          ? `<div class="multi-marker-extra" onclick="event.stopPropagation();showGroupByIds('${extraIds}',${avgLat},${avgLng})">+${count - 3}</div>`
          : '';
        cm = new naver.maps.Marker({
          position: center, map,
          icon: {
            content: `<div class="multi-marker" style="position:relative">${thumbsHtml}${extraBadge}</div>`,
            size: new naver.maps.Size(totalW, totalH),
            anchor: new naver.maps.Point(totalW / 2, totalH),
          },
          zIndex: 10,
        });
      } else {
        const { size: csz, font: cfs } = clusterSize(count);
        cm = new naver.maps.Marker({
          position: center, map,
          icon: {
            content: `<div class="cluster-marker" style="width:${csz}px;height:${csz}px"><span class="cluster-count" style="font-size:${cfs}px">${count}</span></div>`,
            size: new naver.maps.Size(csz, csz),
            anchor: new naver.maps.Point(csz / 2, csz / 2),
          },
          zIndex: 10,
        });
        naver.maps.Event.addListener(cm, 'click', () => {
          if (map.getZoom() >= 17) {
            showClusterList(groupPopups, center);
          } else {
            pendingScatterCenter = center;
            map.setZoom(Math.min(map.getZoom() + 3, 18));
            map.panTo(center);
          }
        });
      }
      clusterMarkers.push(cm);
    }
  }

  // 클러스터 클릭 후 개별 마커 흩어지기 애니메이션 (최초 1회)
  if (pendingScatterCenter && !scatterDone) {
    scatterDone = true;
    const sc = pendingScatterCenter;
    pendingScatterCenter = null;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const proj = map.getProjection();
      const cPx  = proj.fromCoordToOffset(sc);
      activeItems.forEach(({ marker, popup: p }) => {
        if (marker.getMap() !== map) return;
        const mPx = proj.fromCoordToOffset(marker.getPosition());
        const dx  = mPx.x - cPx.x;
        const dy  = mPx.y - cPx.y;
        if (Math.sqrt(dx * dx + dy * dy) > 300) return;
        const el = document.querySelector(`.custom-marker[data-id="${p.id}"]`);
        if (!el) return;
        el.classList.remove('scatter-in');
        void el.offsetWidth;
        el.style.setProperty('--sx', `${-dx}px`);
        el.style.setProperty('--sy', `${-dy}px`);
        el.classList.add('scatter-in');
      });
    }));
  } else {
    pendingScatterCenter = null;
  }
}

function showGroupByIds(idsStr, lat, lng) {
  const list = idsStr.split(',').map(id => popups.find(x => x.id === id)).filter(Boolean);
  showClusterList(list, new naver.maps.LatLng(lat, lng));
}

function showClusterList(popupList, center) {
  map.panTo(center);
  const items = popupList.map(p => `
    <div class="cluster-list-item" onclick="showDetail(popups.find(x=>x.id==='${p.id}'))">
      <span class="cluster-list-icon">${CATEGORY_ICON[p.category] || '📍'}</span>
      <span class="cluster-list-name">${esc(p.name)}</span>
    </div>`).join('');

  document.getElementById('detailContent').innerHTML = `
    <div class="detail-body">
      <div class="cluster-list-header">
        <button class="detail-overlay-btn" onclick="closeDetail()" style="margin-bottom:12px">
          <svg width="8" height="13" viewBox="0 0 10 16" fill="none"><path d="M8 1L2 8L8 15" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <span style="font-weight:700;font-size:15px">이 위치의 행사 ${popupList.length}개</span>
      </div>
      <div class="cluster-list">${items}</div>
    </div>`;
  document.getElementById('detailPanel').classList.add('open');
}

// ── 팝업 목록 로드 ───────────────────────────────────────────────
async function loadPopups(season = 'all') {
  try {
    const url = season !== 'all' ? `/api/popups?season=${season}` : '/api/popups';
    const res = await fetch(url);
    if (!res.ok) throw new Error();
    popups = await res.json();
    clearMarkers();
    popups.forEach(p => createMarker(p, false));
    renderClusters();
  } catch {
    toast('팝업 데이터를 불러오지 못했습니다.', 'error');
  }
}



// ── 갤러리 (그리드) ──────────────────────────────────────────────
function buildGalleryHtml(popup) {
  if (!isAdminMode) return '';
  const items  = popup.media_items || [];
  const addBtn = isAdminMode ? `
    <label class="gallery-add-item">
      <span class="add-icon">＋</span><span>사진·영상 추가</span>
      <input type="file" class="gallery-add-input"
        accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime,video/x-msvideo"
        onchange="handleGalleryUpload('${popup.id}',this)">
    </label>` : '';

  if (items.length === 0) {
    if (!addBtn) return '';
    return `
      <div class="gallery-section">
        <div class="gallery-section-title">📸 사진 · 영상</div>
        ${addBtn}
      </div>`;
  }

  const cells = items.map((item, idx) => {
    const isVid = item.type === 'video' || isVideoFile(item.filename);
    const url   = mediaUrl(item.filename);
    return `
      <div class="gallery-item${items.length === 1 ? ' gallery-item-full' : ''}" onclick="openLightbox('${popup.id}',${idx})">
        ${isVid
          ? `<video src="${url}" class="gallery-item-media"></video>
             <div class="gallery-play-icon"><span>▶</span></div>`
          : `<img src="${url}" class="gallery-item-media" alt="" loading="lazy">`}
        ${isAdminMode ? `<button class="gallery-delete-btn" onclick="event.stopPropagation();removeMedia('${popup.id}',${idx})">×</button>` : ''}
      </div>`;
  }).join('');

  return `
    <div class="gallery-section">
      <div class="gallery-section-title">📸 사진 · 영상</div>
      <div class="gallery-grid">${cells}</div>
      ${addBtn}
    </div>`;
}

function openLightbox(popupId, startIndex) {
  const popup = popups.find(p => p.id === popupId);
  if (!popup) return;
  const items = popup.media_items || [];
  if (items.length === 0) return;

  let idx = startIndex;
  const multi = items.length > 1;

  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay active';
  document.body.appendChild(overlay);

  function render(i) {
    const item  = items[i];
    const isVid = item.type === 'video' || isVideoFile(item.filename);
    const url   = mediaUrl(item.filename);
    overlay.innerHTML = `
      <button class="lightbox-close" onclick="event.stopPropagation()">✕</button>
      ${multi ? `<button class="lightbox-prev" onclick="event.stopPropagation()">&#8249;</button>` : ''}
      ${isVid
        ? `<video src="${url}" controls autoplay playsinline class="lightbox-media"></video>`
        : `<img src="${url}" class="lightbox-media" alt="">`}
      ${multi ? `<button class="lightbox-next" onclick="event.stopPropagation()">&#8250;</button>` : ''}
      ${multi ? `<div class="lightbox-counter">${i + 1} / ${items.length}</div>` : ''}
    `;
    overlay.querySelector('.lightbox-media').addEventListener('click', e => e.stopPropagation());
    overlay.querySelector('.lightbox-close').addEventListener('click', e => { e.stopPropagation(); close(); });
    if (multi) {
      overlay.querySelector('.lightbox-prev').addEventListener('click', e => { e.stopPropagation(); go(-1); });
      overlay.querySelector('.lightbox-next').addEventListener('click', e => { e.stopPropagation(); go(1); });
    }
  }

  function go(delta) {
    idx = (idx + delta + items.length) % items.length;
    render(idx);
  }

  render(idx);

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  overlay.addEventListener('click', close);

  const onKey = e => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight' && multi) go(1);
    if (e.key === 'ArrowLeft'  && multi) go(-1);
  };
  document.addEventListener('keydown', onKey);

  // 스와이프
  let swipeX = 0;
  overlay.addEventListener('touchstart', e => { swipeX = e.touches[0].clientX; }, { passive: true });
  overlay.addEventListener('touchend', e => {
    const dx = swipeX - e.changedTouches[0].clientX;
    if (Math.abs(dx) > 50 && multi) go(dx > 0 ? 1 : -1);
  }, { passive: true });
}

async function handleGalleryUpload(popupId, input) {
  const file = input.files[0];
  if (!file) return;
  input.disabled = true;
  try {
    const uploadData = await uploadToStorage(file);
    if (!uploadData.url) throw new Error('업로드에 실패했습니다.');

    const addRes  = await fetch(`/api/popups/${popupId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: uploadData.filename, type: uploadData.type }),
    });
    const addData = await addRes.json();
    if (!addRes.ok) throw new Error(addData.error);

    toast(`${uploadData.type === 'video' ? '영상' : '사진'}이 추가되었습니다.`, 'success');
    await loadPopups(currentSeason);
    const updated = popups.find(p => p.id === popupId);
    if (updated) showDetail(updated);
  } catch (err) {
    toast(err.message || '업로드에 실패했습니다.', 'error');
  } finally {
    input.disabled = false;
    input.value = '';
  }
}

async function removeMedia(popupId, index) {
  if (!confirm('이 사진/영상을 삭제하시겠습니까?')) return;
  try {
    const res = await fetch(`/api/popups/${popupId}/media/${index}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPassword: storedAdminPassword }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);
    toast('삭제되었습니다.', 'success');
    await loadPopups(currentSeason);
    const updated = popups.find(p => p.id === popupId);
    if (updated) showDetail(updated);
  } catch (err) {
    toast(err.message || '삭제에 실패했습니다.', 'error');
  }
}

// ── 카카오 공유 ───────────────────────────────────────────────────
function shareKakao(popupId) {
  if (!window.Kakao || !Kakao.isInitialized()) {
    toast('카카오 앱 키가 초기화되지 않았습니다.', 'error');
    return;
  }
  const popup = popups.find(p => p.id === popupId);
  if (!popup) return;

  const media    = popup.media_path || popup.photo_path;
  const imageUrl = media && !isVideoFile(media)
    ? (media.startsWith('http') ? media : `${location.origin}/uploads/${media}`)
    : null;
  // 공유 받은 사람이 링크를 누르면 해당 팝업 상세가 바로 열리는 딥링크
  const shareUrl = `${location.origin}${location.pathname}?popup=${popupId}`;

  const descParts = [
    `📅 ${formatDate(popup.start_date)} ~ ${formatDate(popup.end_date)}`,
    popup.venue   ? `🏛️ ${popup.venue}`   : '',
    popup.address ? `📍 ${popup.address}` : '',
  ].filter(Boolean);

  const content = {
    title: popup.name,
    description: descParts.join('\n'),
    link: { mobileWebUrl: shareUrl, webUrl: shareUrl },
  };
  if (imageUrl) content.imageUrl = imageUrl;

  const buttons = [{ title: '🗺️ 지도에서 보기', link: { mobileWebUrl: shareUrl, webUrl: shareUrl } }];
  if (popup.website_url) {
    buttons.push({ title: '공식 페이지', link: { mobileWebUrl: popup.website_url, webUrl: popup.website_url } });
  }

  Kakao.Share.sendDefault({ objectType: 'feed', content, buttons });
}

function shareViaSMS(popupId) {
  const popup = popups.find(p => p.id === popupId);
  if (!popup) return;
  const shareUrl = `${location.origin}${location.pathname}?popup=${popupId}`;
  const parts = [popup.name];
  if (popup.start_date || popup.end_date) parts.push(`📅 ${formatDate(popup.start_date)} ~ ${formatDate(popup.end_date)}`);
  if (popup.venue) parts.push(`📍 ${popup.venue}`);
  parts.push(shareUrl);
  window.location.href = `sms:?body=${encodeURIComponent(parts.join('\n'))}`;
}

function showShareMenu(popupId, btn) {
  const existing = document.getElementById('shareMenu');
  if (existing) { existing.remove(); return; }

  const menu = document.createElement('div');
  menu.id = 'shareMenu';
  menu.className = 'share-menu';
  menu.innerHTML = `
    <button class="share-menu-item" onclick="shareViaSMS('${popupId}');document.getElementById('shareMenu')?.remove()">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      문자 메시지
    </button>
    <button class="share-menu-item" onclick="shareKakao('${popupId}');document.getElementById('shareMenu')?.remove()">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
      카카오톡
    </button>
  `;

  const rect = btn.getBoundingClientRect();
  menu.style.top  = (rect.bottom + 6) + 'px';
  menu.style.right = (window.innerWidth - rect.right) + 'px';
  document.body.appendChild(menu);

  setTimeout(() => {
    document.addEventListener('click', function closeMenu(e) {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    });
  }, 10);
}

// ── 찜 기능 ──────────────────────────────────────────────────────
function getFavorites() {
  try { return new Set(JSON.parse(localStorage.getItem('fav_popups') || '[]')); }
  catch { return new Set(); }
}
function saveFavorites(set) {
  localStorage.setItem('fav_popups', JSON.stringify([...set]));
}
function isFavorite(id) { return getFavorites().has(id); }

function toggleFavorite(id) {
  const favs = getFavorites();
  if (favs.has(id)) { favs.delete(id); toast('찜을 취소했습니다.', 'info'); }
  else              { favs.add(id);    toast('찜 목록에 저장했습니다! ♥', 'success'); }
  saveFavorites(favs);
  updateHeartBtn(id);
  updateFavBtn();
}

function updateHeartBtn(id) {
  const btn = document.getElementById('heartBtn');
  if (!btn) return;
  const fav = isFavorite(id);
  btn.textContent = fav ? '♥' : '♡';
  btn.classList.toggle('favorited', fav);
}

function updateFavBtn() {
  const count = getFavorites().size;
  const btn   = document.getElementById('favBtn');
  if (!btn) return;
  btn.textContent = count > 0 ? `♥ 찜 ${count}` : '♡ 찜';
  btn.classList.toggle('btn-fav-active', count > 0);
}

function buildFavListHtml() {
  const favIds   = getFavorites();
  if (favIds.size === 0) {
    return `<div class="empty-state"><div class="empty-icon">♡</div><p>찜한 전시·팝업이 없어요.<br>마음에 드는 팝업의 하트를 눌러보세요!</p></div>`;
  }
  const favPopups = popups.filter(p => favIds.has(p.id));
  if (favPopups.length === 0) {
    return `<div class="empty-state"><div class="empty-icon">♡</div><p>찜한 항목 정보를 불러올 수 없습니다.</p></div>`;
  }
  return favPopups.map(p => {
    const media = p.media_path || p.photo_path;
    const thumb = media && !isVideoFile(media)
      ? `<img src="${mediaUrl(media)}" class="fav-thumb" alt="">`
      : `<div class="fav-thumb fav-thumb-empty">${CATEGORY_ICON[p.category] || '📍'}</div>`;
    return `
      <div class="fav-item" onclick="openFavPopup('${p.id}')">
        ${thumb}
        <div class="fav-info">
          <div class="fav-name">${p.name}</div>
          ${(p.start_date || p.end_date) ? `<div class="fav-meta"><span class="fav-icon">${ICON.calendar}</span>${formatDate(p.start_date)} ~ ${formatDate(p.end_date)}</div>` : ''}
          ${p.venue ? `<div class="fav-meta"><span class="fav-icon">${ICON.building}</span>${esc(p.venue)}</div>` : ''}
          ${p.end_date ? dDayBadge(p.end_date) : ''}
        </div>
        <button class="fav-remove-btn" onclick="event.stopPropagation();removeFav('${p.id}')">×</button>
      </div>`;
  }).join('');
}

function openFavPopup(id) {
  closeModal('favModal');
  const popup = popups.find(p => p.id === id);
  if (!popup) return;
  if (map) map.panTo(new naver.maps.LatLng(popup.lat, popup.lng));
  showDetail(popup);
}

function removeFav(id) {
  const favs = getFavorites();
  favs.delete(id);
  saveFavorites(favs);
  updateHeartBtn(id);
  updateFavBtn();
  document.getElementById('favList').innerHTML = buildFavListHtml();
  const count = popups.filter(p => favs.has(p.id) && p.lat && p.lng).length;
  document.getElementById('favRouteFooter').style.display = count >= 2 ? 'block' : 'none';
}

function initFavorites() {
  updateFavBtn();
  document.getElementById('favBtn').addEventListener('click', () => {
    document.getElementById('favList').innerHTML = buildFavListHtml();
    const footer = document.getElementById('favRouteFooter');
    const count = popups.filter(p => getFavorites().has(p.id) && p.lat && p.lng).length;
    footer.style.display = count >= 2 ? 'block' : 'none';
    switchFavTab('list');
    openModal('favModal');
  });
}

function switchFavTab(tab) {
  document.getElementById('tabFavList').classList.toggle('active', tab === 'list');
  document.getElementById('tabRoutes').classList.toggle('active', tab === 'routes');
  document.getElementById('favListPane').style.display   = tab === 'list'   ? '' : 'none';
  document.getElementById('favRoutesPane').style.display = tab === 'routes' ? '' : 'none';
  if (tab === 'routes') document.getElementById('savedRoutesList').innerHTML = buildSavedRoutesHtml();
}

// ── 동선 저장/불러오기 ────────────────────────────────────────────
function getSavedRoutes() {
  try { return JSON.parse(localStorage.getItem('saved_routes') || '[]'); }
  catch { return []; }
}

function buildSavedRoutesHtml() {
  const routes = getSavedRoutes();
  if (routes.length === 0) {
    return `<div class="empty-state"><div class="empty-icon">🗺️</div><p>저장된 동선이 없어요.<br>동선 만들기 후 저장해보세요!</p></div>`;
  }
  return routes.slice().reverse().map(r => {
    const validCount = r.popupIds.filter(id => popups.find(p => p.id === id && p.lat && p.lng)).length;
    return `
      <div class="saved-route-item" onclick="loadSavedRoute('${r.id}')">
        <div class="saved-route-info">
          <div class="saved-route-name">${esc(r.name)}</div>
          <div class="saved-route-meta">📍 ${validCount}곳</div>
        </div>
        <button class="fav-remove-btn" onclick="event.stopPropagation();deleteSavedRouteItem('${r.id}')" title="삭제">✕</button>
      </div>`;
  }).join('');
}

function deleteSavedRouteItem(id) {
  const routes = getSavedRoutes().filter(r => r.id !== id);
  localStorage.setItem('saved_routes', JSON.stringify(routes));
  document.getElementById('savedRoutesList').innerHTML = buildSavedRoutesHtml();
}

function loadSavedRoute(routeId) {
  const route = getSavedRoutes().find(r => r.id === routeId);
  if (!route) { toast('동선을 찾을 수 없어요.', 'error'); return; }

  closeModal('favModal');

  const validPopups = route.popupIds
    .map(id => popups.find(p => String(p.id) === String(id)))
    .filter(p => p && p.lat && p.lng);

  if (validPopups.length < 2) {
    toast('표시할 수 있는 장소가 2곳 미만이에요.', 'info');
    return;
  }

  routeMode  = true;
  routeOrder = validPopups.map(p => p.id);
  _drawRoute();
  renderRoutePanel();

  if (map) {
    const bounds = new naver.maps.LatLngBounds();
    validPopups.forEach(p => bounds.extend(new naver.maps.LatLng(p.lat, p.lng)));
    const isMobile = window.innerWidth <= 768;
    const padding = isMobile
      ? { top: 60, right: 20, bottom: Math.round(window.innerHeight * 0.44), left: 20 }
      : 80;
    setTimeout(() => map.fitBounds(bounds, { padding }), 50);
  }
}

function toggleRouteSaveSection() {
  const section = document.getElementById('routeSaveSection');
  if (!section) return;
  const show = section.style.display === 'none';
  section.style.display = show ? '' : 'none';
  if (show) {
    setTimeout(() => {
      const inp = document.getElementById('routeNameInput');
      if (!inp) return;
      inp.focus();
      inp.onkeydown = e => { if (e.key === 'Enter') confirmSaveRoute(); };
    }, 50);
  }
}

function confirmSaveRoute() {
  const input = document.getElementById('routeNameInput');
  if (!input) return;
  const name = input.value.trim();
  if (!name) { input.focus(); return; }

  const routes = getSavedRoutes();
  routes.push({ id: 'route_' + Date.now(), name, popupIds: [...routeOrder], createdAt: new Date().toISOString() });
  localStorage.setItem('saved_routes', JSON.stringify(routes));

  toast(`"${name}" 동선이 저장됐어요! 🗺️`, 'success');
  document.getElementById('routeSaveSection').style.display = 'none';
  input.value = '';
}

// ── 동선 만들기 ──────────────────────────────────────────────────
function enterRouteMode() {
  const favIds = getFavorites();
  const favPopups = popups.filter(p => favIds.has(p.id) && p.lat && p.lng);
  if (favPopups.length < 2) {
    toast('위치 정보가 있는 찜 장소가 2곳 이상 필요해요.', 'info');
    return;
  }
  closeModal('favModal');
  routeMode  = true;
  routeOrder = favPopups.map(p => p.id);
  _drawRoute();
  renderRoutePanel();

  const bounds = new naver.maps.LatLngBounds();
  favPopups.forEach(p => bounds.extend(new naver.maps.LatLng(p.lat, p.lng)));
  const isMobile = window.innerWidth <= 768;
  const padding = isMobile
    ? { top: 60, right: 20, bottom: Math.round(window.innerHeight * 0.44), left: 20 }
    : 80;
  setTimeout(() => map.fitBounds(bounds, { padding }), 50);
}

function exitRouteMode() {
  _clearRouteOverlays();
  routeMode  = false;
  routeOrder = [];
  document.getElementById('detailPanel').classList.remove('open', 'route-mode');
  selectedPopupId = null;
}

function _clearRouteOverlays() {
  if (_routeFetchCtrl) { _routeFetchCtrl.abort(); _routeFetchCtrl = null; }
  if (routePolyline) { routePolyline.setMap(null); routePolyline = null; }
  routeStopMarkers.forEach(m => m.setMap(null));
  routeStopMarkers = [];
}

async function _drawRoute() {
  _clearRouteOverlays();
  const ordered = routeOrder.map(id => popups.find(p => p.id === id)).filter(Boolean);
  if (ordered.length < 2 || !map) return;

  // 마커는 즉시 표시
  ordered.forEach((p, i) => {
    const m = new naver.maps.Marker({
      position: new naver.maps.LatLng(p.lat, p.lng),
      map,
      icon: {
        content: `<div class="route-stop-dot">${i + 1}</div>`,
        anchor: new naver.maps.Point(15, 15),
      },
      zIndex: 20,
    });
    naver.maps.Event.addListener(m, 'click', () => showDetail(p));
    routeStopMarkers.push(m);
  });

  // OSRM으로 도로 경로 fetch (이전 요청 취소)
  _routeFetchCtrl = new AbortController();
  const { signal } = _routeFetchCtrl;
  try {
    const waypoints = ordered.map(p => `${p.lng},${p.lat}`).join(';');
    const res  = await fetch(
      `https://router.project-osrm.org/route/v1/foot/${waypoints}?overview=full&geometries=geojson`,
      { signal }
    );
    const data = await res.json();
    if (!routeMode || !map) return;
    if (data.code === 'Ok' && data.routes?.[0]?.geometry?.coordinates?.length) {
      const path = data.routes[0].geometry.coordinates.map(
        ([lng, lat]) => new naver.maps.LatLng(lat, lng)
      );
      if (routePolyline) routePolyline.setMap(null);
      routePolyline = new naver.maps.Polyline({
        map, path,
        strokeColor: '#1565C0',
        strokeWeight: 4,
        strokeOpacity: 0.9,
      });
      return;
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
  }

  // 폴백: 직선 점선
  if (!routeMode || !map) return;
  routePolyline = new naver.maps.Polyline({
    map,
    path: ordered.map(p => new naver.maps.LatLng(p.lat, p.lng)),
    strokeColor: '#FF85A2',
    strokeWeight: 4,
    strokeStyle: 'longdash',
    strokeOpacity: 0.85,
  });
}

function renderRoutePanel() {
  const ordered = routeOrder.map(id => popups.find(p => p.id === id)).filter(Boolean);

  let totalKm = 0;
  for (let i = 0; i < ordered.length - 1; i++) {
    totalKm += haversineKm(ordered[i].lat, ordered[i].lng, ordered[i + 1].lat, ordered[i + 1].lng);
  }
  const distLabel = totalKm < 1
    ? `${Math.round(totalKm * 1000)}m`
    : `${totalKm.toFixed(1)}km`;

  const items = ordered.map((p, i) => `
    <div class="route-stop-item">
      <div class="route-stop-num">${i + 1}</div>
      <div class="route-stop-info" onclick="showDetail(popups.find(x=>x.id==='${p.id}'))">
        <div class="route-stop-name">${esc(p.name)}</div>
        ${p.venue ? `<div class="route-stop-venue">${esc(p.venue)}</div>` : ''}
      </div>
      <div class="route-stop-actions">
        <button ${i === 0 ? 'disabled' : ''} onclick="moveRouteItem(${i}, -1)" title="위로">↑</button>
        <button ${i === ordered.length - 1 ? 'disabled' : ''} onclick="moveRouteItem(${i}, 1)" title="아래로">↓</button>
        <button class="route-remove" onclick="removeFromRoute('${p.id}')" title="제거">×</button>
      </div>
    </div>
    ${i < ordered.length - 1 ? `<div class="route-connector"><span class="route-dist">${haversineKm(p.lat, p.lng, ordered[i+1].lat, ordered[i+1].lng) < 1 ? Math.round(haversineKm(p.lat, p.lng, ordered[i+1].lat, ordered[i+1].lng)*1000) + 'm' : haversineKm(p.lat, p.lng, ordered[i+1].lat, ordered[i+1].lng).toFixed(1) + 'km'}</span></div>` : ''}
  `).join('');

  document.getElementById('detailContent').innerHTML = `
    <div class="detail-body">
      <div class="route-panel-header">
        <div>
          <div class="route-panel-title">🗺️ 나만의 동선</div>
          <div class="route-panel-meta">총 ${ordered.length}곳 · 직선 거리 ${distLabel}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <button class="btn btn-outline btn-sm" onclick="toggleRouteSaveSection()">💾 저장</button>
          <button class="btn btn-outline btn-sm" onclick="exitRouteMode()">종료</button>
        </div>
      </div>
      <div id="routeSaveSection" style="display:none;">
        <div class="route-save-row">
          <input type="text" id="routeNameInput" placeholder="동선 이름 (예: 홍대 데이트 코스)" maxlength="30">
          <button class="tips-submit-btn" onclick="confirmSaveRoute()">저장</button>
        </div>
      </div>
      <div class="route-stop-list">${items}</div>
    </div>`;

  const panel = document.getElementById('detailPanel');
  panel.classList.add('open');
  if (window.innerWidth <= 768) panel.classList.add('route-mode');
}

function moveRouteItem(idx, dir) {
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= routeOrder.length) return;
  [routeOrder[idx], routeOrder[newIdx]] = [routeOrder[newIdx], routeOrder[idx]];
  _drawRoute();
  renderRoutePanel();
}

function removeFromRoute(id) {
  routeOrder = routeOrder.filter(i => i !== id);
  if (routeOrder.length < 2) {
    exitRouteMode();
    if (routeOrder.length === 1) toast('장소가 1곳 남아 동선을 종료했어요.', 'info');
    return;
  }
  _drawRoute();
  renderRoutePanel();
}

// ── 필터 ─────────────────────────────────────────────────────────
const CATEGORY_FILTERS = new Set(['exhibition','popup_store','festival','market','museum','library','other']);

const VIBE_TAGS = {
  inspiration: p => p.category === 'exhibition' || /아트|예술|작가|갤러리|미디어아트|창작/.test(p.name + p.description),
  photo:       p => /포토존|인스타|사진전|미디어아트|빛|조명|봄꽃|벚꽃|야경|파사드|경관/.test(p.name + p.description),
  quiet:       p => p.category === 'exhibition' && /도자기|전통|사진전|갤러리|한옥|산책|문화/.test(p.name + p.description),
  indoor:      p => ['exhibition', 'popup_store', 'market'].includes(p.category),
  night:       p => /야경|빛|조명|크리스마스|미디어|파사드|빛 축제/.test(p.name + p.description),
  picnic:      p => /한강|공원|야외|피크닉|돗자리|나들이/.test(p.name + p.description + (p.address || '')),
  shopping:    p => p.category === 'popup_store' || p.category === 'market',
};

function passesFilters(p) {
  if (activeFilters.has('operating')) {
    const now   = new Date();
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const start = new Date(p.start_date); start.setHours(0, 0, 0, 0);
    const end   = new Date(p.end_date);   end.setHours(0, 0, 0, 0);

    // 날짜 범위 체크
    if (today < start || today > end) return false;

    // 운영시간 체크 (등록된 경우)
    if (p.opening_hours) {
      const firstEntry = p.opening_hours.split('|')[0].trim();
      const m = firstEntry.match(/(\d{1,2}):(\d{2})\s*[~\-–]\s*(\d{1,2}):(\d{2})/);
      if (m) {
        const nowMin   = now.getHours() * 60 + now.getMinutes();
        const openMin  = parseInt(m[1]) * 60 + parseInt(m[2]);
        const closeMin = parseInt(m[3]) * 60 + parseInt(m[4]);
        if (nowMin < openMin || nowMin > closeMin) return false;
      }
    }
  }
  if (activeFilters.has('free')) {
    const fee = (p.admission_fee || '').trim();
    if (fee && !fee.includes('무료')) return false;
  }
  const catFilters = [...activeFilters].filter(f => CATEGORY_FILTERS.has(f));
  if (catFilters.length > 0 && !catFilters.includes(p.category)) return false;

  const vibeFilters = [...activeFilters].filter(f => f.startsWith('vibe-'));
  if (vibeFilters.length > 0) {
    const passes = vibeFilters.some(f => {
      const fn = VIBE_TAGS[f.replace('vibe-', '')];
      return fn && fn(p);
    });
    if (!passes) return false;
  }

  return true;
}

function applyFilters() {
  filteredIds = activeFilters.size === 0
    ? null
    : new Set(popups.filter(passesFilters).map(p => p.id));

  document.querySelectorAll('.chip[data-filter]').forEach(chip => {
    chip.classList.toggle('active', activeFilters.has(chip.dataset.filter));
  });
  document.querySelectorAll('.vibe-chip[data-vibe]').forEach(chip => {
    chip.classList.toggle('active', activeFilters.has('vibe-' + chip.dataset.vibe));
  });
  renderClusters();
}

function initFilters() {
  document.querySelectorAll('.chip[data-filter]').forEach(chip => {
    chip.addEventListener('click', () => {
      const f = chip.dataset.filter;
      if (activeFilters.has(f)) activeFilters.delete(f);
      else activeFilters.add(f);
      applyFilters();
    });
  });
}

function initVibeChips() {
  document.querySelectorAll('.vibe-chip[data-vibe]').forEach(chip => {
    chip.addEventListener('click', () => {
      const id = 'vibe-' + chip.dataset.vibe;
      if (activeFilters.has(id)) activeFilters.delete(id);
      else activeFilters.add(id);
      applyFilters();
    });
  });
}

// ── 영업 상태 뱃지 ───────────────────────────────────────────────
function isClosedToday(text) {
  if (!text) return false;
  const dayKo = ['일', '월', '화', '수', '목', '금', '토'][new Date().getDay()];
  if (text.includes(dayKo + '요일')) return true;
  // "월·화·수" 또는 "월,화" 단독 글자 형태
  return new RegExp(`(^|[·,\\s/])${dayKo}([·,\\s/요]|$)`).test(text);
}

function getOperatingStatus(popup) {
  const now   = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);

  if (popup.is_permanent || !popup.end_date) {
    if (isClosedToday(popup.closed_days)) return { icon: '🔴', text: '금일 휴무', cls: 'status-holiday' };
    if (popup.opening_hours) {
      const firstEntry = popup.opening_hours.split('|')[0].trim();
      const m = firstEntry.match(/(\d{1,2}):(\d{2})\s*[~\-–]\s*(\d{1,2}):(\d{2})/);
      if (m) {
        const nowMin   = now.getHours() * 60 + now.getMinutes();
        const openMin  = +m[1] * 60 + +m[2];
        const closeMin = +m[3] * 60 + +m[4];
        if (nowMin < openMin) return { icon: '🟡', text: `오늘 ${m[1]}:${m[2]} 오픈`, cls: 'status-opens-soon' };
        if (nowMin > closeMin) return { icon: '🔴', text: '금일 영업 종료', cls: 'status-closed-today' };
      }
    }
    return { icon: '🟢', text: '현재 운영 중', cls: 'status-open' };
  }

  const start = new Date(popup.start_date); start.setHours(0, 0, 0, 0);
  const end   = new Date(popup.end_date);   end.setHours(0, 0, 0, 0);

  if (today > end)   return { icon: '⚫', text: '운영 종료', cls: 'status-ended' };
  if (today < start) {
    const days = Math.ceil((start - today) / 86400000);
    return { icon: '🔵', text: days === 1 ? '내일 오픈' : `${days}일 후 오픈`, cls: 'status-upcoming' };
  }
  if (isClosedToday(popup.closed_days)) {
    return { icon: '🔴', text: '금일 휴무', cls: 'status-holiday' };
  }
  if (popup.opening_hours) {
    const firstEntry = popup.opening_hours.split('|')[0].trim();
    const m = firstEntry.match(/(\d{1,2}):(\d{2})\s*[~\-–]\s*(\d{1,2}):(\d{2})/);
    if (m) {
      const nowMin   = now.getHours() * 60 + now.getMinutes();
      const openMin  = +m[1] * 60 + +m[2];
      const closeMin = +m[3] * 60 + +m[4];
      if (nowMin < openMin) return { icon: '🟡', text: `오늘 ${m[1]}:${m[2]} 오픈`, cls: 'status-opens-soon' };
      if (nowMin > closeMin) return { icon: '🔴', text: '금일 영업 종료',            cls: 'status-closed-today' };
    }
  }
  return { icon: '🟢', text: '현재 운영 중', cls: 'status-open' };
}

// ── 상세 패널 ────────────────────────────────────────────────────
function showDetail(popup) {
  selectedPopupId = popup.id;
  const _inRoute = routeMode;

  const media    = popup.media_path || popup.photo_path || null;
  const opStatus = getOperatingStatus(popup);

  const favored = isFavorite(popup.id);
  document.getElementById('detailContent').innerHTML = `
    <div class="detail-hero">
      ${buildCarouselHtml(popup)}
      <div class="detail-overlay-bar">
        <div class="detail-overlay-handle"></div>
        <div class="detail-overlay-row">
          <button class="detail-overlay-btn" onclick="${_inRoute ? 'renderRoutePanel()' : 'closeDetail()'}">
            <svg width="10" height="16" viewBox="0 0 10 16" fill="none"><path d="M8 1L2 8L8 15" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="detail-overlay-right">
            <button class="detail-overlay-btn" onclick="showShareMenu('${popup.id}', this)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
            </button>
            <button class="detail-overlay-btn heart-overlay-btn${favored ? ' favorited' : ''}" id="heartBtn" onclick="toggleFavorite('${popup.id}')">${favored ? '♥' : '♡'}</button>
          </div>
        </div>
      </div>
    </div>
    <div class="detail-body">
      ${(() => {
        const tags = (popup.keywords || '').split(',').map(t => t.trim()).filter(Boolean);
        const firstTag = tags[0] || '';
        const accentBadge = firstTag ? `<span class="detail-accent-badge">${esc(firstTag)}</span>` : '';
        const feeParts = (popup.admission_fee || '').split('.').map(s => s.trim()).filter(Boolean);
        const feeBadge = feeParts.map((p, i) =>
          `<span class="detail-fee-badge${i > 0 ? ' detail-fee-badge-alt' : ''}">${esc(p)}</span>`
        ).join(' ');
        const badgeRow = accentBadge ? `<div class="detail-badge-row">${accentBadge}</div>` : '';
        return `
      <div class="detail-title-section">
        ${badgeRow}
        <h1 class="detail-title">${esc(popup.name)}${feeBadge ? `&ensp;${feeBadge}` : ''}</h1>
        ${popup.description ? `<p class="detail-subtitle">${nl2br(popup.description)}</p>` : ''}
      </div>
      `;
      })()}
      ${popup.venue ? `<div class="detail-info-row"><span class="detail-info-icon">${ICON.building}</span><span class="detail-info-text">${esc(popup.venue)}</span></div>` : ''}
      ${popup.address ? `<div class="detail-info-row"><span class="detail-info-icon">${ICON.mapPin}</span><span class="detail-info-text">${esc(popup.address)}</span></div>` : ''}
      ${(() => {
        if (!popup.nearby_station) return '';
        const renderEntry = s => {
          const m = s.match(/^(\d+)호선\s*/);
          if (m) {
            const line = m[1];
            const rest = s.slice(m[0].length);
            return `<span class="subway-entry"><span class="subway-badge line-${line}">${line}</span><span class="detail-info-text">${esc(rest)}</span></span>`;
          }
          return `<span class="subway-entry"><span class="detail-info-icon">${ICON.mapPin}</span><span class="detail-info-text">${esc(s)}</span></span>`;
        };
        return popup.nearby_station.split('|').map(s => s.trim()).filter(Boolean).map(row => {
          const entries = row.split(',').map(s => s.trim()).filter(Boolean);
          const parsed = entries.map(s => {
            const m = s.match(/^(\d+)호선\s*/);
            if (m) return { type: 'line', line: m[1], text: s.slice(m[0].length) };
            return { type: 'other', text: s };
          });
          const allLine = parsed.length > 1 && parsed.every(e => e.type === 'line');
          if (allLine) {
            const badges = parsed.map(e => `<span class="subway-badge line-${e.line}">${e.line}</span>`).join('');
            const texts = parsed.map(e => esc(e.text)).join(' ');
            return `<div class="detail-info-row subway-row"><span class="subway-badges-cluster">${badges}</span><span class="detail-info-text">${texts}</span></div>`;
          }
          return `<div class="detail-info-row subway-row">${parsed.map(e => {
            if (e.type === 'line') return `<span class="subway-entry"><span class="subway-badge line-${e.line}">${e.line}</span><span class="detail-info-text">${esc(e.text)}</span></span>`;
            return `<span class="subway-entry"><span class="detail-info-icon">${ICON.mapPin}</span><span class="detail-info-text">${esc(e.text)}</span></span>`;
          }).join('')}</div>`;
        }).join('');
      })()}
      ${!popup.is_permanent && (popup.start_date || popup.end_date)
        ? `<div class="detail-info-row"><span class="detail-info-icon">${ICON.calendar}</span><span class="detail-info-text">${formatDate(popup.start_date)} ~ ${formatDate(popup.end_date)}</span></div>`
        : ''}
      <div class="detail-info-row"><span class="detail-info-icon">${opStatus.icon}</span><span class="operating-badge ${opStatus.cls}">${opStatus.text}</span></div>
      ${(() => {
        if (!popup.opening_hours) return '';
        const rows = popup.opening_hours.split('|').map(h => h.trim()).filter(Boolean);
        if (rows.length === 0) return '';
        return `<div class="detail-info-row detail-hours-row">
          <span class="detail-info-icon">${ICON.clock}</span>
          <span class="detail-info-text">${rows.map((h, i) => i === 0 ? h : `<span class="hours-sub-line">${h}</span>`).join('')}</span>
        </div>`;
      })()}
      ${popup.closed_days ? `<div class="detail-info-row"><span class="detail-info-icon">${ICON.ban}</span><span class="detail-info-text">휴무 ${popup.closed_days}</span></div>` : ''}
      <div class="detail-link-row">
        ${popup.website_url ? `<a href="${popup.website_url}" target="_blank" rel="noopener" class="btn btn-official">공식 페이지</a>` : ''}
        <button class="btn btn-kakao" onclick="shareKakao('${popup.id}')">
          <img src="https://developers.kakao.com/assets/img/about/logos/kakaolink/kakaolink_btn_medium.png" alt="" style="width:18px;height:18px;vertical-align:middle;margin-right:4px;">카카오톡 공유
        </button>
      </div>
      ${buildGalleryHtml(popup)}

      <div class="tips-section">
        <div class="tips-header">방문자 사진·영상</div>
        <div id="visitorPhotoGrid" class="visitor-photo-grid"></div>
        <label class="visitor-photo-add">
          📷 사진·영상 추가
          <input type="file" hidden accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime,video/x-msvideo" onchange="handleVisitorPhotoUpload('${popup.id}',this)">
        </label>
      </div>

      <div class="tips-section">
        <div class="tips-header">방문자 리뷰</div>
        <ul class="tips-list" id="tipsList"><li class="tips-loading">불러오는 중...</li></ul>
        <div class="tips-input-row">
          <input class="tips-input" id="tipInput" type="text" placeholder="한 줄 리뷰를 남겨보세요 (100자 이내)" maxlength="100">
          <button class="tips-submit-btn" onclick="submitTip('${popup.id}')">등록</button>
        </div>
      </div>

      ${isAdminMode ? `
      <div class="detail-actions">
        <button class="btn btn-outline" onclick="startEdit('${popup.id}')">✏️ 수정</button>
        <button class="btn btn-danger"  onclick="deletePopup('${popup.id}')">🗑️ 삭제</button>
      </div>` : ''}
    </div>`;

  document.getElementById('detailPanel').classList.add('open');
  initCarouselSwipe();
  loadVisitorPhotos(popup.id);
  loadTips(popup.id);
}

function closeDetail() {
  if (routeMode) {
    _clearRouteOverlays();
    routeMode  = false;
    routeOrder = [];
  }
  document.getElementById('detailPanel').classList.remove('open', 'route-mode');
  selectedPopupId = null;
}

function relativeTime(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  return new Date(dateStr).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

let _visitorPhotos = [];

async function loadVisitorPhotos(popupId) {
  const grid = document.getElementById('visitorPhotoGrid');
  if (!grid) return;
  try {
    const res    = await fetch(`/api/visitor-photos/${popupId}`);
    const photos = await res.json();
    _visitorPhotos = photos;
    if (!photos.length) { grid.innerHTML = '<p class="tips-empty">아직 등록된 사진이 없어요.</p>'; return; }
    grid.innerHTML = photos.map((p, i) => {
      const deleteBtn = isAdminMode
        ? `<button class="vp-delete-btn" onclick="deleteVisitorPhoto('${p.id}','${popupId}',event)">✕</button>`
        : '';
      if (p.type === 'video') {
        return `<div class="vp-item" onclick="openVisitorLightbox(${i})">
          <video class="vp-media" src="${p.url}" muted playsinline></video>
          <span class="vp-play">▶</span>
          ${deleteBtn}
        </div>`;
      }
      return `<div class="vp-item" onclick="openVisitorLightbox(${i})">
        <img class="vp-media" src="${p.url}" alt="" loading="lazy">
        ${deleteBtn}
      </div>`;
    }).join('');
  } catch {
    if (grid) grid.innerHTML = '<p class="tips-empty">불러오기 실패</p>';
  }
}

async function handleVisitorPhotoUpload(popupId, input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  const label = input.closest('label');
  const origText = label.childNodes[0].textContent;
  label.childNodes[0].textContent = '⏳ 업로드 중...';
  try {
    const upData = await uploadToStorage(file);
    if (!upData.url) { toast('업로드 실패', 'error'); return; }

    const saveRes = await fetch(`/api/visitor-photos/${popupId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: upData.url, type: upData.type }),
    });
    if (!saveRes.ok) { toast('저장 실패', 'error'); return; }
    toast('사진이 등록됐어요! 📸');
    await loadVisitorPhotos(popupId);
  } catch {
    toast('서버 오류가 발생했습니다.', 'error');
  } finally {
    label.childNodes[0].textContent = origText;
  }
}

async function deleteVisitorPhoto(id, popupId, e) {
  e.stopPropagation();
  if (!confirm('이 사진·영상을 삭제할까요?')) return;
  try {
    const res = await fetch(`/api/visitor-photos/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: storedAdminPassword }),
    });
    if (!res.ok) { toast('삭제 실패', 'error'); return; }
    toast('삭제됐습니다.');
    await loadVisitorPhotos(popupId);
  } catch {
    toast('서버 오류가 발생했습니다.', 'error');
  }
}

function openVisitorLightbox(startIndex) {
  const photos = _visitorPhotos;
  if (!photos.length) return;
  let cur = startIndex;
  const multi = photos.length > 1;

  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay active';
  document.body.appendChild(overlay);

  function render(i) {
    const p = photos[i];
    const media = p.type === 'video'
      ? `<video src="${p.url}" controls autoplay playsinline class="lightbox-media"></video>`
      : `<img src="${p.url}" class="lightbox-media" alt="">`;
    overlay.innerHTML = `
      <button class="lightbox-close">✕</button>
      ${multi ? `<button class="lightbox-prev">&#8249;</button>` : ''}
      ${media}
      ${multi ? `<button class="lightbox-next">&#8250;</button>` : ''}
      ${multi ? `<div class="lightbox-counter">${i + 1} / ${photos.length}</div>` : ''}
    `;
    overlay.querySelector('.lightbox-media').addEventListener('click', e => e.stopPropagation());
    overlay.querySelector('.lightbox-close').addEventListener('click', e => { e.stopPropagation(); overlay.remove(); });
    if (multi) {
      overlay.querySelector('.lightbox-prev').addEventListener('click', e => { e.stopPropagation(); cur = (cur - 1 + photos.length) % photos.length; render(cur); });
      overlay.querySelector('.lightbox-next').addEventListener('click', e => { e.stopPropagation(); cur = (cur + 1) % photos.length; render(cur); });
    }
  }

  overlay.addEventListener('click', () => overlay.remove());
  render(cur);
}

async function loadTips(popupId) {
  const list = document.getElementById('tipsList');
  if (!list) return;
  try {
    const res  = await fetch(`/api/tips/${popupId}`);
    const tips = await res.json();
    if (!Array.isArray(tips) || tips.length === 0) {
      list.innerHTML = '<li class="tips-empty">아직 팁이 없어요. 첫 번째로 남겨보세요!</li>';
      return;
    }
    list.innerHTML = tips.map(t =>
      `<li class="tip-item">
        <span class="tip-bullet">💡</span>
        <span class="tip-text">${esc(t.text)}</span>
        <span class="tip-time">${relativeTime(t.created_at)}</span>
      </li>`
    ).join('');
  } catch {
    list.innerHTML = '<li class="tips-empty">불러오기 실패</li>';
  }
}

async function submitTip(popupId) {
  const input = document.getElementById('tipInput');
  const text  = input.value.trim();
  if (!text) { input.focus(); return; }
  const btn = input.nextElementSibling;
  btn.disabled = true;
  try {
    const res = await fetch(`/api/tips/${popupId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || '등록 실패', 'error'); return; }
    input.value = '';
    await loadTips(popupId);
    toast('팁이 등록되었어요!');
  } catch {
    toast('서버 오류가 발생했습니다.', 'error');
  } finally {
    btn.disabled = false;
  }
}



// ── 모달 ────────────────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.add('active');
  document.getElementById('modalOverlay').classList.add('active');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('active');
  if (!document.querySelector('.modal.active')) {
    document.getElementById('modalOverlay').classList.remove('active');
  }
}
function initModals() {
  const closeAll = () => {
    document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
    document.getElementById('modalOverlay').classList.remove('active');
    if (editingPopupId !== null) resetAddModal();
  };
  document.getElementById('modalOverlay').addEventListener('click', closeAll);
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeModal(btn.dataset.close);
      if (btn.dataset.close === 'addModal' && editingPopupId !== null) resetAddModal();
    });
  });
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('.modal').id;
      closeModal(id);
      if (id === 'addModal' && editingPopupId !== null) resetAddModal();
    });
  });
}

// ── 미디어 업로드 (사진 + 영상) ─────────────────────────────────
function initUpload() {
  const area        = document.getElementById('uploadArea');
  const input       = document.getElementById('mediaInput');
  const placeholder = document.getElementById('uploadPlaceholder');
  const previewWrap = document.getElementById('uploadPreviewWrap');
  const pathInput   = document.getElementById('mediaPathInput');

  area.addEventListener('click', () => input.click());
  area.addEventListener('dragover', e => { e.preventDefault(); area.style.borderColor = 'var(--primary)'; });
  area.addEventListener('dragleave', () => { area.style.borderColor = ''; });
  area.addEventListener('drop', e => {
    e.preventDefault();
    area.style.borderColor = '';
    if (e.dataTransfer.files[0]) handleUpload(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', () => { if (input.files[0]) handleUpload(input.files[0]); });

  async function handleUpload(file) {
    placeholder.innerHTML = '<span>업로드 중... ⏳</span>';
    try {
      const data = await uploadToStorage(file);
      if (!data.url) throw new Error('업로드에 실패했습니다.');

      pathInput.value = data.filename;
      placeholder.style.display = 'none';
      previewWrap.style.display  = 'block';

      if (data.type === 'video') {
        previewWrap.innerHTML = `
          <video src="${data.url}" controls class="upload-preview-media"></video>
          <div class="upload-preview-info">🎬 ${file.name} (${(data.size/1024/1024).toFixed(1)}MB)</div>`;
      } else {
        previewWrap.innerHTML = `
          <img src="${data.url}" class="upload-preview-media" alt="미리보기">
          <div class="upload-preview-info">📷 ${file.name} (${(data.size/1024/1024).toFixed(1)}MB)</div>`;
      }
      toast(`${data.type === 'video' ? '영상' : '사진'}이 업로드되었습니다.`, 'success');
    } catch (e) {
      placeholder.style.display = 'flex';
      placeholder.innerHTML = `<span>📷 클릭하거나 파일을 드래그하여 업로드</span><small>사진: JPG·PNG·GIF·WEBP (10MB) / 영상: MP4·WEBM·MOV·AVI (200MB)</small>`;
      previewWrap.style.display = 'none';
      toast(e.message || '업로드에 실패했습니다.', 'error');
    }
  }
}

// ── 팝업 추가 / 수정 폼 ──────────────────────────────────────────
const UPLOAD_PLACEHOLDER_HTML =
  `<span>📷 클릭하거나 파일을 드래그하여 업로드</span><small>사진: JPG·PNG·GIF·WEBP / 영상: MP4·WEBM·MOV·AVI (200MB)</small>`;

// ── 운영시간 다중 행 ─────────────────────────────────────────────
const HOURS_MAX = 6;

function hoursRowHtml(label = '', time = '') {
  return `<div class="hours-row">
    <input type="text" class="hours-label-inp" placeholder="예: 평일" value="${label}">
    <input type="text" class="hours-time-inp" placeholder="10:00 ~ 20:00" value="${time}">
    <button type="button" class="btn-hours-remove" onclick="removeHoursRow(this)">✕</button>
  </div>`;
}

function renderHoursRows(stored) {
  const container = document.getElementById('hoursRows');
  const btn = document.getElementById('addHoursBtn');
  const entries = stored ? stored.split('|').map(s => s.trim()).filter(Boolean) : [];
  if (!entries.length) {
    container.innerHTML = hoursRowHtml();
  } else {
    container.innerHTML = entries.map(entry => {
      const spaceIdx = entry.search(/\d/);
      if (spaceIdx > 0) {
        return hoursRowHtml(entry.slice(0, spaceIdx).trim(), entry.slice(spaceIdx).trim());
      }
      return hoursRowHtml('', entry);
    }).join('');
  }
  btn.style.display = container.children.length >= HOURS_MAX ? 'none' : '';
}

function addHoursRow() {
  const container = document.getElementById('hoursRows');
  if (container.children.length >= HOURS_MAX) return;
  container.insertAdjacentHTML('beforeend', hoursRowHtml());
  document.getElementById('addHoursBtn').style.display =
    container.children.length >= HOURS_MAX ? 'none' : '';
}

function removeHoursRow(btn) {
  const container = document.getElementById('hoursRows');
  btn.closest('.hours-row').remove();
  if (container.children.length === 0) container.insertAdjacentHTML('beforeend', hoursRowHtml());
  document.getElementById('addHoursBtn').style.display =
    container.children.length >= HOURS_MAX ? 'none' : '';
}

function serializeHours() {
  const rows = document.querySelectorAll('#hoursRows .hours-row');
  const parts = [];
  rows.forEach(row => {
    const label = row.querySelector('.hours-label-inp').value.trim();
    const time  = row.querySelector('.hours-time-inp').value.trim();
    if (time) parts.push(label ? `${label} ${time}` : time);
  });
  document.getElementById('openingHoursHidden').value = parts.join('|');
}

function resetAddModal() {
  editingPopupId = null;
  document.querySelector('#addModal .modal-header h2').textContent = '팝업 / 전시 추가';
  document.querySelector('#addModal .btn-primary[type="submit"]').textContent = '등록하기';
  const seasonGroup = document.getElementById('seasonGroup');
  seasonGroup.style.display = '';
  seasonGroup.querySelector('select').required = false;
  document.getElementById('addForm').reset();
  document.getElementById('mediaPathInput').value = '';
  document.getElementById('uploadPreviewWrap').style.display = 'none';
  document.getElementById('uploadPlaceholder').style.display  = 'flex';
  document.getElementById('uploadPlaceholder').innerHTML = UPLOAD_PLACEHOLDER_HTML;
  renderHoursRows('');
}

function openEditModal(popup) {
  editingPopupId = popup.id;
  document.querySelector('#addModal .modal-header h2').textContent = '팝업 수정';
  document.querySelector('#addModal .btn-primary[type="submit"]').textContent = '수정하기';

  const seasonGroup = document.getElementById('seasonGroup');
  seasonGroup.style.display = 'none';
  seasonGroup.querySelector('select').required = false;

  const form = document.getElementById('addForm');
  form.name.value         = popup.name        || '';
  form.description.value  = popup.description || '';
  form.category.value     = popup.category    || '';
  form.season.value       = popup.season      || '';
  form.is_permanent.checked = !!popup.is_permanent;
  togglePermanentFields(!!popup.is_permanent);
  form.start_date.value   = popup.start_date  || '';
  form.end_date.value     = popup.end_date    || '';
  form.address.value      = popup.address     || '';
  form.lat.value          = popup.lat         || '';
  form.lng.value          = popup.lng         || '';
  form.venue.value         = popup.venue          || '';
  form.website_url.value   = popup.website_url   || '';
  renderHoursRows(popup.opening_hours || '');
  form.closed_days.value   = popup.closed_days   || '';
  form.admission_fee.value = popup.admission_fee  || '';
  form.keywords.value        = popup.keywords         || '';
  form.nearby_station.value  = popup.nearby_station   || '';
  form.adminPassword.value = '';

  const media       = popup.media_path || popup.photo_path || null;
  const previewWrap = document.getElementById('uploadPreviewWrap');
  const placeholder = document.getElementById('uploadPlaceholder');
  const pathInput   = document.getElementById('mediaPathInput');

  if (media) {
    pathInput.value          = media;
    placeholder.style.display = 'none';
    previewWrap.style.display  = 'block';
    previewWrap.innerHTML = isVideoFile(media)
      ? `<video src="${mediaUrl(media)}" controls class="upload-preview-media"></video><div class="upload-preview-info">🎬 현재 영상 (새 파일로 교체 가능)</div>`
      : `<img src="${mediaUrl(media)}" class="upload-preview-media" alt="현재 사진"><div class="upload-preview-info">📷 현재 사진 (새 파일로 교체 가능)</div>`;
  } else {
    pathInput.value          = '';
    placeholder.style.display = 'flex';
    previewWrap.style.display  = 'none';
    placeholder.innerHTML = UPLOAD_PLACEHOLDER_HTML;
  }

  if (isAdminMode) form.adminPassword.value = storedAdminPassword;
  openModal('addModal');
}

// 상세 패널 수정 버튼 (onclick)
function startEdit(popupId) {
  const popup = popups.find(p => p.id === popupId);
  if (popup) openEditModal(popup);
}

// 상세 패널 삭제 버튼 (onclick)
async function deletePopup(popupId) {
  const popup = popups.find(p => p.id === popupId);
  if (!popup) return;
  if (!confirm(`"${popup.name}"\n\n정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;

  try {
    const res = await fetch(`/api/popups/${popupId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPassword: storedAdminPassword }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);
    toast('팝업이 삭제되었습니다.', 'success');
    closeDetail();
    await loadPopups(currentSeason);
  } catch (err) {
    toast(err.message || '삭제에 실패했습니다.', 'error');
  }
}

function initGeocodeBtn() {
  document.getElementById('geocodeBtn').addEventListener('click', () => {
    const form    = document.getElementById('addForm');
    const address = form.address.value.trim();
    if (!address) { toast('주소를 먼저 입력해주세요.', 'error'); return; }

    const btn = document.getElementById('geocodeBtn');
    btn.disabled = true;
    btn.textContent = '검색 중…';

    naver.maps.Service.geocode({ query: address }, (status, response) => {
      btn.disabled = false;
      btn.textContent = '📍 좌표 찾기';

      if (status !== naver.maps.Service.Status.OK || response.v2.meta.totalCount === 0) {
        toast('주소를 찾을 수 없습니다. 더 자세히 입력해보세요.', 'error');
        return;
      }
      const item = response.v2.addresses[0];
      form.lat.value = parseFloat(item.y).toFixed(6);
      form.lng.value = parseFloat(item.x).toFixed(6);
      toast('좌표가 자동 입력되었습니다.', 'success');
    });
  });
}

function togglePermanentFields(isPermanent) {
  const form = document.getElementById('addForm');
  const isLibrary = form.category.value === 'library';
  const hideDates = isPermanent || isLibrary;
  document.getElementById('permanentGroup').style.display = isLibrary ? 'none' : '';
  const startGroup = document.getElementById('startDateGroup');
  const endGroup   = document.getElementById('endDateGroup');
  startGroup.style.display = hideDates ? 'none' : '';
  endGroup.style.display   = hideDates ? 'none' : '';
  startGroup.querySelector('input').required = false;
  endGroup.querySelector('input').required   = false;
}

function initAddForm() {
  document.getElementById('isPermanentCheck').addEventListener('change', e => {
    togglePermanentFields(e.target.checked);
  });

  document.getElementById('addForm').category.addEventListener('change', () => {
    const form = document.getElementById('addForm');
    togglePermanentFields(form.is_permanent.checked);
  });

  document.getElementById('addHoursBtn').addEventListener('click', addHoursRow);
  renderHoursRows('');

  document.getElementById('addPopupBtn').addEventListener('click', () => {
    resetAddModal();
    if (isAdminMode) document.getElementById('addForm').adminPassword.value = storedAdminPassword;
    openModal('addModal');
  });

  document.getElementById('addForm').addEventListener('submit', async e => {
    e.preventDefault();
    serializeHours();
    const form = e.target;
    const isPermanent = form.is_permanent.checked;
    const data = {
      name:          form.name.value.trim(),
      description:   form.description.value.trim() || null,
      lat:           parseFloat(form.lat.value),
      lng:           parseFloat(form.lng.value),
      venue:         form.venue.value.trim()   || null,
      address:       form.address.value.trim(),
      is_permanent:  isPermanent ? 1 : 0,
      start_date:    isPermanent ? null : form.start_date.value,
      end_date:      isPermanent ? null : form.end_date.value,
      season:        form.season.value,
      category:      form.category.value,
      media_path:    form.media_path.value || null,
      website_url:   form.website_url.value.trim()   || null,
      opening_hours: form.opening_hours.value.trim() || null,
      closed_days:   form.closed_days.value.trim()   || null,
      admission_fee:   form.admission_fee.value.trim()   || null,
      keywords:        form.keywords.value.trim()        || null,
      nearby_station:  form.nearby_station.value.trim()  || null,
      adminPassword: form.adminPassword.value,
    };

    const isEditing = editingPopupId !== null;
    try {
      const res = await fetch(
        isEditing ? `/api/popups/${editingPopupId}` : '/api/popups',
        {
          method: isEditing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }
      );
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);

      toast(isEditing ? '팝업이 수정되었습니다!' : '팝업이 등록되었습니다!', 'success');
      closeModal('addModal');
      resetAddModal();
      await loadPopups(currentSeason);
      // 수정 후 상세 패널 갱신
      if (isEditing) {
        const updated = popups.find(p => p.id === editingPopupId);
        if (updated) showDetail(updated);
      }
    } catch (err) {
      toast(err.message || (isEditing ? '수정에 실패했습니다.' : '등록에 실패했습니다.'), 'error');
    }
  });
}

// ── 관리자 인증 / 모드 토글 ──────────────────────────────────────
function openAdminLogin() {
  document.getElementById('adminPasswordInput').value = '';
  document.getElementById('adminError').style.display = 'none';
  openModal('adminModal');
}

function initAdmin() {
  document.getElementById('adminBtn').style.display = 'none';

  document.getElementById('adminBtn').addEventListener('click', () => {
    if (isAdminMode) {
      setAdminMode(false);
      toast('관리자 모드가 종료되었습니다.', 'info');
    } else {
      openAdminLogin();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.altKey && e.code === 'KeyA') {
      e.preventDefault();
      if (isAdminMode) {
        setAdminMode(false);
        toast('관리자 모드가 종료되었습니다.', 'info');
      } else {
        openAdminLogin();
      }
    }
  });

  document.getElementById('adminForm').addEventListener('submit', async e => {
    e.preventDefault();
    const pw    = document.getElementById('adminPasswordInput').value;
    const errEl = document.getElementById('adminError');
    errEl.style.display = 'none';
    try {
      const res  = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      const data = await res.json();
      if (!res.ok) { errEl.textContent = data.error; errEl.style.display = 'block'; return; }
      setAdminMode(true, pw);
      toast('관리자 모드가 활성화되었습니다.', 'success');
      closeModal('adminModal');
    } catch {
      toast('인증에 실패했습니다.', 'error');
    }
  });
}

// ── 딥링크 처리 (?popup=ID) ──────────────────────────────────────
function handleDeepLink() {
  const id = new URLSearchParams(location.search).get('popup');
  if (!id) return;
  const target = popups.find(p => p.id === id);
  if (!target) return;
  if (map) map.panTo(new naver.maps.LatLng(target.lat, target.lng));
  showDetail(target);
}

// ── 앱 초기화 ────────────────────────────────────────────────────
async function initApp() {
  const season = getCurrentSeason();
  applySeasonTheme(season);
  document.getElementById('addPopupBtn').style.display = 'none';
  initMap();
  initModals();
  initUpload();
  initAddForm();
  initGeocodeBtn();
  initAdmin();
  initFavorites();
  initFilters();
  initVibeChips();
  await loadPopups('all');
  handleDeepLink();
}

// ── 네이버 지도 동적 로드 ────────────────────────────────────────
(async () => {
  try {
    const res    = await fetch('/api/config');
    const config = await res.json();

    if (!config.naverMapClientId) {
      document.getElementById('map').innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:16px;background:#f5f5f5">' +
        '<div style="font-size:48px">🗺️</div>' +
        '<p style="font-size:14px;color:#666;text-align:center">.env 파일의 <strong>NAVER_MAP_CLIENT_ID</strong>를 설정해주세요.</p>' +
        '</div>';
      await initAppWithoutMap();
      return;
    }

    if (config.kakaoJsKey && window.Kakao && !Kakao.isInitialized()) {
      Kakao.init(config.kakaoJsKey);
    }

    const script   = document.createElement('script');
    script.src     = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${config.naverMapClientId}`;
    script.onload  = () => initApp();
    script.onerror = () => { toast('네이버 지도 로드 실패. API 키를 확인해주세요.', 'error'); initAppWithoutMap(); };
    document.head.appendChild(script);
  } catch {
    toast('서버에 연결할 수 없습니다.', 'error');
  }
})();

async function initAppWithoutMap() {
  const season = getCurrentSeason();
  applySeasonTheme(season);
  document.getElementById('addPopupBtn').style.display = 'none';
  initModals();
  initUpload();
  initAddForm();
  initGeocodeBtn();
  initAdmin();
  initFavorites();
  initFilters();
  initVibeChips();
  await loadPopups('all');
  handleDeepLink();
}
