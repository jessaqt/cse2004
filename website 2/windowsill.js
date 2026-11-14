(() => {
'use strict';

/* ---------- helpers & state ---------- */
const KEY = 'windowsill:v1';
const RAD = Math.PI / 180;
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const showMsg = (el, text, err) => { el.className = err ? 'msg err' : 'msg'; el.textContent = text; };
async function getJson(url, failMsg) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(failMsg);
  return r.json();
}
const linkBtn = (act, id, label) => '<button class="linkbtn" type="button" data-act="' + act + '" data-id="' + id + '">' + label + '</button>';

const defaults = () => ({
  loc: null,
  units: (navigator.language || '').toLowerCase() === 'en-us' ? 'F' : 'C',
  facing: null,
  plants: [],
});
function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) return { ...defaults(), ...JSON.parse(raw) }; } catch (e) {}
  return defaults();
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
let S = load();

const FACINGS = ['north','northeast','east','southeast','south','southwest','west','northwest'];
const LIGHT = [['low','Low light'],['medium','Medium'],['bright','Bright']];
const SPOT = [['sill','On the sill'],['near','Back from glass'],['far','Across the room']];
const SPOT_F = { sill: 1, near: 0.5, far: 0.15 };
const LEVEL = { low: 0, medium: 1, bright: 2 };
const LUX_PER_WM2 = 110;              // rough daylight conversion: W/m² of sunlight to lux
const PB = 'https://open.plantbook.io/api/v1';
const DEFAULT_PLANTBOOK_KEY = '14c50159383ccd1656b809ef7175e377ffd2e353';

const facing = () => S.facing ?? ((S.loc && S.loc.lat < 0) ? 0 : 4);
const lightCat = kwh => kwh < 0.5 ? 'low' : kwh < 1.5 ? 'medium' : 'bright';
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const toF = c => c * 9 / 5 + 32;
const fmtTemp = c => c == null ? '–' : Math.round(S.units === 'F' ? toF(c) : c) + '°';
function fmtClock(min) {
  const h = Math.floor(min / 60) % 24, m = Math.round(min % 60);
  if (S.units === 'F') return ((h + 11) % 12 + 1) + (m ? ':' + String(m).padStart(2, '0') : '') + (h < 12 ? ' am' : ' pm');
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
const addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const diffDays = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);
const dayName = d => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
const deviceToday = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const todayStr = () => W ? W.today : deviceToday();
const plantDefaults = () => ({ light: 'medium', thirst: 'moderate', spot: 'sill', lastWatered: todayStr() });
const azDeg = () => facing() * 45;
const lightLabel = cat => (LIGHT.find(([k]) => k === cat) || [cat, cap(cat) + ' light'])[1];
const FAVOURITE_PLANTS = ['Monstera', 'Pothos', 'Snake plant', 'Peace lily', 'Fiddle leaf fig'];
const EMPTY_PLANTS_HTML = '<div class="empty"><svg viewBox="0 0 64 70" aria-hidden="true"><path d="M32 66 C31 52 33 44 32 34" fill="none" stroke="#2B1E22" stroke-width="2" stroke-linecap="round"/><path d="M32 40 C16 40 8 28 8 16 C24 16 32 26 32 40Z" fill="#C6E04A" stroke="#2B1E22" stroke-width="2" stroke-linejoin="round"/><path d="M32 34 C32 20 42 10 58 10 C58 24 48 34 32 34Z" fill="#FFFEF6" stroke="#2B1E22" stroke-width="2" stroke-linejoin="round"/></svg><b>nothing growing yet</b><p>Search above, or start with a favourite.</p><div class="quick quick-center">' +
  FAVOURITE_PLANTS.map(n => '<button type="button" class="btn ghost" data-quick="' + n + '">' + n.toLowerCase() + '</button>').join('') + '</div></div>';

/* ---------- Solar geometry ---------- */
function sunPos(utcMs, lat, lon) {
  const d = new Date(utcMs);
  const n = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5;
  const decl = 23.45 * RAD * Math.sin(2 * Math.PI * (284 + n) / 365);
  const B = 2 * Math.PI * (n - 81) / 364;
  const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  const utcH = d.getUTCHours() + d.getUTCMinutes() / 60;
  const H = ((utcH + lon / 15 + eot / 60) - 12) * 15 * RAD;
  const phi = lat * RAD;
  const sinE = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
  const elev = Math.asin(clamp(sinE, -1, 1));
  let cosA = (Math.sin(decl) - sinE * Math.sin(phi)) / (Math.cos(elev) * Math.cos(phi) || 1e-9);
  let az = Math.acos(clamp(cosA, -1, 1)) / RAD;
  if (H > 0) az = 360 - az;
  return { elev, az };
}

/* ---------- Open-Meteo (data API) ---------- */
let W = null, weatherState = 'idle', weatherError = '', locEditing = false;
const showWeather = () => Boolean(W && S.loc && !locEditing);
const todayWin = () => (showWeather() ? dayStats(azDeg())[W.today] : null);
const mins = s => { if (!s) return null; const [h, m] = s.split('T')[1].split(':').map(Number); return h * 60 + m; };

function parseWeather(j) {
  const off = j.utc_offset_seconds || 0;
  const hours = j.hourly.time.map((t, i) => {
    const [d, hm] = t.split('T');
    const [y, mo, da] = d.split('-').map(Number);
    const [h, mi] = hm.split(':').map(Number);
    return {
      date: d, hour: h + mi / 60,
      utc: Date.UTC(y, mo - 1, da, h, mi) - off * 1000,
      ghi: j.hourly.shortwave_radiation[i] ?? 0,
      dni: j.hourly.direct_normal_irradiance[i] ?? 0,
      dif: j.hourly.diffuse_radiation[i] ?? 0
    };
  });
  const days = j.daily.time.map((d, i) => ({
    date: d,
    tmax: j.daily.temperature_2m_max[i], tmin: j.daily.temperature_2m_min[i],
    et0: j.daily.et0_fao_evapotranspiration[i],
    rise: mins(j.daily.sunrise[i]), set: mins(j.daily.sunset[i])
  }));
  const today = new Date(Date.now() + off * 1000).toISOString().slice(0, 10);
  return { off, hours, days, today, fetched: Date.now(), tz: j.timezone, lat: j.latitude, lon: j.longitude,
           et0: Object.fromEntries(days.map(d => [d.date, d.et0])) };
}

async function loadWeather() {
  if (!S.loc) return;
  weatherState = 'loading'; renderAll();
  const { lat, lon } = S.loc;
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
    '&hourly=shortwave_radiation,direct_normal_irradiance,diffuse_radiation' +
    '&daily=temperature_2m_max,temperature_2m_min,et0_fao_evapotranspiration,sunrise,sunset' +
    '&timezone=auto&past_days=14&forecast_days=6';
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('The weather service answered with status ' + r.status + '.');
    W = parseWeather(await r.json());
    weatherState = 'ok';
  } catch (e) {
    weatherState = 'error';
    weatherError = e.message || 'Could not reach the weather service.';
  }
  renderAll();
}

/* Light reaching a vertical window: half the sky's diffuse light plus direct sun scaled by the angle to the glass, minus glass loss. */
function winLight(h, az) {
  const sp = sunPos(h.utc - 1800000, W.lat, W.lon);
  let direct = 0;
  if (sp.elev > 0) direct = h.dni * Math.max(0, Math.cos(sp.elev) * Math.cos((sp.az - az) * RAD));
  return (0.5 * h.dif + direct) * 0.7;
}
function dayStats(az) {
  const out = {};
  for (const h of W.hours) {
    const o = out[h.date] || (out[h.date] = { kwh: 0, ghi: 0, pts: [] });
    const v = winLight(h, az);
    o.kwh += v / 1000; o.ghi += h.ghi / 1000;
    o.pts.push({ x: h.hour - 0.5, win: v, ghi: h.ghi });
  }
  return out;
}

/* ---------- Geocoding (data API) + Geolocation (browser API) ---------- */
async function searchCities(q) {
  return (await getJson('https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name=' + encodeURIComponent(q), 'City search failed.')).results || [];
}
function cityLabel(c) {
  return [c.name, c.admin1, c.country].filter(Boolean).join(', ');
}
const BAD_PLACE = /^(township|civil township|charter township|township of)\b/i;
const isBadPlaceName = n => !n || BAD_PLACE.test(n) || /\btownship\b/i.test(n);
function distKm(lat1, lon1, lat2, lon2) {
  const p = RAD, h = 0.5 - Math.cos((lat2 - lat1) * p) / 2 +
    Math.cos(lat1 * p) * Math.cos(lat2 * p) * (1 - Math.cos((lon2 - lon1) * p)) / 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}
function pickNominatimCity(address) {
  if (!address) return null;
  const keys = ['city', 'town', 'village', 'municipality', 'hamlet', 'suburb', 'neighbourhood'];
  for (const k of keys) {
    if (address[k] && !isBadPlaceName(address[k])) return address[k];
  }
  return null;
}
async function nominatimReverse(lat, lon) {
  const url = 'https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&accept-language=en&lat=' +
    lat + '&lon=' + lon + '&zoom=14';
  return pickNominatimCity((await getJson(url, 'City lookup failed.')).address);
}
/** Snap a free-text place name to the nearest Open-Meteo city when within ~80 km. */
async function snapToSearchCity(lat, lon, hint) {
  if (!hint) return null;
  try {
    const q = hint.split(',')[0].trim();
    if (q.length < 2) return hint;
    const res = await searchCities(q);
    if (!res.length) return hint;
    let best = res[0], bestD = Infinity;
    for (const c of res) {
      const d = distKm(lat, lon, c.latitude, c.longitude);
      if (d < bestD) { bestD = d; best = c; }
    }
    return bestD < 80 ? best.name : hint;
  } catch (e) {
    return hint;
  }
}
async function reverseGeocode(lat, lon) {
  const n = await nominatimReverse(lat, lon);
  return n ? snapToSearchCity(lat, lon, n) : null;
}
function setLocation(loc) {
  S.loc = loc; save();
  W = null; locEditing = false;
  loadWeather();
  renderHeader();
}
function useGeolocation() {
  const msg = $('#whereMsg');
  if (!('geolocation' in navigator)) { showMsg(msg, 'This browser has no location support. Search for a city instead.', true); return; }
  showMsg(msg, 'Waiting for your browser to share your location…');
  navigator.geolocation.getCurrentPosition(async pos => {
    const lat = +pos.coords.latitude.toFixed(5), lon = +pos.coords.longitude.toFixed(5);
    showMsg(msg, 'Looking up your city…');
    let name = null;
    try { name = await reverseGeocode(lat, lon); } catch (e) { /* keep coords even if lookup fails */ }
    setLocation({ lat, lon, name: name || 'Your location' });
    if (!name) showMsg(msg, 'Got coordinates but not a city name — search for your city instead.', true);
    else if (pos.coords.accuracy > 8000) {
      showMsg(msg, 'Your browser only gave an approximate location (~' + Math.round(pos.coords.accuracy / 1000) + ' km). Search for your city if the name looks wrong.');
    } else showMsg(msg, '');
  }, err => {
    showMsg(msg, err.code === 1
      ? 'Location access was blocked. Allow it in your browser settings, or search for a city instead.'
      : 'Could not work out where you are. Search for a city instead.', true);
  }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
}

/* ---------- Wikipedia (about blurbs only) ---------- */
const wikiCache = new Map();
async function wikiSummary(p) {
  if (wikiCache.has(p.id)) return wikiCache.get(p.id);
  const titles = [p.common, p.sci].filter((t, i, a) => t && a.indexOf(t) === i);
  let found = null;
  for (const t of titles) {
    try {
      const r = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(t.replace(/ /g, '_')) + '?redirect=true');
      if (!r.ok) continue;
      const j = await r.json();
      if (j.type === 'disambiguation' || !j.extract) continue;
      found = { extract: j.extract, url: j.content_urls && j.content_urls.desktop && j.content_urls.desktop.page, thumb: j.thumbnail && j.thumbnail.source };
      break;
    } catch (e) { /* try next title */ }
  }
  wikiCache.set(p.id, found);
  return found;
}

/* ---------- OpenPlantbook (plant search, photos, care) ---------- */
const PB_IMG = 'https://opb-img.plantbook.io/';
function pbThumb(r) {
  const pid = (r.pid || '').trim().toLowerCase();
  return pid ? PB_IMG + encodeURIComponent(pid) + '.jpg' : '';
}
const getKey = () => S.pbKey || DEFAULT_PLANTBOOK_KEY;
const num = v => v != null && v !== '' && isFinite(+v);
const hasLux = p => !!(p.limits && num(p.limits.minLux) && num(p.limits.maxLux));
let pbScheme = 'Token';
const explain = e => (e && e.name === 'TypeError')
  ? 'Couldn’t reach OpenPlantbook. If you’re viewing this inside Claude’s preview, open the file in a normal browser tab. Otherwise check your connection.'
  : (e && e.message) || 'Something went wrong.';

async function pbFetch(path) {
  const key = getKey();
  if (!key) throw new Error('No OpenPlantbook key saved.');
  let lastErr = null;
  for (const scheme of [pbScheme, pbScheme === 'Token' ? 'Bearer' : 'Token']) {
    const r = await fetch(PB + path, { headers: { Authorization: scheme + ' ' + key } });
    if (r.status === 401 || r.status === 403) { lastErr = new Error('OpenPlantbook rejected the key (status ' + r.status + ').'); continue; }
    if (!r.ok) throw new Error(r.status === 404 ? 'Not found in OpenPlantbook.' : 'OpenPlantbook error ' + r.status + (r.status === 429 ? ' (rate limit, try again in a bit).' : '.'));
    pbScheme = scheme;
    return r.json();
  }
  throw lastErr;
}
async function searchPb(q) {
  const j = await pbFetch('/plant/search?limit=10&alias=' + encodeURIComponent(q));
  const arr = Array.isArray(j) ? j : (j.results || []);
  return arr.filter(r => r && r.pid).map(r => ({ pid: r.pid, name: r.display_pid || r.pid, common: r.alias || '' }));
}
function normCare(c) {
  if (!c || typeof c !== 'object') return null;
  const out = {};
  for (const k of ['sunlight', 'watering', 'fertilization', 'pruning', 'soil']) {
    let v = c[k];
    if (v && typeof v === 'object') v = v.text || v.description || v.summary || '';
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return Object.keys(out).length ? out : null;
}
async function loadCare(p) {
  p.pbError = '';
  try {
    const j = await pbFetch('/plant/detail/' + encodeURIComponent(p.pid) + '/?include=care');
    const n = v => num(v) ? +v : null;
    p.limits = { minLux: n(j.min_light_lux), maxLux: n(j.max_light_lux), minMoist: n(j.min_soil_moist), maxMoist: n(j.max_soil_moist),
                 minTemp: n(j.min_temp), maxTemp: n(j.max_temp), minHumid: n(j.min_env_humid), maxHumid: n(j.max_env_humid) };
    p.care = normCare(j.care);
    if (j.image_url) p.photo = j.image_url;
  } catch (e) { p.pbError = explain(e); }
  save(); renderAll();
}
function addPb(r) {
  const p = { id: Date.now(), source: 'plantbook', pid: r.pid, sci: r.name, common: cap(r.common || r.name), photo: pbThumb(r),
              ...plantDefaults(), limits: null, care: null, pbError: '' };
  S.plants.unshift(p); save(); renderAll(); loadCare(p);
}
async function lookupCare(p) {
  p.pbNote = 'Looking it up…'; renderPlants();
  try {
    let res = await searchPb(p.sci);
    if (!res.length && p.common) res = await searchPb(p.common);
    if (!res.length) { p.pbNote = 'Not in OpenPlantbook, so these stay guesses.'; save(); renderPlants(); return; }
    p.source = 'plantbook'; p.pid = res[0].pid; p.pbNote = ''; save(); renderAll();
    await loadCare(p);
  } catch (e) { p.pbNote = explain(e); save(); renderPlants(); }
}

/* ---------- Verdicts ---------- */
function verdict(p, kwh) {
  const k = kwh * SPOT_F[p.spot];
  const have = LEVEL[lightCat(k)], need = LEVEL[p.light];
  if (have === need) return { cls: '', text: 'Right amount of light today.' };
  if (have < need) return { cls: 'dim', text: p.spot === 'sill' ? 'Dimmer than it likes. Your window is the brightest spot you have.' : 'Dimmer than it likes. Move it closer to the glass.' };
  return { cls: 'hot', text: need === 0 ? 'Strong for a shade lover. Step it back from the glass.' : 'More light than it needs. Fine if the leaves look happy; step back if they crisp.' };
}

function verdictLux(p, pts) {
  const L = p.limits, f = SPOT_F[p.spot];
  let peak = 0, hin = 0, hhi = 0;
  for (const pt of pts) {
    if (pt.ghi < 20) continue;                       // sun is down
    const lux = pt.win * LUX_PER_WM2 * f;
    peak = Math.max(peak, lux);
    if (lux > L.maxLux) hhi++; else if (lux >= L.minLux) hin++;
  }
  const fmt = x => (Math.round(x / 100) * 100).toLocaleString();
  const range = Number(L.minLux).toLocaleString() + ' to ' + Number(L.maxLux).toLocaleString() + ' lux';
  if (peak < L.minLux) return { cls: 'dim', text: 'Too dim today. Its spot peaks around ' + fmt(peak) + ' lux and it wants ' + range + '.' + (p.spot === 'sill' ? '' : ' Move it closer to the glass.') };
  if (hhi >= 3 && hhi > hin) return { cls: 'hot', text: 'Too bright. Its spot is above ' + Number(L.maxLux).toLocaleString() + ' lux for about ' + hhi + ' hours today (peak ' + fmt(peak) + '). ' + (p.spot === 'far' ? 'Try a spot out of direct sun.' : 'Step it back from the glass.') };
  if (hin >= 2) return { cls: '', text: 'Good light. About ' + hin + ' hours today inside its ' + range + ' range' + (hhi >= 2 ? ', with some harsh hours around midday.' : '.') };
  return { cls: 'dim', text: 'Reaches its range for only about ' + hin + ' hours today (peak ' + fmt(peak) + ' lux, it wants ' + range + '). Try a brighter spot.' };
}

/* ---------- Rendering ---------- */
const smooth = (pts, base) => {
  let d = 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, Math.min(base, p1[1] + (p2[1] - p0[1]) / 6)];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, Math.min(base, p2[1] - (p3[1] - p1[1]) / 6)];
    d += 'C' + c1.map(n => n.toFixed(1)) + ',' + c2.map(n => n.toFixed(1)) + ',' + p2.map(n => n.toFixed(1));
  }
  return d;
};

function renderHeader() {
  const lb = $('#locBtn');
  const locName = S.loc ? (S.loc.name || 'location') : null;
  lb.textContent = locName || 'set location';
  lb.title = S.loc ? (locEditing ? 'Finish or cancel location change' : 'Change your location') : 'Set your window location';
  lb.setAttribute('aria-label', locName
    ? (locEditing ? 'Finish changing location (' + locName + ')' : 'Change location (' + locName + ')')
    : 'Set your window location');
  lb.classList.toggle('on', Boolean(S.loc && !locEditing));
  lb.setAttribute('aria-pressed', locEditing ? 'true' : 'false');
  const ub = $('#unitBtn');
  ub.textContent = '°' + S.units;
  ub.setAttribute('aria-label', 'Switch to degrees ' + (S.units === 'F' ? 'Celsius' : 'Fahrenheit'));
}

function renderHero() {
  const hero = $('#hero'), info = $('#heroInfo'), glass = $('#glass');
  if (!S.loc || locEditing) { hero.hidden = true; return; }
  hero.hidden = false;
  if (weatherState === 'loading' && !W) { info.innerHTML = '<p class="loading">Reading the sky…</p>'; glass.innerHTML = ''; return; }
  if (weatherState === 'error' && !W) {
    info.innerHTML = '<h2>Couldn’t load the weather</h2><p>' + esc(weatherError) + '</p><p><button class="btn" id="retry" type="button">Try again</button></p>';
    glass.innerHTML = ''; return;
  }
  if (!W) return;
  const stats = dayStats(azDeg()), t = stats[W.today];
  if (!t) return;
  const cat = lightCat(t.kwh), pct = t.ghi > 0.05 ? Math.round(100 * t.kwh / t.ghi) : 0;

  // compass flower
  let petals = '';
  for (let i = 0; i < 8; i++) {
    const sel = i === facing();
    petals += '<g data-dir="' + i + '" class="petal' + (sel ? ' sel' : '') + '" tabindex="0" role="button" aria-label="Window faces ' + FACINGS[i] + '" aria-pressed="' + sel + '"><ellipse cx="70" cy="40" rx="13" ry="21" transform="rotate(' + (i * 45) + ' 70 70)"/></g>';
  }
  const compass = '<svg viewBox="0 0 140 140" aria-label="Pick the direction your window faces">' + petals +
    '<circle cx="70" cy="70" r="16" fill="#FFFEF6" stroke="#2B1E22" stroke-width="1.7"/><circle cx="64" cy="66" r="1.9" fill="#2B1E22"/><circle cx="76" cy="66" r="1.9" fill="#2B1E22"/><path d="M62 73 Q70 82 78 73" fill="none" stroke="#2B1E22" stroke-width="1.7" stroke-linecap="round"/>' +
    '<text x="70" y="11" text-anchor="middle">N</text><text x="131" y="74" text-anchor="middle">E</text><text x="70" y="137" text-anchor="middle">S</text><text x="9" y="74" text-anchor="middle">W</text></svg>';

  info.innerHTML =
    '<h2>' + cap(FACINGS[facing()]) + '-facing window</h2>' +
    '<div class="big">' + t.kwh.toFixed(1) + ' <small>sun-hours today</small></div>' +
    '<span class="tag ' + cat + '">' + lightLabel(cat) + '</span>' +
    '<p>' + (pct ? 'Open sky delivers ' + t.ghi.toFixed(1) + ' sun-hours today. Your glass catches about ' + pct + '% of that.' : 'Very little sun today.') + '</p>' +
    '<div class="compass">' + compass +
    '<p class="lab" id="compassLab">Tap the petal your window faces.</p></div>';

  // chart
  const day = W.days.find(d => d.date === W.today) || W.days[0];
  const x0 = Math.floor(((day.rise ?? 360) / 60)) - 1, x1 = Math.ceil(((day.set ?? 1080) / 60)) + 1;
  const VW = 640, VH = 252, L = 16, R = 16, T = 28, B = 50;
  const span = x1 - x0 || 1;
  const px = x => L + (x - x0) / span * (VW - L - R);
  const ymax = Math.max(250, ...t.pts.map(p => Math.max(p.win, p.ghi))) * 1.12;
  const py = v => VH - B - (v / ymax) * (VH - T - B);
  const base = VH - B;
  const hourY = base + 16;
  const pts = t.pts.filter(p => p.x >= x0 && p.x <= x1);
  let svg = '<svg viewBox="0 0 ' + VW + ' ' + VH + '" role="img" aria-label="Chart of sunlight through your window across today">';
  const step = (x1 - x0) > 12 ? 3 : 2;
  for (let h = Math.ceil(x0 / step) * step; h <= x1; h += step) {
    if (h < x0 || h > x1) continue;
    svg += '<line x1="' + px(h) + '" x2="' + px(h) + '" y1="' + T + '" y2="' + base + '" stroke="#2B1E22" stroke-opacity=".12"/>' +
           '<text x="' + px(h) + '" y="' + hourY + '" text-anchor="middle" font-size="11" fill="#6A5A5E" font-family="Syne, sans-serif">' + fmtClock(h * 60) + '</text>';
  }
  svg += '<line x1="' + L + '" x2="' + (VW - R) + '" y1="' + base + '" y2="' + base + '" stroke="#2B1E22" stroke-width="1.5"/>';
  if (pts.length > 2) {
    const gp = pts.map(p => [px(p.x), py(p.ghi)]), wp = pts.map(p => [px(p.x), py(p.win)]);
    svg += '<path d="' + smooth(gp, base) + '" fill="none" stroke="#2B1E22" stroke-width="3" stroke-dasharray="0.5 7" stroke-linecap="round"/>';
    const wl = smooth(wp, base);
    svg += '<path d="' + wl + 'L' + wp[wp.length - 1][0].toFixed(1) + ',' + base + 'L' + wp[0][0].toFixed(1) + ',' + base + 'Z" fill="#C6E04A"/>';
    svg += '<path d="' + wl + '" fill="none" stroke="#2B1E22" stroke-width="2.4" stroke-linejoin="round"/>';
    const peak = pts.reduce((a, p) => p.win > a.win ? p : a, pts[0]);
    if (peak.win > 20) {
      const peakY = py(peak.win);
      const labelY = peakY > T + 36 ? Math.max(T + 14, peakY - 8) : peakY + 18;
      const anchor = peak.x > x0 + span * 0.65 ? 'end' : peak.x < x0 + span * 0.35 ? 'start' : 'middle';
      const labelX = anchor === 'end' ? px(peak.x) - 4 : anchor === 'start' ? px(peak.x) + 4 : px(peak.x);
      svg += '<text x="' + labelX + '" y="' + labelY + '" text-anchor="' + anchor + '" font-size="10" font-weight="600" fill="#2B1E22" font-family="Syne, sans-serif">Peak ' + Math.round(peak.win) + ' W/m²</text>';
    }
    const nowH = ((Date.now() + W.off * 1000) % 864e5) / 36e5;
    if (nowH >= pts[0].x && nowH <= pts[pts.length - 1].x) {
      let a = pts[0], b = pts[pts.length - 1];
      for (let i = 0; i < pts.length - 1; i++) if (nowH >= pts[i].x && nowH <= pts[i + 1].x) { a = pts[i]; b = pts[i + 1]; break; }
      const f = (nowH - a.x) / ((b.x - a.x) || 1), v = a.win + (b.win - a.win) * f;
      svg += '<line x1="' + px(nowH) + '" x2="' + px(nowH) + '" y1="' + T + '" y2="' + base + '" stroke="#2B1E22" stroke-width="1.5" stroke-dasharray="4 3"/>' +
             '<circle cx="' + px(nowH) + '" cy="' + py(v) + '" r="6" fill="#fff" stroke="#2B1E22" stroke-width="2.5"/>' +
             '<text x="' + px(nowH) + '" y="' + (T + 12) + '" text-anchor="middle" font-size="11" font-weight="600" fill="#2B1E22" font-family="Syne, sans-serif">now</text>';
    }
  }
  glass.innerHTML = svg + '</svg>';
}

function renderWeek() {
  const sec = $('#weekSec');
  if (!showWeather()) { sec.hidden = true; return; }
  sec.hidden = false;
  const stats = dayStats(azDeg());
  const upcoming = W.days.filter(d => d.date >= W.today).slice(0, 5);
  $('#week').innerHTML = upcoming.map(d => {
    const k = stats[d.date] ? stats[d.date].kwh : 0, cat = lightCat(k);
    return '<div class="day"><b>' + (d.date === W.today ? 'Today' : dayName(d.date)) + '</b>' +
      '<div class="bar" aria-hidden="true"><span class="' + cat + '" style="--bar-h:' + clamp(k / 3 * 100, 6, 100) + '%"></span></div>' +
      '<b>' + k.toFixed(1) + ' sun-hrs</b><small>' + cap(cat) + ' light</small>' +
      '<small>' + fmtTemp(d.tmax) + ' / ' + fmtTemp(d.tmin) + '</small></div>';
  }).join('');
}

function renderAlerts() {
  const box = $('#alerts'), items = [];
  if (showWeather()) {
    const nights = W.days.filter(d => d.date >= W.today).slice(0, 2);
    const cold = nights.reduce((a, d) => (a == null || d.tmin < a.tmin) ? d : a, null);
    if (cold && cold.tmin <= 8 && S.plants.length) {
      items.push('<div class="alert warn"><b>' + (cold.tmin <= 1 ? 'Frost risk' : 'Chilly night ahead') + '.</b> Low of ' + fmtTemp(cold.tmin) + ' ' + (cold.date === W.today ? 'tonight' : 'tomorrow') + '. Pull tender plants back from the glass.</div>');
    }
  }
  box.innerHTML = items.join('');
}

function renderPlants() {
  const list = $('#plantList');
  if (!S.plants.length) { list.innerHTML = EMPTY_PLANTS_HTML; return; }
  const todayStats = todayWin();
  const seg = (p, key, opts, label) => '<div class="ctrl"><span>' + label + '</span><div class="seg" role="group" aria-label="' + label + ' for ' + esc(p.common) + '">' +
    opts.map(([v, l]) => '<button type="button" data-act="set" data-id="' + p.id + '" data-key="' + key + '" data-val="' + v + '" aria-pressed="' + (p[key] === v) + '">' + l + '</button>').join('') + '</div></div>';
  const openIds = new Set([...list.querySelectorAll('details[open]')].map(d => d.dataset.id));
  list.innerHTML = S.plants.map(p => {
    const lux = hasLux(p), L = p.limits || {};
    const pending = p.source === 'plantbook' && !p.limits && !p.pbError;
    let v = null;
    if (todayStats && !pending) v = lux ? verdictLux(p, todayStats.pts) : verdict(p, todayStats.kwh);
    const nf = n => Number(n).toLocaleString();
    const needs = [];
    if (lux) needs.push(['Light it wants', nf(L.minLux) + ' to ' + nf(L.maxLux) + ' lux']);
    if (num(L.minTemp) && num(L.maxTemp)) needs.push(['Temperature', fmtTemp(L.minTemp) + ' to ' + fmtTemp(L.maxTemp)]);
    const needsHtml = needs.length ? '<div class="needs">' + needs.map(([k, val]) => '<div><span>' + k + '</span><b>' + val + '</b></div>').join('') + '</div>' : '';
    let status = '';
    if (p.source === 'plantbook' && !p.limits) {
      status = p.pbError
        ? '<p class="note err">Couldn’t load care data: ' + esc(p.pbError) + ' ' + linkBtn('reload', p.id, 'Try again') + '</p>'
        : '<p class="note">Loading care data…</p>';
    } else if (p.pid && !p.limits) {
      if (p.pbNote === 'Looking it up…') status = '<p class="note">Looking up care data in OpenPlantbook…</p>';
      else if (p.pbNote) status = '<p class="note">' + esc(p.pbNote) + ' ' + linkBtn('lookup', p.id, 'Search again') + '</p>';
      else if (getKey()) status = '<p class="note">' + linkBtn('lookup', p.id, 'Load care data from OpenPlantbook') + '</p>';
    }
    const ctrls = (lux || pending ? '' : seg(p, 'light', LIGHT, 'Light it likes')) + seg(p, 'spot', SPOT, 'Where it sits');
    return '<article class="plant" data-id="' + p.id + '">' +
      (p.photo ? '<img class="photo" src="' + esc(p.photo) + '" alt="Photo of ' + esc(p.common) + '" loading="lazy">' : '<div class="photo" role="img" aria-label="No photo for ' + esc(p.common) + '"></div>') +
      '<div><header><div><h3>' + esc(p.common) + '</h3><div class="sci">' + esc(p.sci) + '</div></div>' +
      '<button class="x" type="button" data-act="remove" data-id="' + p.id + '" aria-label="Remove ' + esc(p.common) + '">×</button></header>' +
      needsHtml + status +
      '<div class="ctrls">' + ctrls + '</div>' +
      (v ? '<div class="verdict"><span class="dot ' + v.cls + '"></span><span>' + v.text + '</span></div>' : (!showWeather() ? '<p class="note">Set a location to get light estimates for this plant.</p>' : '')) +
      '<details data-id="' + p.id + '"' + (openIds.has(String(p.id)) ? ' open' : '') + '><summary>About this plant</summary><div class="about" id="about-' + p.id + '"></div></details>' +
      '</div></article>';
  }).join('');
  list.querySelectorAll('details[open]').forEach(d => fillAbout(+d.dataset.id));
}
async function fillAbout(id) {
  const p = S.plants.find(x => x.id === id), el = $('#about-' + id);
  if (!p || !el) return;
  if (p.pbError && !p.limits && !(p.care && Object.keys(p.care).length)) {
    el.innerHTML = '<p class="note err">' + esc(p.pbError) + '</p>';
    return;
  }
  if (p.source === 'plantbook' && !p.limits && !p.pbError && !(p.care && Object.keys(p.care).length)) {
    el.innerHTML = '<p class="note">Loading care data…</p>';
    return;
  }
  const parts = [];
  if (p.care && Object.keys(p.care).length) {
    parts.push(Object.entries(p.care).map(([k, v]) => '<p><b>' + cap(k) + '.</b> ' + esc(v) + '</p>').join('') +
      '<p class="note">Care notes from OpenPlantbook.</p>');
  }
  const w = await wikiSummary(p);
  if (!el.isConnected) return;
  if (w) {
    parts.push((w.thumb ? '<img src="' + esc(w.thumb) + '" alt="' + esc(p.common) + ' on Wikipedia" loading="lazy">' : '') +
      '<p>' + esc(w.extract) + '</p><p><a href="' + esc(w.url) + '" target="_blank" rel="noopener">Read more on Wikipedia</a></p>');
  }
  if (parts.length) {
    el.innerHTML = parts.join('');
    return;
  }
  if (hasLux(p) || p.limits) {
    el.innerHTML = '<p class="note">OpenPlantbook gave light and temperature ranges on this card; there are no extra written notes.</p>';
    return;
  }
  el.innerHTML = '<p class="note">No additional info found.</p>';
}

function renderTicker() {
  const el = $('#ticker');
  let text = 'a window is a little garden. give it good light.';
  if (showWeather()) {
    const t = dayStats(azDeg())[W.today];
    if (t) text = 'your ' + FACINGS[facing()] + ' window catches ' + t.kwh.toFixed(1) + ' sun-hours today: ' + lightCat(t.kwh) + ' light';
  }
  el.textContent = text;
}
function renderWhere() {
  const showForm = !S.loc || locEditing;
  $('#whereForm').hidden = !showForm;
  $('#whereSummary').hidden = showForm;
  $('#whereClose').hidden = !S.loc;
  $('#where').classList.toggle('compact', !showForm);
  if (showForm) return;
  const l = S.loc;
  const ll = Math.abs(l.lat).toFixed(1) + '°' + (l.lat >= 0 ? 'N' : 'S') + ', ' + Math.abs(l.lon).toFixed(1) + '°' + (l.lon >= 0 ? 'E' : 'W');
  $('#wsName').textContent = l.name || 'your location';
  $('#wsCoords').textContent = ll + (W && W.tz ? ', ' + W.tz.replace(/_/g, ' ') : '');
  const f = $('#wsFacts');
  if (W) {
    const d = W.days.find(x => x.date === W.today) || W.days[0];
    const mk = (v, lab) => '<div class="fact"><b>' + v + '</b><span>' + lab + '</span></div>';
    const len = (d.rise != null && d.set != null) ? d.set - d.rise : null;
    f.innerHTML = (d.rise != null ? mk(fmtClock(d.rise), 'sunrise') : '') + (d.set != null ? mk(fmtClock(d.set), 'sunset') : '') +
      (len != null ? mk(Math.floor(len / 60) + 'h ' + (len % 60) + 'm', 'daylight') : '') +
      mk(fmtTemp(d.tmax) + ' / ' + fmtTemp(d.tmin), 'today’s high and low');
  } else if (weatherState === 'error') f.innerHTML = '<span class="note">Weather unavailable right now.</span>';
  else f.innerHTML = '<span class="note">Reading the sky…</span>';
}
function openLocation() {
  locEditing = true;
  renderAll();
  const w = $('#where'); w.scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('#cityInput').focus();
}

function renderSkySection() { renderHero(); renderWeek(); renderPlants(); renderTicker(); }
function renderAll() { renderHeader(); renderSkySection(); renderAlerts(); renderWhere(); }

/* ---------- Events ---------- */
$('#locBtn').addEventListener('click', openLocation);
$('#changeLoc').addEventListener('click', openLocation);
$('#whereClose').addEventListener('click', () => { locEditing = false; renderAll(); });
$('#geoBtn').addEventListener('click', useGeolocation);
$('#unitBtn').addEventListener('click', () => { S.units = S.units === 'F' ? 'C' : 'F'; save(); renderAll(); });
const runCitySearch = debounce(async () => {
  const q = $('#cityInput').value.trim(), ul = $('#cityResults'), msg = $('#whereMsg');
  if (q.length < 2) { ul.innerHTML = ''; return; }
  try {
    const res = await searchCities(q);
    showMsg(msg, res.length ? '' : 'No cities found for “' + q + '”.');
    ul.innerHTML = res.map((c, i) => '<li><button type="button" data-city="' + i + '">' + esc(cityLabel(c)) + '</button></li>').join('');
    ul._res = res;
  } catch (e) { showMsg(msg, e.message, true); }
}, 300);
$('#cityInput').addEventListener('input', runCitySearch);
$('#cityResults').addEventListener('click', e => {
  const b = e.target.closest('[data-city]'); if (!b) return;
  const c = $('#cityResults')._res[+b.dataset.city];
  $('#cityResults').innerHTML = ''; $('#cityInput').value = '';
  setLocation({ lat: +c.latitude.toFixed(3), lon: +c.longitude.toFixed(3), name: c.name });
});

const runPlantSearch = debounce(async () => {
  const q = $('#plantInput').value.trim(), ul = $('#plantResults'), msg = $('#plantMsg');
  if (q.length < 2) { ul.innerHTML = ''; showMsg(msg, ''); return; }
  if (!getKey()) {
    showMsg(msg, 'Add an OpenPlantbook API key below to search plants.', true);
    ul.innerHTML = '';
    return;
  }
  showMsg(msg, 'Searching…');
  try {
    const res = await searchPb(q);
    showMsg(msg, res.length ? '' : 'No plants found for “' + q + '”. Try another spelling or the scientific name.');
    const imgTag = (url, label) => url
      ? '<img src="' + esc(url) + '" alt="' + esc(label) + '" loading="lazy" referrerpolicy="no-referrer" decoding="async">'
      : '<span class="ph" role="img" aria-label="No photo for ' + esc(label) + '"></span>';
    ul.innerHTML = res.map((r, i) => {
      const common = r.common || r.name, sci = r.name, photo = pbThumb(r);
      const altLabel = cap(common) || sci;
      return '<li><button type="button" data-plant="' + i + '">' + imgTag(photo, altLabel) +
        '<span><b>' + esc(cap(common)) + '</b><small class="sci">' + esc(sci) + '</small></span></button></li>';
    }).join('');
    ul._res = res;
  } catch (e) { showMsg(msg, explain(e) + ' Check your connection and try again.', true); }
}, 300);
$('#plantInput').addEventListener('input', runPlantSearch);
$('#plantInput').addEventListener('keydown', e => { if (e.key === 'Enter') { const b = $('#plantResults button'); if (b) b.click(); } });
$('#plantResults').addEventListener('click', async e => {
  const b = e.target.closest('[data-plant]'); if (!b) return;
  const r = $('#plantResults')._res[+b.dataset.plant];
  $('#plantResults').innerHTML = ''; $('#plantInput').value = ''; $('#plantMsg').textContent = '';
  addPb(r);
});

$('#plantList').addEventListener('click', e => {
  const quick = e.target.closest('[data-quick]');
  if (quick) {
    const input = $('#plantInput');
    input.value = quick.dataset.quick;
    input.focus();
    runPlantSearch();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const p = S.plants.find(x => x.id === +b.dataset.id); if (!p) return;
  if (b.dataset.act === 'set') { p[b.dataset.key] = b.dataset.val; }
  else if (b.dataset.act === 'reload') { p.pbError = ''; save(); renderAll(); loadCare(p); return; }
  else if (b.dataset.act === 'lookup') { lookupCare(p); return; }
  else if (b.dataset.act === 'remove') S.plants = S.plants.filter(x => x !== p);
  save(); renderAll();
});
$('#plantList').addEventListener('toggle', e => {
  if (e.target.tagName === 'DETAILS' && e.target.open) fillAbout(+e.target.dataset.id);
}, true);

function pickDir(i) { S.facing = i; save(); renderSkySection(); }
$('#heroInfo').addEventListener('click', e => {
  if (e.target.id === 'retry') return loadWeather();
  const w = e.target.closest('[data-dir]');
  if (w) return pickDir(+w.dataset.dir);
});
$('#heroInfo').addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset && e.target.dataset.dir) { e.preventDefault(); pickDir(+e.target.dataset.dir); }
});

let keyEditing = false;
function renderKeyBox() {
  const box = $('#keyBox');
  if (DEFAULT_PLANTBOOK_KEY && !S.pbKey && !keyEditing) {
    box.innerHTML = '';
    return;
  }
  if (getKey() && !keyEditing) {
    box.innerHTML = '<p class="keyline"><span class="dot"></span>Plant care ranges from OpenPlantbook.' +
      (S.pbKey ? ' <button class="linkbtn" type="button" data-kact="change">Change key</button> <button class="linkbtn" type="button" data-kact="remove">Remove key</button>' : '') + '</p>';
  } else {
    box.innerHTML = '<label for="pbKey">OpenPlantbook API key</label>' +
      '<p class="note">Paste a key from open.plantbook.io if you use your own. Otherwise this site’s built-in key is used. Saved keys stay in this browser only.</p>' +
      '<div class="row"><input class="field" id="pbKey" type="password" placeholder="optional: your API key" autocomplete="off"><button class="btn" type="button" data-kact="save">save key</button>' +
      (keyEditing ? '<button class="btn ghost" type="button" data-kact="cancel">cancel</button>' : '') + '</div><p class="msg" id="keyMsg" role="status"></p>';
  }
}
$('#keyBox').addEventListener('click', async e => {
  const b = e.target.closest('[data-kact]'); if (!b) return;
  const a = b.dataset.kact;
  if (a === 'change') { keyEditing = true; renderKeyBox(); $('#pbKey').focus(); }
  else if (a === 'cancel') { keyEditing = false; renderKeyBox(); }
  else if (a === 'remove') { S.pbKey = ''; save(); keyEditing = false; renderKeyBox(); renderPlants(); }
  else if (a === 'save') {
    const val = $('#pbKey').value.trim(), msg = $('#keyMsg');
    if (!val) { showMsg(msg, 'Paste your key first.', true); return; }
    const prev = S.pbKey; S.pbKey = val;
    showMsg(msg, 'Checking the key…');
    try { await pbFetch('/plant/search?limit=1&alias=monstera'); save(); keyEditing = false; renderKeyBox(); renderPlants(); }
    catch (err) { S.pbKey = prev; showMsg(msg, explain(err), true); }
  }
});

function syncPlantCareFromApi() {
  if (!getKey()) return;
  for (const p of S.plants) {
    if (p.pid && !p.limits && !p.pbError) loadCare(p);
    else if (!p.pid && !p.limits && !p.pbNote && !p.pbError && getKey()) lookupCare(p);
  }
}

/* ---------- Boot ---------- */
renderAll();
renderKeyBox();
syncPlantCareFromApi();
if (S.loc) loadWeather();
setInterval(() => { if (S.loc && !document.hidden) loadWeather(); }, 30 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.loc && W && Date.now() - (W.fetched || 0) > 10 * 60 * 1000) loadWeather(); });
})();
