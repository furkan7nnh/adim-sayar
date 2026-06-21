const STORAGE_KEY = 'step-tracker-data';
const form = document.getElementById('step-form');
const dateInput = document.getElementById('date');
const stepsInput = document.getElementById('steps');
const todayTotalEl = document.getElementById('today-total');
const monthTotalEl = document.getElementById('month-total');
const yearTotalEl = document.getElementById('year-total');
const tableBody = document.getElementById('entry-table-body');
const monthlySummaryEl = document.getElementById('monthly-summary');
const yearlySummaryEl = document.getElementById('yearly-summary');
const clearAllBtn = document.getElementById('clear-all');
const toggleMotionBtn = document.getElementById('toggle-motion');
const resetTodayBtn = document.getElementById('reset-today');
const motionStatusEl = document.getElementById('motion-status');
const liveStepCountEl = document.getElementById('live-step-count');
const liveRingEl = document.getElementById('live-ring');
const qrCodeEl = document.getElementById('qr-code');
const qrLinkEl = document.getElementById('qr-link');

let entries = loadEntries();
let motionTracking = false;
let lastAccelMagnitude = 0;
let lastStepTime = 0;
let currentToday = getDateKey(new Date());
let smoothedMagnitude = 0;
const STEP_THRESHOLD = 0.45;
const STEP_COOLDOWN_MS = 90;
const isMobileDevice = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

function loadEntries() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return {};
    const parsed = JSON.parse(saved);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

function saveEntries() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (error) {
    updateMotionStatus('Veriler kaydedilemedi. Tarayıcı alanını kontrol edin.');
  }
}

function parseLocalDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(dateStr) {
  const date = parseLocalDate(dateStr);
  return date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function getDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMonthKey(dateStr) {
  return dateStr.slice(0, 7);
}

function getYearKey(dateStr) {
  return dateStr.slice(0, 4);
}

function getTotalsForDate(dateKey) {
  return Number(entries[dateKey] || 0);
}

function getMonthTotal(monthKey) {
  let total = 0;
  Object.entries(entries).forEach(([dateKey, steps]) => {
    if (dateKey.startsWith(monthKey)) {
      total += Number(steps || 0);
    }
  });
  return total;
}

function getYearTotal(yearKey) {
  let total = 0;
  Object.entries(entries).forEach(([dateKey, steps]) => {
    if (dateKey.startsWith(yearKey)) {
      total += Number(steps || 0);
    }
  });
  return total;
}

function addStepsToDate(dateKey, delta) {
  const safeDelta = Math.max(0, Number(delta) || 0);
  if (safeDelta <= 0) return;
  entries[dateKey] = (Number(entries[dateKey]) || 0) + safeDelta;
  saveEntries();
  render();
}

function setStepsForDate(dateKey, value) {
  entries[dateKey] = Math.max(0, Number(value) || 0);
  saveEntries();
  render();
}

function deleteEntry(dateKey) {
  delete entries[dateKey];
  saveEntries();
  render();
}

function clearAllEntries() {
  entries = {};
  saveEntries();
  render();
}

function updateMotionStatus(message) {
  motionStatusEl.textContent = message;
}

function updateLiveRing() {
  const todaySteps = getTotalsForDate(currentToday);
  liveStepCountEl.textContent = todaySteps.toLocaleString('tr-TR');
  const percent = Math.min(100, Math.round((todaySteps % 10000) / 100));
  liveRingEl.style.background = `conic-gradient(#22c55e ${percent * 3.6}deg, #e5e7eb 0deg)`;
}

function getShareableUrl() {
  return window.location.href || window.location.origin + window.location.pathname;
}

function renderQrCode() {
  const url = getShareableUrl();
  if (qrLinkEl) {
    qrLinkEl.href = url;
    qrLinkEl.textContent = url;
  }

  if (!qrCodeEl || !window.QRCode) return;
  qrCodeEl.innerHTML = '';
  new QRCode(qrCodeEl, {
    text: url,
    width: 180,
    height: 180,
    colorDark: '#000000',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.H,
    useSVG: false
  });
}

function isMotionSupported() {
  return 'DeviceMotionEvent' in window;
}

function requestMotionPermission() {
  return new Promise((resolve) => {
    if (typeof DeviceMotionEvent === 'undefined' || !('requestPermission' in DeviceMotionEvent)) {
      resolve(true);
      return;
    }

    DeviceMotionEvent.requestPermission()
      .then((response) => resolve(response === 'granted'))
      .catch(() => resolve(false));
  });
}

function startMotionTracking() {
  if (!isMotionSupported()) {
    updateMotionStatus('Bu cihazda hareket takibi desteklenmiyor.');
    return;
  }

  if (!isMobileDevice) {
    updateMotionStatus('Telefon/tablet üzerinde deneyin; bu ortamda gerçek sensör verisi çoğu zaman çalışmaz.');
    return;
  }

  if (motionTracking) return;

  const startTracking = () => {
    window.addEventListener('devicemotion', handleDeviceMotion, { passive: true });
    motionTracking = true;
    toggleMotionBtn.textContent = 'Hareket takibini durdur';
    updateMotionStatus('Hareket takibi aktif. Yürürken adım sayısı artacak.');
  };

  requestMotionPermission().then((granted) => {
    if (!granted) {
      updateMotionStatus('İzin verilmediği için otomatik adım takibi başlatılamadı.');
      return;
    }
    startTracking();
  });
}

function stopMotionTracking() {
  if (!motionTracking) return;
  window.removeEventListener('devicemotion', handleDeviceMotion);
  motionTracking = false;
  toggleMotionBtn.textContent = 'Hareketi izle';
  updateMotionStatus('Otomatik adım takibi durdu.');
}

function handleDeviceMotion(event) {
  const accel = event.accelerationIncludingGravity || event.acceleration;
  if (!accel) return;

  const x = accel.x || 0;
  const y = accel.y || 0;
  const z = accel.z || 0;
  const rawMagnitude = Math.sqrt(x * x + y * y + z * z);
  const now = Date.now();

  currentToday = getDateKey(new Date());

  if (!smoothedMagnitude) {
    smoothedMagnitude = rawMagnitude;
  } else {
    smoothedMagnitude = smoothedMagnitude * 0.75 + rawMagnitude * 0.25;
  }

  const delta = Math.abs(rawMagnitude - smoothedMagnitude);
  const isStep = delta > STEP_THRESHOLD && rawMagnitude > 9 && now - lastStepTime > STEP_COOLDOWN_MS;

  if (isStep) {
    lastStepTime = now;
    addStepsToDate(currentToday, 1);
    updateMotionStatus(`Adım sayısı artırıldı: ${getTotalsForDate(currentToday).toLocaleString('tr-TR')}`);
    updateLiveRing();
  } else if (delta > 0.2) {
    updateMotionStatus('Hareket algılanıyor...');
  }

  lastAccelMagnitude = rawMagnitude;
}

function renderTable() {
  const sortedDates = Object.keys(entries).sort((a, b) => b.localeCompare(a));

  if (sortedDates.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="3">Henüz kayıt yok.</td></tr>';
    return;
  }

  tableBody.innerHTML = '';
  sortedDates.forEach((dateKey) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${formatDate(dateKey)}</td>
      <td>${entries[dateKey].toLocaleString('tr-TR')}</td>
      <td><button class="delete-btn" data-date="${dateKey}">Sil</button></td>
    `;
    tableBody.appendChild(row);
  });
}

function renderMonthlySummary() {
  const monthly = {};

  Object.entries(entries).forEach(([dateKey, steps]) => {
    const monthKey = getMonthKey(dateKey);
    monthly[monthKey] = (monthly[monthKey] || 0) + Number(steps || 0);
  });

  const sortedMonths = Object.keys(monthly).sort((a, b) => b.localeCompare(a));
  monthlySummaryEl.innerHTML = '';

  if (sortedMonths.length === 0) {
    monthlySummaryEl.innerHTML = '<li>Kayıt yok.</li>';
    return;
  }

  sortedMonths.forEach((monthKey) => {
    const item = document.createElement('li');
    item.innerHTML = `<span>${monthKey}</span><strong>${monthly[monthKey].toLocaleString('tr-TR')}</strong>`;
    monthlySummaryEl.appendChild(item);
  });
}

function renderYearlySummary() {
  const yearly = {};

  Object.entries(entries).forEach(([dateKey, steps]) => {
    const yearKey = getYearKey(dateKey);
    yearly[yearKey] = (yearly[yearKey] || 0) + Number(steps || 0);
  });

  const sortedYears = Object.keys(yearly).sort((a, b) => b.localeCompare(a));
  yearlySummaryEl.innerHTML = '';

  if (sortedYears.length === 0) {
    yearlySummaryEl.innerHTML = '<li>Kayıt yok.</li>';
    return;
  }

  sortedYears.forEach((yearKey) => {
    const item = document.createElement('li');
    item.innerHTML = `<span>${yearKey}</span><strong>${yearly[yearKey].toLocaleString('tr-TR')}</strong>`;
    yearlySummaryEl.appendChild(item);
  });
}

function render() {
  currentToday = getDateKey(new Date());
  const thisMonth = currentToday.slice(0, 7);
  const thisYear = currentToday.slice(0, 4);

  todayTotalEl.textContent = getTotalsForDate(currentToday).toLocaleString('tr-TR');
  monthTotalEl.textContent = getMonthTotal(thisMonth).toLocaleString('tr-TR');
  yearTotalEl.textContent = getYearTotal(thisYear).toLocaleString('tr-TR');
  updateLiveRing();

  renderTable();
  renderMonthlySummary();
  renderYearlySummary();
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const date = dateInput.value || currentToday;
  const steps = Number(stepsInput.value);

  if (!Number.isFinite(steps) || steps < 0) {
    alert('Adım sayısı 0 veya daha büyük olmalıdır.');
    return;
  }

  setStepsForDate(date, steps);
  form.reset();
  dateInput.value = date;
  stepsInput.focus();
});

tableBody.addEventListener('click', (event) => {
  const button = event.target.closest('[data-date]');
  if (!button) return;
  deleteEntry(button.dataset.date);
});

clearAllBtn.addEventListener('click', () => {
  if (confirm('Tüm kayıtları silmek istediğinize emin misiniz?')) {
    clearAllEntries();
  }
});

toggleMotionBtn.addEventListener('click', () => {
  if (motionTracking) {
    stopMotionTracking();
  } else {
    startMotionTracking();
  }
});

resetTodayBtn.addEventListener('click', () => {
  if (confirm('Bugünün adım kaydını sıfırlamak istediğinize emin misiniz?')) {
    setStepsForDate(currentToday, 0);
  }
});

dateInput.value = currentToday;
renderQrCode();
render();
