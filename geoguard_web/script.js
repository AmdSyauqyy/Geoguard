'use strict';

const state = {
  rain: 0,
  rainfallHourly: [],
  rainfallUpdatedAt: null,
  weatherAvailable: false,
  moisture: 42,
  slope: 32,
  depth: 2,
  cohesion: 18,
  friction: 28,
  unitWeight: 18,
  locationName: 'Magelang, Jawa Tengah',
  latitude: -7.4706,
  longitude: 110.2178,
  telegramEnabled: false,
  lastAlertStatus: 'NORMAL',
  lastAlertTime: 0,
  lastAlertAttemptTime: 0,
  reports: [],
  map: null,
  mapMarker: null,
  chartsInitialized: false,
  deformation: 0,
  deformationInitialized: false
};

const $ = (id) => document.getElementById(id);
const numberFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
const plotConfig = { responsive: true, displayModeBar: true, displaylogo: false, scrollZoom: true };
const chartLayout = {
  autosize: true,
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(0,0,0,0)',
  font: { family: 'DM Sans, sans-serif', color: '#607469', size: 11 },
  margin: { l: 55, r: 25, t: 20, b: 48 },
  xaxis: { gridcolor: '#edf2ee', zerolinecolor: '#dce7dd' },
  yaxis: { gridcolor: '#edf2ee', zerolinecolor: '#dce7dd' },
  legend: { orientation: 'h', y: 1.13, x: 0 }
};

function deg(value) { return Number(value) * Math.PI / 180; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function formatDateTimeJakarta(date) {
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Jakarta'
  }).format(date).replace(',', '');
}
function jakartaHourString(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    hourCycle: 'h23', timeZone: 'Asia/Jakarta'
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:00`;
}

// Model infinite-slope sederhana dari program Streamlit sumber.
function calculateFoS(cohesion, phiDeg, betaDeg, depthM, gamma, moisturePct, rainfallMm) {
  const beta = deg(betaDeg);
  const phi = deg(phiDeg);
  const z = Math.max(Number(depthM), 0.1);
  const unitWeight = Math.max(Number(gamma), 1);
  const moistureIndex = clamp(Number(moisturePct) / 100, 0, 1);
  const rainIndex = clamp(Number(rainfallMm) / 250, 0, 1);
  const porePressureIndex = clamp(0.65 * moistureIndex + 0.35 * rainIndex, 0, 0.95);
  const normalStress = unitWeight * z * Math.cos(beta) ** 2;
  const porePressure = porePressureIndex * normalStress;
  const drivingStress = unitWeight * z * Math.sin(beta) * Math.cos(beta);
  const resistingStress = Number(cohesion) + Math.max(normalStress - porePressure, 0) * Math.tan(phi);
  const fos = resistingStress / Math.max(drivingStress, 0.01);
  return { fos, porePressure, porePressureIndex };
}

function classifyStatus(fos) {
  if (fos < 1.0) return { label: 'BAHAYA (SIAGA 1)', kind: 'danger', color: '#dc2626', description: 'Indikator simulasi berada pada kategori Bahaya.' };
  if (fos < 1.25) return { label: 'SIAGA 2', kind: 'orange', color: '#ea580c', description: 'Indikator simulasi berada pada kategori Siaga 2.' };
  if (fos < 1.5) return { label: 'WASPADA', kind: 'warning', color: '#ca8a04', description: 'Indikator simulasi berada pada kategori Waspada.' };
  return { label: 'NORMAL', kind: 'normal', color: '#15803d', description: 'Indikator simulasi berada pada kategori Normal.' };
}

function currentParameters() {
  return {
    moisture: state.moisture, slope: state.slope, depth: state.depth,
    cohesion: state.cohesion, friction: state.friction, unitWeight: state.unitWeight
  };
}

function updateControlLabels() {
  $('moisture-value').textContent = `${state.moisture.toFixed(0)}%`;
  $('slope-value').textContent = `${state.slope.toFixed(0)}°`;
  $('depth-value').textContent = `${state.depth.toFixed(1)} m`;
  $('cohesion-value').textContent = `${state.cohesion.toFixed(0)} kPa`;
  $('friction-value').textContent = `${state.friction.toFixed(0)}°`;
  $('unit-weight-value').textContent = `${state.unitWeight.toFixed(1)} kN/m³`;
  $('deformation-value').textContent = `${state.deformation}%`;
}

function updateLocationLabels() {
  $('active-location').textContent = state.locationName;
  $('header-location').textContent = state.locationName;
  $('coordinates').textContent = `${state.latitude.toFixed(5)}, ${state.longitude.toFixed(5)}`;
  if (state.map && state.mapMarker) {
    state.map.setView([state.latitude, state.longitude], 11);
    state.mapMarker.setLatLng([state.latitude, state.longitude]).bindPopup(escapeHtml(state.locationName));
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function initializeMap() {
  const mapElement = $('monitor-map');
  if (!mapElement) return;
  if (state.map) {
    window.setTimeout(() => state.map.invalidateSize(true), 150);
    return;
  }
  if (!window.L) {
    mapElement.innerHTML = '<div class="map-error">Library peta (Leaflet) gagal dimuat. Periksa koneksi internet atau blokir CDN, lalu muat ulang halaman.</div>';
    return;
  }
  try {
    state.map = L.map(mapElement, { scrollWheelZoom: false, tap: true })
      .setView([state.latitude, state.longitude], 11);
    const osmTiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(state.map);
    let tileErrors = 0;
    osmTiles.on('tileerror', () => {
      tileErrors += 1;
      if (tileErrors >= 3 && !mapElement.querySelector('.map-error')) {
        const notice = document.createElement('div');
        notice.className = 'map-error map-error-overlay';
        notice.textContent = 'Peta dasar gagal diunduh. Periksa koneksi internet, VPN, DNS, atau pemblokir konten.';
        mapElement.appendChild(notice);
      }
    });
    state.mapMarker = L.marker([state.latitude, state.longitude]).addTo(state.map)
      .bindPopup(escapeHtml(state.locationName));
    requestAnimationFrame(() => state.map && state.map.invalidateSize(true));
    window.addEventListener('resize', () => state.map && state.map.invalidateSize(true));
  } catch (error) {
    console.error('Gagal menginisialisasi peta:', error);
    mapElement.innerHTML = '<div class="map-error">Peta gagal diinisialisasi. Buka Console browser (F12) untuk melihat detail error.</div>';
    state.map = null;
  }
}

async function searchLocation(query) {
  const message = $('location-message');
  message.textContent = 'Mencari lokasi…';
  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.search = new URLSearchParams({ q: query, format: 'json', limit: '1' });
    const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const results = await response.json();
    if (!results.length) {
      message.textContent = 'Lokasi tidak ditemukan. Coba nama yang lebih spesifik.';
      return;
    }
    const found = results[0];
    state.latitude = Number(found.lat);
    state.longitude = Number(found.lon);
    state.locationName = found.display_name || query;
    updateLocationLabels();
    message.textContent = 'Lokasi ditemukan. Memperbarui data hujan…';
    await loadRainfall();
  } catch (error) {
    message.textContent = `Pencarian lokasi gagal: ${error.message}`;
  }
}

async function loadRainfall() {
  const rainTotal = $('rain-total');
  const rainUpdated = $('rain-updated');
  rainTotal.textContent = 'Memuat…';
  rainUpdated.textContent = 'Menghubungi Open-Meteo';
  $('refresh-rain').disabled = true;
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({
      latitude: state.latitude.toFixed(5), longitude: state.longitude.toFixed(5),
      hourly: 'rain', current: 'rain', past_days: '2', forecast_days: '1', timezone: 'Asia/Jakarta'
    });
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Open-Meteo mengembalikan HTTP ${response.status}`);
    const payload = await response.json();
    const times = payload?.hourly?.time;
    const rainValues = payload?.hourly?.rain;
    if (!Array.isArray(times) || !Array.isArray(rainValues)) throw new Error('Data hujan per jam tidak tersedia dari Open-Meteo.');

    const now = new Date();
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const rows = times.map((time, index) => ({ time, rain: Number(rainValues[index]) }))
      .filter(row => {
        const rowTime = new Date(`${row.time}:00+07:00`);
        return Number.isFinite(row.rain) && rowTime <= now && rowTime > cutoff;
      })
      .sort((a, b) => a.time.localeCompare(b.time));
    if (!rows.length) throw new Error('Open-Meteo belum mengembalikan data hujan 24 jam terakhir untuk lokasi ini.');

    state.rain = rows.reduce((sum, row) => sum + row.rain, 0);
    state.rainfallHourly = rows.slice(-24);
    state.rainfallUpdatedAt = rows[rows.length - 1].time;
    state.weatherAvailable = true;
    rainTotal.textContent = `${state.rain.toFixed(1)} mm`;
    rainUpdated.textContent = `Data terakhir: ${state.rainfallUpdatedAt.replace('T', ' ')} WIB`;
    $('location-message').textContent = `Lokasi aktif: ${state.locationName}`;
  } catch (error) {
    state.weatherAvailable = false;
    state.rainfallHourly = [];
    rainTotal.textContent = 'Tidak tersedia';
    rainUpdated.textContent = error.message;
  } finally {
    $('refresh-rain').disabled = false;
    renderAll();
  }
}

function seededRandom(seed) {
  let a = seed >>> 0;
  return function random() {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(random) {
  const u = Math.max(random(), 1e-9);
  const v = Math.max(random(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function renderMetrics(model, status, deformation, movementRate) {
  $('status-heading').textContent = status.label;
  $('status-heading').className = `status-text status-${status.kind}`;
  $('metric-fos').textContent = model.fos.toFixed(2);
  $('metric-rain').textContent = state.weatherAvailable ? `${state.rain.toFixed(1)} mm` : 'N/A';
  $('metric-moisture').textContent = `${state.moisture.toFixed(0)}%`;
  $('metric-movement').textContent = `${movementRate.toFixed(2)} mm/jam`;
  $('pore-pressure').textContent = `${model.porePressure.toFixed(1)} kPa`;
  $('water-index').textContent = `${(model.porePressureIndex * 100).toFixed(0)}%`;
  $('summary-slope').textContent = `${state.slope.toFixed(0)}°`;
  const summary = $('summary-status');
  summary.textContent = state.weatherAvailable ? status.description : `${status.description} Data hujan tidak tersedia; model sementara menghitung dengan nilai hujan 0 mm.`;
  summary.className = `inline-status ${status.kind}`;
  const box = $('alert-status-box');
  box.className = `alert-status-box ${status.kind}`;
  $('alert-status-title').textContent = status.label;
  $('alert-status-description').textContent = status.description;
}

function renderRainChart() {
  if (!window.Plotly) return;
  const element = $('rain-chart');
  if (!state.rainfallHourly.length) {
    element.innerHTML = '<div class="empty-state">Data curah hujan belum tersedia. Periksa koneksi atau perbarui data.</div>';
    return;
  }
  const trace = {
    type: 'bar', x: state.rainfallHourly.map(row => row.time.replace('T', ' ')),
    y: state.rainfallHourly.map(row => row.rain), name: 'Hujan per jam',
    marker: { color: '#168b83', line: { width: 0 } },
    hovertemplate: '%{x}<br>%{y:.1f} mm/jam<extra></extra>'
  };
  Plotly.react(element, [trace], {
    ...chartLayout, height: 300, showlegend: false,
    xaxis: { ...chartLayout.xaxis, title: 'Waktu (WIB)', tickangle: -25, automargin: true },
    yaxis: { ...chartLayout.yaxis, title: 'Curah hujan (mm/jam)', rangemode: 'tozero' }
  }, { ...plotConfig, displayModeBar: false });
}

function renderTrendChart(movementRate) {
  if (!window.Plotly) return;
  const random = seededRandom(27);
  let moisture = state.moisture - 8;
  let displacement = 0;
  const moistureSeries = [];
  const displacementSeries = [];
  const hours = Array.from({ length: 24 }, (_, index) => index);
  for (let i = 0; i < 24; i++) {
    moisture = clamp(moisture + 0.35 + gaussian(random) * 0.5, 0, 100);
    displacement = Math.max(0, displacement + movementRate / 24 + gaussian(random) * 0.04);
    moistureSeries.push(moisture);
    displacementSeries.push(displacement);
  }
  const traces = [
    { x: hours, y: moistureSeries, type: 'scatter', mode: 'lines', name: 'Indeks kadar air (simulasi)', line: { color: '#168b83', width: 2.5 }, hovertemplate: 'Jam %{x}<br>%{y:.1f}%<extra></extra>' },
    { x: hours, y: displacementSeries, type: 'scatter', mode: 'lines', name: 'Pergeseran kumulatif (simulasi)', yaxis: 'y2', line: { color: '#d97706', width: 2.5 }, hovertemplate: 'Jam %{x}<br>%{y:.2f} mm<extra></extra>' }
  ];
  Plotly.react('trend-chart', traces, {
    ...chartLayout, height: 340,
    xaxis: { ...chartLayout.xaxis, title: 'Jam ilustratif' },
    yaxis: { ...chartLayout.yaxis, title: 'Kadar air indeks (%)' },
    yaxis2: { title: 'Pergeseran (mm)', overlaying: 'y', side: 'right', showgrid: false },
    legend: { orientation: 'h', y: 1.16, x: 0 }
  }, { ...plotConfig, displayModeBar: false });
}

function makeTerrainData(deformation) {
  const x = Array.from({ length: 65 }, (_, i) => -5 + i * (10 / 64));
  const y = Array.from({ length: 55 }, (_, i) => -4 + i * (8 / 54));
  const z = [];
  const slip = [];
  for (let j = 0; j < y.length; j++) {
    const zRow = [], slipRow = [];
    for (let i = 0; i < x.length; i++) {
      const X = x[i], Y = y[j];
      const base = 3.8 - 0.42 * X + 0.16 * Math.sin(Y * 1.2) + 0.10 * Math.cos(X * 1.3);
      const scar = Math.exp(-((((X - 0.8) / 1.8) ** 2) + (((Y + 0.1) / 1.25) ** 2)));
      const slide = Math.exp(-((((X - 1.5) / 2.0) ** 2) + (((Y + 0.2) / 1.5) ** 2)));
      zRow.push(base - (deformation / 100) * 1.15 * slide + 0.10 * scar);
      const inside = (((X - 0.8) / 2.0) ** 2) + (((Y + 0.1) / 1.5) ** 2) < 1;
      slipRow.push(inside ? 2.35 - 0.42 * X + 0.05 * Math.sin(Y) : null);
    }
    z.push(zRow); slip.push(slipRow);
  }
  return { x, y, z, slip };
}

function renderTerrainChart() {
  if (!window.Plotly) return;
  const data = makeTerrainData(state.deformation);
  const traces = [
    { type: 'surface', x: data.x, y: data.y, z: data.z, colorscale: 'Earth', opacity: .96, colorbar: { title: 'Elevasi<br>relatif' }, name: 'Permukaan lereng', hovertemplate: 'X: %{x:.1f}<br>Y: %{y:.1f}<br>Elevasi relatif: %{z:.2f}<extra></extra>' },
    { type: 'surface', x: data.x, y: data.y, z: data.slip, colorscale: [[0, '#e63946'], [1, '#e63946']], showscale: false, opacity: .72, name: 'Bidang gelincir konseptual', hoverinfo: 'skip' }
  ];
  Plotly.react('terrain-chart', traces, {
    ...chartLayout, height: 520, margin: { l: 0, r: 0, t: 10, b: 0 },
    scene: {
      xaxis: { title: 'Jarak X (relatif)' }, yaxis: { title: 'Jarak Y (relatif)' }, zaxis: { title: 'Elevasi relatif' },
      aspectratio: { x: 1.35, y: 1, z: .65 }, camera: { eye: { x: 1.55, y: 1.55, z: 1 } }
    }, legend: { orientation: 'h', y: 1.02, x: 0 }
  }, plotConfig);
}

function renderCrossSection() {
  if (!window.Plotly) return;
  const x = Array.from({ length: 250 }, (_, i) => i * (100 / 249));
  const ground = x.map(v => 42 - .34 * v + 2.5 * Math.sin(v / 12));
  const slip = x.map(v => 25 - .25 * v + 1.5 * Math.sin(v / 18));
  const moved = clamp(state.deformation / 100, 0, 1);
  const after = x.map((v, i) => ground[i] - moved * 5 * Math.exp(-(((v - 63) / 18) ** 2)));
  const traces = [
    { x, y: ground, type: 'scatter', mode: 'lines', name: 'Permukaan awal', line: { color: '#315f46', width: 3 }, fill: 'tozeroy', fillcolor: 'rgba(91,145,102,.18)' },
    { x, y: after, type: 'scatter', mode: 'lines', name: 'Permukaan simulasi', line: { color: '#d97706', width: 3, dash: 'dash' } },
    { x, y: slip, type: 'scatter', mode: 'lines', name: 'Bidang gelincir ilustratif', line: { color: '#dc2626', width: 2, dash: 'dot' } }
  ];
  Plotly.react('cross-section-chart', traces, {
    ...chartLayout, height: 370, margin: { l: 55, r: 20, t: 35, b: 50 },
    xaxis: { ...chartLayout.xaxis, title: 'Jarak horizontal (m, skematis)' },
    yaxis: { ...chartLayout.yaxis, title: 'Elevasi (m, skematis)' },
    annotations: [{ x: 18, y: ground[45] + 4, text: `Infiltrasi hujan: ${state.rain.toFixed(0)} mm/24 jam`, showarrow: true, arrowhead: 2, ax: 15, ay: -35 }],
    legend: { orientation: 'h', y: 1.12, x: 0 }
  }, { ...plotConfig, displayModeBar: false });
}

function renderSensitivityChart() {
  if (!window.Plotly) return;
  const moistureValues = Array.from({ length: 30 }, (_, index) => 5 + index * (95 / 29));
  const fosValues = moistureValues.map(m => calculateFoS(state.cohesion, state.friction, state.slope, state.depth, state.unitWeight, m, state.rain)[0]);
  const traces = [{ x: moistureValues, y: fosValues, type: 'scatter', mode: 'lines', name: 'FoS', line: { width: 3, color: '#0f766e' } }];
  Plotly.react('sensitivity-chart', traces, {
    ...chartLayout, height: 380,
    xaxis: { ...chartLayout.xaxis, title: 'Indeks kadar air (%)' },
    yaxis: { ...chartLayout.yaxis, title: 'Factor of Safety' },
    shapes: [
      { type: 'line', x0: 0, x1: 1, xref: 'paper', y0: 1, y1: 1, line: { color: '#dc2626', dash: 'dash', width: 1.5 } },
      { type: 'line', x0: 0, x1: 1, xref: 'paper', y0: 1.5, y1: 1.5, line: { color: '#ca8a04', dash: 'dot', width: 1.5 } }
    ],
    annotations: [
      { xref: 'paper', x: 1, y: 1, text: 'FoS = 1,0', showarrow: false, xanchor: 'right', yshift: 10, font: { color: '#dc2626', size: 10 } },
      { xref: 'paper', x: 1, y: 1.5, text: 'FoS = 1,5', showarrow: false, xanchor: 'right', yshift: 10, font: { color: '#ca8a04', size: 10 } }
    ]
  }, { ...plotConfig, displayModeBar: false });
}

function renderParameterTable() {
  const rows = [
    ['Kohesi', `${state.cohesion.toFixed(1)} kPa`],
    ['Sudut geser dalam', `${state.friction.toFixed(1)}°`],
    ['Sudut lereng', `${state.slope.toFixed(1)}°`],
    ['Kedalaman', `${state.depth.toFixed(1)} m`],
    ['Berat isi tanah', `${state.unitWeight.toFixed(1)} kN/m³`]
  ];
  $('parameter-table').innerHTML = rows.map(([name, value]) => `<tr><td>${name}</td><td><strong>${value}</strong></td></tr>`).join('');
}

function buildAlertMessage(status, fos) {
  const now = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false });
  const isDanger = status.label === 'BAHAYA (SIAGA 1)';
  const action = isDanger
    ? 'Indikator simulasi menunjukkan kondisi kritis. Jauhi area lereng dan ikuti arahan petugas/BPBD.'
    : 'Tingkatkan pemantauan dan periksa kondisi lereng oleh petugas berwenang.';
  const title = isDanger ? '🚨 PERINGATAN SIMULASI LONGSOR' : '⚠️ PERINGATAN SIAGA LERENG';
  return `${title}\nGeoGuard ID - Prototype\nWaktu: ${now}\nLokasi: ${state.locationName}\nStatus simulasi: ${status.label}\nFoS simulasi: ${fos.toFixed(2)}\nCurah hujan Open-Meteo: ${state.rain.toFixed(1)} mm/24 jam\nKadar air simulasi: ${state.moisture.toFixed(1)}%\n\nTindakan: ${action}\n\nCatatan: Data dan status ini merupakan simulasi akademik, bukan dasar tunggal evakuasi.`;
}

async function sendTelegram(message) {
  try {
    const response = await fetch('/api/telegram', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok && result.ok) return { ok: true, message: result.description || 'Pesan Telegram berhasil dikirim.' };
    return { ok: false, message: result.description || `Pengiriman Telegram gagal (HTTP ${response.status}).` };
  } catch (error) {
    return { ok: false, message: 'Backend Telegram tidak terjangkau. Jalankan aplikasi melalui server.py, bukan dengan membuka file HTML langsung.' };
  }
}

async function checkAutomaticAlert(status, fos) {
  const previous = state.lastAlertStatus;
  const isAlert = ['WASPADA', 'SIAGA 2', 'BAHAYA (SIAGA 1)'].includes(status.label);
  const changed = status.label !== previous;
  const now = Date.now();
  if (status.label === 'NORMAL') {
    state.lastAlertStatus = 'NORMAL';
    return;
  }
  if (!(state.telegramEnabled && isAlert && changed)) return;
  const cooldownOk = now - state.lastAlertTime >= 600000;
  const retryOk = now - state.lastAlertAttemptTime >= 60000;
  const escalationToDanger = status.label === 'BAHAYA (SIAGA 1)' && previous !== 'BAHAYA (SIAGA 1)';
  if ((cooldownOk || escalationToDanger) && retryOk) {
    state.lastAlertAttemptTime = now;
    const result = await sendTelegram(buildAlertMessage(status, fos));
    const message = $('telegram-message');
    message.textContent = result.ok ? 'Notifikasi otomatis berhasil dikirim ke Telegram.' : `Notifikasi belum terkirim: ${result.message} Sistem dapat mencoba kembali setelah jeda.`;
    message.className = `form-message ${result.ok ? 'success' : 'error'}`;
    if (result.ok) {
      state.lastAlertTime = now;
      state.lastAlertStatus = status.label;
    }
  }
}

function renderAll() {
  const result = calculateFoS(state.cohesion, state.friction, state.slope, state.depth, state.unitWeight, state.moisture, state.weatherAvailable ? state.rain : 0);
  const status = classifyStatus(result.fos);
  const deformation = clamp((1.55 - result.fos) / 1.1, 0, 1);
  if (!state.deformationInitialized) {
    state.deformation = Math.round((deformation * 100) / 5) * 5;
    $('deformation').value = String(state.deformation);
    state.deformationInitialized = true;
  }
  const movementRate = 0.4 + 5 * deformation + 0.012 * (state.weatherAvailable ? state.rain : 0);
  updateControlLabels();
  renderMetrics(result, status, deformation, movementRate);
  renderRainChart();
  renderTrendChart(movementRate);
  renderTerrainChart();
  renderCrossSection();
  renderSensitivityChart();
  renderParameterTable();
  checkAutomaticAlert(status, result.fos);
}

function setActiveTab(tabName) {
  document.querySelectorAll('.tab-button').forEach(button => {
    const active = button.dataset.tab === tabName;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `tab-${tabName}`));
  window.setTimeout(() => {
    if (window.Plotly) {
      document.querySelectorAll(`#tab-${tabName} .chart-container`).forEach(chart => {
        if (chart.data) Plotly.Plots.resize(chart);
      });
    }
    if (tabName === 'dashboard' && state.map) state.map.invalidateSize(true);
  }, 150);
}

function addReport(event) {
  event.preventDefault();
  const description = $('report-description').value.trim();
  const message = $('report-message');
  if (!description) {
    message.textContent = 'Deskripsi laporan belum diisi.';
    message.className = 'form-message error';
    return;
  }
  state.reports.unshift({
    waktu: formatDateTimeJakarta(new Date()) + ' WIB',
    pelapor: $('reporter').value.trim() || 'Anonim',
    jenis: $('report-type').value,
    deskripsi: description
  });
  $('report-form').reset();
  message.textContent = 'Laporan tersimpan pada sesi browser ini.';
  message.className = 'form-message success';
  renderReports();
}

function renderReports() {
  $('report-count').textContent = `${state.reports.length} laporan`;
  $('download-reports').disabled = state.reports.length === 0;
  if (!state.reports.length) {
    $('reports-table').innerHTML = '<tr><td colspan="4" class="empty-state">Belum ada laporan warga.</td></tr>';
    return;
  }
  $('reports-table').innerHTML = state.reports.map(report => `<tr><td>${escapeHtml(report.waktu)}</td><td>${escapeHtml(report.pelapor)}</td><td>${escapeHtml(report.jenis)}</td><td>${escapeHtml(report.deskripsi)}</td></tr>`).join('');
}

function downloadReports() {
  if (!state.reports.length) return;
  const columns = ['Waktu', 'Pelapor', 'Jenis', 'Deskripsi'];
  const keys = ['waktu', 'pelapor', 'jenis', 'deskripsi'];
  const csvCell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [columns.map(csvCell).join(','), ...state.reports.map(report => keys.map(key => csvCell(report[key])).join(','))].join('\r\n');
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'laporan_geoguard.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function bindControls() {
  const controls = [
    ['moisture', 'moisture', Number], ['slope', 'slope', Number], ['depth', 'depth', Number],
    ['cohesion', 'cohesion', Number], ['friction', 'friction', Number], ['unit-weight', 'unitWeight', Number]
  ];
  controls.forEach(([elementId, stateKey, parser]) => {
    $(elementId).addEventListener('input', event => {
      state[stateKey] = parser(event.target.value);
      updateControlLabels();
      renderAll();
    });
  });
  $('deformation').addEventListener('input', event => {
    state.deformation = Number(event.target.value);
    $('deformation-value').textContent = `${state.deformation}%`;
    renderTerrainChart();
    renderCrossSection();
  });
  $('location-form').addEventListener('submit', event => {
    event.preventDefault();
    const query = $('location-search').value.trim();
    if (query) searchLocation(query);
    else $('location-message').textContent = 'Masukkan nama lokasi terlebih dahulu.';
  });
  $('refresh-rain').addEventListener('click', loadRainfall);
  $('telegram-enabled').addEventListener('change', event => {
    state.telegramEnabled = event.target.checked;
    if (state.telegramEnabled) {
      $('telegram-message').textContent = 'Notifikasi otomatis aktif. Pastikan token dan chat ID sudah diatur pada server.';
      const result = calculateFoS(state.cohesion, state.friction, state.slope, state.depth, state.unitWeight, state.moisture, state.weatherAvailable ? state.rain : 0);
      checkAutomaticAlert(classifyStatus(result.fos), result.fos);
    } else {
      $('telegram-message').textContent = 'Notifikasi otomatis dinonaktifkan.';
    }
  });
  $('telegram-test').addEventListener('click', async () => {
    const button = $('telegram-test');
    button.disabled = true;
    $('telegram-message').textContent = 'Mengirim pesan tes…';
    const result = await sendTelegram('🧪 TES NOTIFIKASI GEOGUARD ID\nBot Telegram terhubung ke prototype GeoGuard ID.\nPesan ini hanya pengujian, bukan peringatan bahaya.');
    $('telegram-message').textContent = result.message;
    $('telegram-message').className = `form-message ${result.ok ? 'success' : 'error'}`;
    button.disabled = false;
  });
  $('report-form').addEventListener('submit', addReport);
  $('download-reports').addEventListener('click', downloadReports);
  document.querySelectorAll('.tab-button').forEach(button => button.addEventListener('click', () => setActiveTab(button.dataset.tab)));
}

function init() {
  bindControls();
  initializeMap();
  updateLocationLabels();
  updateControlLabels();
  renderReports();
  renderAll();
  loadRainfall();
}

document.addEventListener('DOMContentLoaded', init);
