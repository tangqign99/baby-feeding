/* ============================================
   宝宝喂养记录 PWA - 应用逻辑 v3.44 (Supabase)
   ============================================ */

const FORMULA_COST_PER_30ML = 2.28; // 30ml = 4.2g, 680g = 369元 → 每30ml费用

// ------- Supabase -------
const SUPABASE_URL = 'https://nzbpopxrxniixnhnqktw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56YnBvcHhyeG5paXhuaG5xa3R3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4ODQ2MzQsImV4cCI6MjA5NzQ2MDYzNH0.wLk-FdQlKha8YObTvgINW2M_9QVSpJk8c91bKJeQO7Q';
var supabase;
var cachedRecords = [];
var _realtimeSub = null;

// ------- Baby Age -------
const BIRTH_DATE = '2025-11-11';

// WHO 0-24月龄 男孩/女孩 身长(cm)/体重(kg) P3/P50/P97 参考数据
// 来源：WHO Child Growth Standards (2006)，13-14/16-17/19-20/22-23 月为线性插值
var WHO_GROWTH = {
  boy: {
    height: { months: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],
      p3: [46.3,51.1,54.7,57.6,60.0,61.9,63.6,65.1,66.5,67.7,69.0,70.2,71.3,72.3,73.4,74.4,75.3,76.3,77.2,78.0,78.9,79.7,80.5,81.3,82.1],
      p50: [49.9,54.7,58.4,61.4,63.9,65.9,67.6,69.2,70.6,72.0,73.3,74.5,75.7,76.8,78.0,79.1,80.2,81.2,82.3,83.2,84.2,85.1,86.0,86.9,87.8],
      p97: [53.4,58.4,62.2,65.3,67.8,69.9,71.6,73.2,74.7,76.2,77.6,78.9,80.2,81.4,82.7,83.9,85.0,86.2,87.3,88.4,89.4,90.5,91.5,92.6,93.6] },
    weight: { months: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],
      p3: [2.5,3.4,4.4,5.1,5.6,6.1,6.4,6.7,7.0,7.2,7.5,7.7,7.8,8.0,8.2,8.4,8.6,8.7,8.9,9.0,9.2,9.3,9.5,9.6,9.8],
      p50: [3.3,4.5,5.6,6.4,7.0,7.5,7.9,8.3,8.6,8.9,9.2,9.4,9.6,9.8,10.1,10.3,10.5,10.7,10.9,11.1,11.3,11.5,11.7,12.0,12.2],
      p97: [4.3,5.7,7.0,7.9,8.6,9.2,9.7,10.2,10.5,10.9,11.2,11.5,11.8,12.1,12.4,12.7,13.0,13.2,13.5,13.8,14.0,14.3,14.6,14.8,15.1] }
  },
  girl: {
    height: { months: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],
      p3: [45.6,50.0,53.2,55.8,58.0,59.9,61.5,62.9,64.3,65.6,66.8,68.0,69.2,70.3,71.3,72.4,73.3,74.3,75.2,76.1,77.0,77.9,78.7,79.5,80.3],
      p50: [49.1,53.7,57.1,59.8,62.1,64.0,65.7,67.3,68.7,70.1,71.5,72.8,74.0,75.2,76.3,77.5,78.6,79.6,80.7,81.7,82.7,83.7,84.6,85.5,86.4],
      p97: [52.7,57.4,60.9,63.8,66.2,68.2,70.0,71.6,73.2,74.7,76.1,77.5,78.9,80.2,81.4,82.7,83.9,85.0,86.2,87.3,88.3,89.4,90.4,91.5,92.5] },
    weight: { months: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],
      p3: [2.4,3.2,4.0,4.6,5.1,5.5,5.8,6.1,6.3,6.6,6.8,7.0,7.1,7.3,7.5,7.7,7.9,8.0,8.2,8.4,8.5,8.7,8.9,9.0,9.2],
      p50: [3.2,4.2,5.1,5.8,6.4,6.9,7.3,7.6,7.9,8.2,8.5,8.7,8.9,9.1,9.4,9.6,9.8,10.0,10.2,10.4,10.7,10.9,11.1,11.3,11.5],
      p97: [4.2,5.4,6.5,7.4,8.1,8.7,9.2,9.6,10.0,10.4,10.7,11.0,11.3,11.6,11.9,12.2,12.5,12.7,13.0,13.3,13.5,13.8,14.1,14.3,14.6] }
  }
};

// ------- 深色模式 -------
const THEME_KEY = 'baby_feeding_theme';

function getThemePreference() {
  try { return localStorage.getItem(THEME_KEY) || 'light'; } catch (e) { return 'light'; }
}

function getEffectiveTheme() {
  var pref = getThemePreference();
  if (pref === 'light' || pref === 'dark') return pref;
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

function applyTheme() {
  var t = getEffectiveTheme();
  document.documentElement.setAttribute('data-theme', t);
  // 重绘统计页图表以适配主题色
  if (currentPage === 'stats') renderStats();
}

function setTheme(pref) {
  if (pref !== 'system' && pref !== 'light' && pref !== 'dark') return;
  try { localStorage.setItem(THEME_KEY, pref); } catch (e) {}
  applyTheme();
}

function getChartTheme() {
  var dark = getEffectiveTheme() === 'dark';
  return dark ? { grid: 'rgba(255,255,255,0.12)', axis: '#9AA0A6', title: '#E9EAED' }
              : { grid: '#F0E8E8', axis: '#888888', title: '#4A4A4A' };
}

function calcBabyAge() {
  var birth = new Date(BIRTH_DATE + 'T00:00:00');
  var today = new Date();
  var totalMonths = (today.getFullYear() - birth.getFullYear()) * 12 + (today.getMonth() - birth.getMonth());
  var days = today.getDate() - birth.getDate();
  if (days < 0) {
    totalMonths -= 1;
    var prevMonth = new Date(today.getFullYear(), today.getMonth(), 0);
    days += prevMonth.getDate();
  }
  return totalMonths + '个月' + days + '天';
}

// ------- Storage -------
const STORAGE_KEY = 'baby_feeding_records'; // legacy localStorage key for migration
const SETTINGS_KEY = 'baby_feeding_settings';

function getRecords() {
  return cachedRecords;
}

function getSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : { notifEnabled: false, interval: 240, babyName: '杨一舟' };
  } catch (e) { return { notifEnabled: false, interval: 240, babyName: '杨一舟' }; }
}

function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

// ------- Supabase Data -------
async function loadRecords() {
  showLoading(true);
  try {
    var { data, error } = await supabase
      .from('feeding_records')
      .select('*')
      .order('timestamp', { ascending: false });

    if (error) throw error;

    // Force-sync local data to Supabase (dedup by timestamp+type)
    var legacyRaw = localStorage.getItem(STORAGE_KEY);
    if (legacyRaw) {
      try {
        var legacy = JSON.parse(legacyRaw);
        if (legacy.length > 0) {
          var existingKeys = new Set((data || []).map(function(r) { return r.timestamp + '|' + r.type; }));
          var toUpload = [];
          for (var i = 0; i < legacy.length; i++) {
            var key = legacy[i].timestamp + '|' + legacy[i].type;
            if (!existingKeys.has(key)) {
              toUpload.push(legacy[i]);
              existingKeys.add(key);
            }
          }
          if (toUpload.length > 0) {
            // 去掉本地 id，timestamp 转为 ISO 字符串
            var cleanUpload = toUpload.map(function(r) {
              var clean = {};
              for (var k in r) { if (k !== 'id') clean[k] = r[k]; }
              if (typeof clean.timestamp === 'number') clean.timestamp = new Date(clean.timestamp).toISOString();
              return clean;
            });
            var { data: inserted, error: migErr } = await supabase.from('feeding_records').insert(cleanUpload).select();
            if (migErr) throw migErr;
            if (inserted) data = (data || []).concat(inserted);
          }
        }
      } catch (e) { toast('本地数据迁移失败: ' + e.message, 'warning'); }
      localStorage.removeItem(STORAGE_KEY);
    }

    cachedRecords = normalizeTimestamps(data || []);
  } catch (e) {
    toast('数据加载失败: ' + e.message, 'warning');
    cachedRecords = [];
  }
  showLoading(false);
}

// Supabase 返回的 timestamp 是 ISO 字符串，前端排序/时间差需要用数字
function normalizeTimestamps(records) {
  for (var i = 0; i < records.length; i++) {
    if (typeof records[i].timestamp === 'string') {
      records[i].timestamp = new Date(records[i].timestamp).getTime();
    }
    if (typeof records[i].sleep_start === 'string') {
      records[i].sleep_start = new Date(records[i].sleep_start).getTime();
    }
    if (typeof records[i].sleep_end === 'string') {
      records[i].sleep_end = new Date(records[i].sleep_end).getTime();
    }
  }
  return records;
}

async function saveRecord(record) {
  // 去掉本地 id，让 Supabase BIGSERIAL 自动生成
  var cleanRecord = {};
  for (var key in record) {
    if (key !== 'id') cleanRecord[key] = record[key];
  }
  // timestamp 转为 ISO 字符串以匹配 TIMESTAMPTZ 列
  if (typeof cleanRecord.timestamp === 'number') {
    cleanRecord.timestamp = new Date(cleanRecord.timestamp).toISOString();
  }
  if (typeof cleanRecord.sleep_start === 'number') {
    cleanRecord.sleep_start = new Date(cleanRecord.sleep_start).toISOString();
  }
  if (typeof cleanRecord.sleep_end === 'number') {
    cleanRecord.sleep_end = new Date(cleanRecord.sleep_end).toISOString();
  }
  try {
    var { data, error } = await supabase.from('feeding_records').insert(cleanRecord).select();
    if (error) throw error;
    if (data && data.length > 0) {
      normalizeTimestamps(data);
      // 去重：realtime 订阅可能已提前将同一条记录插入缓存
      var exists = cachedRecords.some(function(r) { return r.id === data[0].id; });
      if (!exists) {
        cachedRecords.unshift(data[0]);
      }
    } else {
      cachedRecords.unshift(cleanRecord);
    }
    toast('保存成功', 'success');
  } catch (e) {
    toast('保存失败: ' + e.message, 'warning');
    throw e;
  }
}

function subscribeRealtime() {
  if (_realtimeSub) { supabase.removeChannel(_realtimeSub); _realtimeSub = null; }

  _realtimeSub = supabase
    .channel('feeding-changes')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'feeding_records' },
      function(payload) {
        var newRecord = payload.new;
        if (typeof newRecord.timestamp === 'string') {
          newRecord.timestamp = new Date(newRecord.timestamp).getTime();
        }
        if (typeof newRecord.sleep_start === 'string') {
          newRecord.sleep_start = new Date(newRecord.sleep_start).getTime();
        }
        if (typeof newRecord.sleep_end === 'string') {
          newRecord.sleep_end = new Date(newRecord.sleep_end).getTime();
        }
        var exists = cachedRecords.some(function(r) { return r.id === newRecord.id; });
        if (!exists) {
          cachedRecords.unshift(newRecord);
          if (currentPage === 'dashboard') renderDashboard();
          else if (currentPage === 'timeline') renderTimeline();
          else if (currentPage === 'stats') renderStats();
        }
      }
    )
    .on('postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'feeding_records' },
      function(payload) {
        var oldId = payload.old.id;
        cachedRecords = cachedRecords.filter(function(r) { return r.id !== oldId; });
        if (currentPage === 'dashboard') renderDashboard();
        else if (currentPage === 'timeline') renderTimeline();
        else if (currentPage === 'stats') renderStats();
      }
    )
    .subscribe();
}

function showLoading(show) {
  var el = document.getElementById('loadingIndicator');
  if (!el) {
    el = document.createElement('div');
    el.id = 'loadingIndicator';
    el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:rgba(255,255,255,0.95);padding:20px 32px;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.12);font-size:15px;color:var(--pink);font-weight:600;display:none;';
    el.textContent = '加载中...';
    document.body.appendChild(el);
  }
  el.style.display = show ? 'block' : 'none';
}

// ------- Toast -------
function toast(msg, type) {
  type = type || '';
  var container = document.getElementById('toastContainer');
  if (!container) return;
  var el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(function() { el.remove(); }, 2500);
}

// ------- Helpers -------
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTime(ts) {
  var d = new Date(ts);
  var h = d.getHours();
  var m = d.getMinutes();
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

function formatDate(ts) {
  var d = new Date(ts);
  return d.getFullYear() + '-' + (d.getMonth() + 1).toString().padStart(2, '0') + '-' + d.getDate().toString().padStart(2, '0');
}

function formatDateCN(ts) {
  var d = new Date(ts);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
}

function timeAgo(ts) {
  var diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  if (diff < 2592000000) return Math.floor(diff / 86400000) + '天前';
  return formatDate(ts);
}

function toDatetimeLocal(ts) {
  var d = new Date(ts);
  var y = d.getFullYear();
  var mo = (d.getMonth() + 1).toString().padStart(2, '0');
  var day = d.getDate().toString().padStart(2, '0');
  var h = d.getHours().toString().padStart(2, '0');
  var mi = d.getMinutes().toString().padStart(2, '0');
  return y + '-' + mo + '-' + day + 'T' + h + ':' + mi;
}

function groupByDate(records) {
  var map = {};
  records.forEach(function(r) {
    var key = formatDate(r.timestamp);
    if (!map[key]) map[key] = [];
    map[key].push(r);
  });
  var keys = Object.keys(map).sort(function(a, b) { return b.localeCompare(a); });
  return keys.map(function(k) { return { date: k, items: map[k].sort(function(a, b) { return b.timestamp - a.timestamp; }) }; });
}

function getTypeIcon(type) {
  switch (type) {
    case 'milk': return '🍼';
    case 'meal': return '🍚';
    case 'snack': return '🥄';
    case 'sleep': return '💤';
    case 'poop': return '💩';
    case 'diaper': return '🧷';
    case 'height': return '📏';
    case 'weight': return '⚖️';
    case 'hw': return '📏';
    case 'custom': return '📝';
    default: return '📌';
  }
}

function getTypeName(type) {
  switch (type) {
    case 'milk': return '奶量';
    case 'meal': return '吃饭';
    case 'snack': return '辅食';
    case 'sleep': return '睡眠';
    case 'poop': return '大便';
    case 'diaper': return '尿布';
    case 'height': return '身高';
    case 'weight': return '体重';
    case 'hw': return '身高体重';
    case 'custom': return '其他';
    default: return '其他';
  }
}

function getIconBg(type) {
  switch (type) {
    case 'milk': return 'var(--type-milk)';
    case 'meal': return 'var(--type-meal)';
    case 'snack': return 'var(--type-snack)';
    case 'sleep': return 'var(--type-sleep)';
    case 'poop': return 'var(--type-poop)';
    case 'diaper': return 'var(--type-diaper)';
    case 'height': return 'var(--type-height)';
    case 'weight': return 'var(--type-weight)';
    default: return 'var(--type-default)';
  }
}

// ------- Navigation -------
var currentPage = 'dashboard';

function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
  var target = document.getElementById('page-' + page);
  if (target) target.classList.add('active');

  document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
  var navItem = document.querySelector('.nav-item[data-page="' + page + '"]');
  if (navItem) navItem.classList.add('active');

  renderPage(page);
}

function renderPage(page) {
  switch (page) {
    case 'dashboard': renderDashboard(); break;
    case 'entry': renderEntry(); break;
    case 'timeline': renderTimeline(); break;
    case 'stats': renderStats(); break;
    case 'settings': renderSettings(); break;
  }
}

// ------- Note toggle -------
function toggleNote(el) {
  var content = el.nextElementSibling;
  var arrow = el.querySelector('.note-arrow');
  if (!content || !arrow) return;
  var isHidden = content.style.display === 'none';
  content.style.display = isHidden ? 'block' : 'none';
  arrow.textContent = isHidden ? '▼' : '▶';
}

// ------- Delete Record -------
async function deleteRecord(id) {
  if (!confirm('确定要删除这条记录吗？')) return;
  try {
    var { error } = await supabase
      .from('feeding_records')
      .delete()
      .eq('id', id);
    if (error) throw error;
    cachedRecords = cachedRecords.filter(function(r) { return r.id !== id; });
    toast('记录已删除', 'success');
    renderPage(currentPage);
  } catch (e) {
    toast('删除失败: ' + e.message, 'warning');
  }
}

// 更新记录：保留 id 同步到 Supabase，并更新本地缓存
async function updateRecord(record) {
  var id = record.id;
  var clean = {};
  for (var k in record) {
    if (k !== 'id') clean[k] = record[k];
  }
  if (typeof clean.timestamp === 'number') clean.timestamp = new Date(clean.timestamp).toISOString();
  if (typeof clean.sleep_start === 'number') clean.sleep_start = new Date(clean.sleep_start).toISOString();
  if (typeof clean.sleep_end === 'number') clean.sleep_end = new Date(clean.sleep_end).toISOString();
  try {
    var { data, error } = await supabase
      .from('feeding_records')
      .update(clean)
      .eq('id', id)
      .select();
    if (error) throw error;
    if (data && data.length > 0) {
      normalizeTimestamps(data);
      for (var i = 0; i < cachedRecords.length; i++) {
        if (cachedRecords[i].id === id) {
          cachedRecords[i] = data[0];
          break;
        }
      }
    }
    return true;
  } catch (e) {
    toast('更新失败: ' + e.message, 'warning');
    return false;
  }
}

// ------- Dashboard -------
function getActiveSleep() {
  var records = getRecords();
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    if (r.type === 'sleep' && r.sleep_start && !r.sleep_end) return r;
  }
  return null;
}

function switchTab(tab) {
  entryTab = tab;
  selectedPreset = '';
  selectedPortion = '';
  navigateTo('entry');
}

function renderDashboard() {
  var records = getRecords();
  var settings = getSettings();
  document.getElementById('headerTitle').textContent = settings.babyName + '的喂养记录';
  document.getElementById('babyAge').textContent = calcBabyAge();
  
  // Summary: today
  var today = formatDate(Date.now());
  var todayRecords = records.filter(function(r) { return formatDate(r.timestamp) === today; });
  var totalMilk = 0, mealCount = 0, snackCount = 0, sleepCount = 0, totalSleepMin = 0, poopCount = 0, diaperCount = 0;
  todayRecords.forEach(function(r) {
    if (r.type === 'milk') totalMilk += (r.amount || 0);
    if (r.type === 'meal') mealCount += 1;
    if (r.type === 'snack') snackCount += 1;
    if (r.type === 'sleep') {
      sleepCount += 1;
      if (r.sleep_start && r.sleep_end) totalSleepMin += Math.floor((r.sleep_end - r.sleep_start) / 60000);
    }
    if (r.type === 'poop') poopCount += 1;
    if (r.type === 'diaper') diaperCount += 1;
  });
  var sleepStr = sleepCount > 0 ? Math.floor(totalSleepMin / 60) + 'h' + (totalSleepMin % 60) + 'm' : '--';

  var foodTotal = mealCount + snackCount;

  document.getElementById('dashSummary').innerHTML =
    '<div class="dash-milk-hero" style="cursor:pointer" onclick="showTodayDetail(\'milk\')"><div class="hero-value">' + totalMilk + '<span class="unit">ml</span></div><div class="label">今日奶量</div></div>' +
    '<div class="dash-sub-row" style="grid-template-columns:repeat(3,1fr)">' +
    '<div class="dash-item" style="cursor:pointer" onclick="showTodayDetail(\'meal\')"><div class="value">' + foodTotal + '<span class="unit">次</span></div><div class="label">进食</div></div>' +
    '<div class="dash-item" style="cursor:pointer" onclick="showTodayDetail(\'sleep\')"><div class="value">' + sleepStr + '</div><div class="label">睡眠</div></div>' +
    '<div class="dash-item" style="cursor:pointer" onclick="showTodayDetail(\'diaper\')"><div class="value">' + diaperCount + '<span class="unit">次</span></div><div class="label">尿布</div></div>' +
    '</div>';

  // Timer: check for active sleep first
  var activeSleep = getActiveSleep();
  window._activeSleep = activeSleep;

  var timerSleep = document.getElementById('timerSleep');
  if (activeSleep) {
    var sleepDiff = Date.now() - activeSleep.sleep_start;
    var sh = Math.floor(sleepDiff / 3600000);
    var sm = Math.floor((sleepDiff % 3600000) / 60000);
    timerSleep.innerHTML =
      '<div class="timer-label">宝宝正在睡觉</div>' +
      '<div class="timer-value" id="timerValue">' + sh + '小时' + sm + '分钟</div>' +
      '<div class="timer-detail">入睡于 ' + formatTime(activeSleep.sleep_start) + '</div>';
    timerSleep.style.display = '';
    timerSleep.style.cursor = 'pointer';
    timerSleep.onclick = function() { endActiveSleep(); };
  } else {
    timerSleep.innerHTML = '';
    timerSleep.style.display = 'none';
    timerSleep.onclick = null;
    timerSleep.style.cursor = '';
  }

  // Last feeding (milk only)
  var timerFeedingEl = document.getElementById('timerFeeding');
  var feedingRecords = records.filter(function(r) { return r.type === 'milk'; });
  feedingRecords.sort(function(a, b) { return b.timestamp - a.timestamp; });
  var lastFeeding = feedingRecords[0];

  if (lastFeeding) {
    var diff = Date.now() - lastFeeding.timestamp;
    var h = Math.floor(diff / 3600000);
    var m = Math.floor((diff % 3600000) / 60000);
    var detail = lastFeeding.type === 'milk' ? lastFeeding.amount + 'ml' : (lastFeeding.subtype || getTypeName(lastFeeding.type));
    timerFeedingEl.innerHTML =
      '<div class="timer-label">距上次喝奶</div>' +
      '<div class="timer-value" id="timerFeedingValue">' + h + '小时' + m + '分钟</div>' +
      '<div class="timer-detail">' + detail + ' · ' + formatTime(lastFeeding.timestamp) + '</div>';
    timerFeedingEl.style.cursor = 'pointer';
    timerFeedingEl.onclick = function() { switchTab('milk'); };
  } else {
    timerFeedingEl.innerHTML =
      '<div class="timer-label">距上次喝奶</div>' +
      '<div class="timer-value">--</div>' +
      '<div class="timer-detail">暂无记录</div>';
    timerFeedingEl.style.cursor = 'pointer';
    timerFeedingEl.onclick = function() { switchTab('milk'); };
  }

  // Recent 5 records — filtered: sleep only yesterday daytime + today
  var now = new Date();
  var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  var yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  var yesterdayDayStart = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 6, 0, 0).getTime();
  var yesterdayDayEnd = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 18, 0, 0).getTime();

  var allSorted = records.slice().sort(function(a, b) { return b.timestamp - a.timestamp; });
  var filtered = [];
  for (var ri = 0; ri < allSorted.length; ri++) {
    var rec = allSorted[ri];
    if (rec.type === 'sleep') {
      var ts = rec.sleep_start || rec.timestamp;
      if ((ts >= yesterdayDayStart && ts < yesterdayDayEnd) || ts >= todayStart) {
        filtered.push(rec);
      }
    } else {
      filtered.push(rec);
    }
  }
  var recent = filtered.slice(0, 5);
  var recentHtml = '';
  if (recent.length === 0) {
    recentHtml = '<div style="text-align:center;padding:20px;color:var(--text-light);font-size:14px;">暂无记录，快去录入吧~</div>';
  } else {
    recent.forEach(function(r) {
      var desc = buildRecordDesc(r);
      var noteHtml = '';
      if (r.note) {
        noteHtml =
          '<div class="rc-note-toggle" onclick="event.stopPropagation();toggleNote(this);">' +
          '<span class="note-arrow">▶</span> 备注</div>' +
          '<div class="rc-note-content" style="display:none">' + escapeHtml(r.note) + '</div>';
      }
      recentHtml +=
        '<div class="record-card">' +
        '<div class="rc-icon-wrap" style="background:' + getIconBg(r.type) + '">' + getTypeIcon(r.type) + '</div>' +
        '<div class="rc-body">' +
        '<div class="rc-type">' + getTypeName(r.type) + '</div>' +
        '<div class="rc-detail">' + desc + '</div>' +
        noteHtml +
        '<div class="rc-meta"><span class="rc-time">' + formatTime(r.timestamp) + '</span><span class="rc-ago">' + timeAgo(r.timestamp) + '</span></div>' +
        '</div>' +
        '<button class="rc-edit-btn" title="编辑" onclick="event.stopPropagation();showEditRecord(\'' + r.id + '\')">✎</button>' +
        '<button class="rc-delete-btn" title="删除" onclick="event.stopPropagation();deleteRecord(\'' + r.id + '\')">&times;</button>' +
        '</div>';
    });
  }
  document.getElementById('recentList').innerHTML = recentHtml;
}

function buildRecordDesc(r) {
  if (r.type === 'milk') return r.amount + ' ml';
  if (r.type === 'meal' || r.type === 'snack') return (r.subtype || getTypeName(r.type)) + (r.portion ? ' · ' + r.portion + '量' : '');
  if (r.type === 'sleep') {
    if (r.sleep_start && r.sleep_end) {
      var dur = r.sleep_end - r.sleep_start;
      var sh = Math.floor(dur / 3600000);
      var sm = Math.floor((dur % 3600000) / 60000);
      return '睡眠 ' + sh + '小时' + sm + '分钟';
    }
    return '睡眠';
  }
  if (r.type === 'poop') return r.poop_type || '大便';
  if (r.type === 'diaper') return r.diaper_type || '尿布';
  if (r.type === 'height') return r.height + ' cm';
  if (r.type === 'weight') return r.weight + ' 斤';
  if (r.type === 'hw') return (r.height ? r.height + 'cm' : '') + (r.weight ? ' ' + r.weight + '斤' : '');
  if (r.type === 'custom') return r.subtype || '其他';
  return '';
}

function showTodayDetail(type) {
  var existing = document.getElementById('todayDetailPopup');
  if (existing) existing.remove();

  var today = formatDate(Date.now());
  var records = getRecords();
  var typeNames = { milk: '奶量', meal: '吃饭', snack: '辅食', sleep: '睡眠', diaper: '尿布', custom: '其他' };
  var typeName = typeNames[type] || getTypeName(type);

  var dayRecords;
  if (type === 'meal') {
    dayRecords = records.filter(function(r) {
      return (r.type === 'meal' || r.type === 'snack') && formatDate(r.timestamp) === today;
    }).sort(function(a, b) { return a.timestamp - b.timestamp; });
  } else {
    dayRecords = records.filter(function(r) {
      return r.type === type && formatDate(r.timestamp) === today;
    }).sort(function(a, b) { return a.timestamp - b.timestamp; });
  }

  var title = '今日' + typeName + '详情';

  var html = '<div class="modal-overlay show" id="todayDetailPopup" onclick="closeTodayDetail(event)">' +
    '<div class="modal-box" style="max-height:70vh;overflow-y:auto" onclick="event.stopPropagation()">' +
    '<h3 style="margin-bottom:12px">' + title + '</h3>';

  if (dayRecords.length === 0) {
    html += '<div style="text-align:center;padding:20px;color:var(--text-light)">今日暂无' + typeName + '记录</div>';
  } else if (type === 'sleep') {
    html += '<table style="width:100%;font-size:13px;border-collapse:collapse">';
    html += '<thead><tr style="border-bottom:2px solid var(--border);text-align:left;color:var(--text-light);font-size:11px"><th style="padding:8px 4px">入睡</th><th style="padding:8px 4px">醒来</th><th style="padding:8px 4px">时长</th><th style="padding:8px 4px">备注</th><th style="padding:8px 4px">操作</th></tr></thead><tbody>';
    dayRecords.forEach(function(r) {
      var startTs = r.sleep_start || r.timestamp;
      var endTs = r.sleep_end;
      var dur = (endTs && startTs && endTs > startTs) ? (endTs - startTs) : 0;
      var sh = Math.floor(dur / 3600000);
      var sm = Math.floor((dur % 3600000) / 60000);
      html += '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:8px 4px;white-space:nowrap">' + formatTime(startTs) + '</td>' +
        '<td style="padding:8px 4px;white-space:nowrap">' + (endTs ? formatTime(endTs) : '--') + '</td>' +
        '<td style="padding:8px 4px;font-weight:600;color:var(--pink);white-space:nowrap">' + (dur > 0 ? sh + 'h' + sm + 'm' : '--') + '</td>' +
        '<td style="padding:8px 4px;color:var(--text-light);font-size:12px">' + (r.note || '') + '</td>' +
        '<td style="padding:8px 4px;white-space:nowrap"><button class="tl-edit-btn" title="编辑" onclick="showEditRecord(\'' + r.id + '\')">✎</button></td>' +
        '</tr>';
    });
    html += '</tbody></table>';
  } else {
    html += '<table style="width:100%;font-size:13px;border-collapse:collapse">';
    html += '<thead><tr style="border-bottom:2px solid var(--border);text-align:left;color:var(--text-light);font-size:11px"><th style="padding:8px 4px">时间</th><th style="padding:8px 4px">详情</th><th style="padding:8px 4px">备注</th><th style="padding:8px 4px">操作</th></tr></thead><tbody>';
    dayRecords.forEach(function(r) {
      var detail = buildRecordDesc(r);
      html += '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:8px 4px;white-space:nowrap">' + formatTime(r.timestamp) + '</td>' +
        '<td style="padding:8px 4px;font-weight:600;color:var(--pink)">' + detail + '</td>' +
        '<td style="padding:8px 4px;color:var(--text-light);font-size:12px">' + (r.note || '') + '</td>' +
        '<td style="padding:8px 4px;white-space:nowrap"><button class="tl-edit-btn" title="编辑" onclick="showEditRecord(\'' + r.id + '\')">✎</button></td>' +
        '</tr>';
    });
    html += '</tbody></table>';
  }

  html += '<div class="btn-row" style="margin-top:16px">' +
    '<button class="btn-confirm" onclick="document.getElementById(\'todayDetailPopup\').remove()" style="flex:1;padding:10px;border-radius:20px;font-size:14px;border:none;background:var(--pink);color:#fff;cursor:pointer">关闭</button>' +
    '</div></div></div>';

  document.body.insertAdjacentHTML('beforeend', html);
}

function closeTodayDetail(e) {
  if (e && e.target !== document.getElementById('todayDetailPopup')) return;
  var el = document.getElementById('todayDetailPopup');
  if (el) el.remove();
}

// ------- End Active Sleep from Dashboard -------
function endActiveSleep() {
  var activeSleep = getActiveSleep();
  if (!activeSleep) return;

  var existing = document.getElementById('sleepEndPopup');
  if (existing) existing.remove();

  var sleepDiff = Date.now() - activeSleep.sleep_start;
  var sh = Math.floor(sleepDiff / 3600000);
  var sm = Math.floor((sleepDiff % 3600000) / 60000);

  var html = '<div class="modal-overlay show" id="sleepEndPopup" onclick="closeSleepEndPopup(event)">' +
    '<div class="modal-box" onclick="event.stopPropagation()">' +
    '<h3 style="margin-bottom:8px">结束睡眠</h3>' +
    '<div style="text-align:center;padding:16px 0">' +
    '<div style="font-size:42px;font-weight:700;color:var(--pink);margin-bottom:8px">' + sh + '小时' + sm + '分钟</div>' +
    '<div style="font-size:13px;color:var(--text-light);margin-bottom:16px">入睡于 ' + formatTime(activeSleep.sleep_start) + '</div>' +
    '<button class="btn-primary" onclick="confirmSleepEnd()" style="margin-bottom:10px">宝宝醒了</button>' +
    '<br><button onclick="document.getElementById(\'sleepEndPopup\').remove()" style="border:none;background:none;color:var(--text-light);font-size:13px;padding:8px;cursor:pointer">取消</button>' +
    '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

function closeSleepEndPopup(e) {
  if (e && e.target !== document.getElementById('sleepEndPopup')) return;
  var el = document.getElementById('sleepEndPopup');
  if (el) el.remove();
}

async function confirmSleepEnd() {
  var activeSleep = getActiveSleep();
  if (!activeSleep) return;

  var now = Date.now();
  var dur = now - activeSleep.sleep_start;
  var sh = Math.floor(dur / 3600000);
  var sm = Math.floor((dur % 3600000) / 60000);

  try {
    var sleepEndIso = new Date(now).toISOString();
    var { error } = await supabase
      .from('feeding_records')
      .update({ sleep_end: sleepEndIso })
      .eq('id', activeSleep.id);
    if (error) throw error;

    for (var i = 0; i < cachedRecords.length; i++) {
      if (cachedRecords[i].id === activeSleep.id) {
        cachedRecords[i].sleep_end = now;
        break;
      }
    }
    window._activeSleep = null;
    toast('宝宝醒了！睡眠 ' + sh + '小时' + sm + '分钟 💤', 'success');

    var el = document.getElementById('sleepEndPopup');
    if (el) el.remove();

    renderDashboard();
  } catch (e) {
    toast('更新失败: ' + e.message, 'warning');
  }
}

// ------- Formula Cost Detail -------
function showFormulaDetail() {
  var existing = document.getElementById('formulaDetailPopup');
  if (existing) existing.remove();

  var today = formatDate(Date.now());
  var records = getRecords();
  var dayRecords = records.filter(function(r) {
    return r.type === 'milk' && formatDate(r.timestamp) === today;
  }).sort(function(a, b) { return a.timestamp - b.timestamp; });

  var totalCost = 0;

  var html = '<div class="modal-overlay show" id="formulaDetailPopup" onclick="closeFormulaDetail(event)">' +
    '<div class="modal-box" style="max-height:70vh;overflow-y:auto" onclick="event.stopPropagation()">' +
    '<h3 style="margin-bottom:12px">今日奶粉费用详情</h3>';

  if (dayRecords.length === 0) {
    html += '<div style="text-align:center;padding:20px;color:var(--text-light)">今天还没有喝奶记录</div>';
  } else {
    html += '<table style="width:100%;font-size:13px;border-collapse:collapse">';
    html += '<thead><tr style="border-bottom:2px solid var(--border);text-align:left;color:var(--text-light);font-size:11px"><th style="padding:8px 4px">时间</th><th style="padding:8px 4px">奶量</th><th style="padding:8px 4px">费用</th></tr></thead><tbody>';
    dayRecords.forEach(function(r) {
      var amount = r.amount || 0;
      var cost = amount / 30 * FORMULA_COST_PER_30ML;
      totalCost += cost;
      html += '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:8px 4px;white-space:nowrap">' + formatTime(r.timestamp) + '</td>' +
        '<td style="padding:8px 4px;font-weight:600;color:var(--pink)">' + amount + ' ml</td>' +
        '<td style="padding:8px 4px;font-weight:600;color:var(--pink)">¥' + cost.toFixed(2) + '</td>' +
        '</tr>';
    });
    html += '<tr style="font-weight:700;border-top:2px solid var(--border)">' +
      '<td style="padding:10px 4px">当日合计</td>' +
      '<td style="padding:10px 4px"></td>' +
      '<td style="padding:10px 4px;color:var(--pink)">¥' + totalCost.toFixed(2) + '</td>' +
      '</tr>';
    html += '</tbody></table>';
    html += '<div style="font-size:11px;color:var(--text-light);margin-top:8px;text-align:center">单价：每30ml奶粉费用 ¥' + FORMULA_COST_PER_30ML.toFixed(2) + '</div>';
  }

  html += '<div class="btn-row" style="margin-top:16px">' +
    '<button class="btn-confirm" onclick="document.getElementById(\'formulaDetailPopup\').remove()" style="flex:1;padding:10px;border-radius:20px;font-size:14px;border:none;background:var(--pink);color:#fff;cursor:pointer">关闭</button>' +
    '</div></div></div>';

  document.body.insertAdjacentHTML('beforeend', html);
}

function closeFormulaDetail(e) {
  if (e && e.target !== document.getElementById('formulaDetailPopup')) return;
  var el = document.getElementById('formulaDetailPopup');
  if (el) el.remove();
}

// ------- Entry -------
var entryTab = 'milk';
var selectedPreset = '';
var selectedPortion = '';

function renderEntry() {
  var tabsRow1 = [
    { id: 'milk', label: '🍼 奶量' },
    { id: 'meal', label: '🍚 吃饭' },
    { id: 'snack', label: '🥄 辅食' }
  ];
  var tabsRow2 = [
    { id: 'diaper', label: '🧷 尿布' },
    { id: 'sleep', label: '💤 睡眠' }
  ];
  var tabsRow3 = [
    { id: 'height', label: '📏 身高' },
    { id: 'weight', label: '⚖️ 体重' },
    { id: 'custom', label: '📝 其他' }
  ];
  var allTabs = tabsRow1.concat(tabsRow2).concat(tabsRow3);

  var html = '<div class="tab-bar">';
  tabsRow1.forEach(function(t) {
    html += '<button class="tab-btn' + (entryTab === t.id ? ' active' : '') + '" data-tab="' + t.id + '">' + t.label + '</button>';
  });
  html += '</div><div class="tab-bar tab-bar-row2">';
  tabsRow2.forEach(function(t) {
    html += '<button class="tab-btn' + (entryTab === t.id ? ' active' : '') + '" data-tab="' + t.id + '">' + t.label + '</button>';
  });
  html += '</div><div class="tab-bar tab-bar-row3">';
  tabsRow3.forEach(function(t) {
    html += '<button class="tab-btn' + (entryTab === t.id ? ' active' : '') + '" data-tab="' + t.id + '">' + t.label + '</button>';
  });
  html += '</div>';
  document.getElementById('entryTabs').innerHTML = html;

  document.querySelectorAll('#entryTabs .tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      entryTab = btn.dataset.tab;
      selectedPreset = '';
      selectedPortion = '';
      renderEntry();
    });
  });

  renderEntryContent();
}

function datetimeRowHtml() {
  var now = new Date();
  var dateVal = now.getFullYear() + '-' +
    (now.getMonth()+1).toString().padStart(2,'0') + '-' +
    now.getDate().toString().padStart(2,'0');
  var timeVal = now.getHours().toString().padStart(2,'0') + ':' +
    now.getMinutes().toString().padStart(2,'0');
  return '<div class="datetime-row">' +
    '<input type="date" id="entryDate" value="' + dateVal + '" class="dt-date">' +
    '</div>' +
    '<div class="time-picker">' +
    '<input type="time" id="entryTime" value="' + timeVal + '" class="dt-time">' +
    '<div class="time-quick">' +
    '<button type="button" class="tq-btn" onclick="setQuickTime(0)">现在</button>' +
    '<button type="button" class="tq-btn" onclick="setQuickTime(5)">5分钟前</button>' +
    '<button type="button" class="tq-btn" onclick="setQuickTime(10)">10分钟前</button>' +
    '<button type="button" class="tq-btn" onclick="setQuickTime(30)">30分钟前</button>' +
    '</div></div>';
}

function setQuickTime(minutesAgo) {
  var d = new Date(Date.now() - minutesAgo * 60000);
  var h = d.getHours().toString().padStart(2,'0');
  var m = d.getMinutes().toString().padStart(2,'0');
  var timeEl = document.getElementById('entryTime');
  if (timeEl) timeEl.value = h + ':' + m;
}

function renderEntryContent() {
  var container = document.getElementById('entryContent');
  selectedPreset = '';
  selectedPortion = '';

  switch (entryTab) {
    case 'milk':
      container.innerHTML =
        '<div class="preset-grid-milk" id="presetGrid"></div>' +
        '<div class="entry-row">' +
        '<input type="number" id="customAmount" placeholder="自定义ml数" inputmode="numeric" min="1" max="9999">' +
        '</div>' +
        '<div class="entry-row">' +
        '<input type="text" id="milkNote" placeholder="备注（可选）" maxlength="50">' +
        '</div>' +
        datetimeRowHtml() +
        '<button class="btn-primary" onclick="recordMilk()">记录奶量</button>';
      buildPresetGrid(['150', '180', '210', '240'], 'ml');
      break;

    case 'meal':
      container.innerHTML =
        '<div class="preset-grid" id="presetGrid"></div>' +
        '<div class="entry-row">' +
        '<input type="text" id="customMeal" placeholder="自定义食物（可选）" maxlength="30">' +
        '</div>' +
        '<div style="font-size:13px;color:var(--text-light);margin-bottom:4px;">分量</div>' +
        '<div class="portion-bar" id="portionBar"></div>' +
        '<div class="entry-row" style="margin-top:8px">' +
        '<input type="text" id="mealNote" placeholder="备注（可选）" maxlength="50">' +
        '</div>' +
        datetimeRowHtml() +
        '<button class="btn-primary" onclick="recordMeal()">记录吃饭</button>';
      buildPresetGrid(['早餐', '午餐', '晚餐', '加餐', '零食'], '');
      buildPortionBar();
      break;

    case 'snack':
      container.innerHTML =
        '<div class="preset-grid" id="presetGrid"></div>' +
        '<div class="entry-row">' +
        '<input type="text" id="customSnack" placeholder="自定义辅食（可选）" maxlength="30">' +
        '</div>' +
        '<div style="font-size:13px;color:var(--text-light);margin-bottom:4px;">分量</div>' +
        '<div class="portion-bar" id="portionBar"></div>' +
        '<div class="entry-row" style="margin-top:8px">' +
        '<input type="text" id="snackNote" placeholder="备注（可选）" maxlength="50">' +
        '</div>' +
        datetimeRowHtml() +
        '<button class="btn-primary" onclick="recordSnack()">记录辅食</button>';
      buildPresetGrid(['米粉', '果泥', '菜泥', '肉泥', '蛋黄', '其他'], '');
      buildPortionBar();
      break;

    case 'height':
      container.innerHTML =
        '<div style="margin-bottom:12px">' +
        '<label style="display:block;font-size:13px;color:var(--text-light);margin-bottom:4px;">身高 (cm)</label>' +
        '<input type="number" id="heightInput" placeholder="如 65.5" inputmode="decimal" min="1" max="200" step="0.1" style="width:100%;padding:14px;border:2px solid var(--border);border-radius:var(--radius-sm);font-size:20px;text-align:center;outline:none;background:var(--card);color:var(--text)">' +
        '</div>' +
        datetimeRowHtml() +
        '<button class="btn-primary" onclick="recordHeight()">记录身高</button>';
      break;

    case 'weight':
      container.innerHTML =
        '<div style="margin-bottom:12px">' +
        '<label style="display:block;font-size:13px;color:var(--text-light);margin-bottom:4px;">体重 (斤)</label>' +
        '<input type="number" id="weightInput" placeholder="如 7.2" inputmode="decimal" min="0.1" max="100" step="0.1" style="width:100%;padding:14px;border:2px solid var(--border);border-radius:var(--radius-sm);font-size:20px;text-align:center;outline:none;background:var(--card);color:var(--text)">' +
        '</div>' +
        datetimeRowHtml() +
        '<button class="btn-primary" onclick="recordWeight()">记录体重</button>';
      break;

    case 'sleep':
      var activeSleep = getActiveSleep();
      if (activeSleep) {
        var sleepDiff = Date.now() - activeSleep.sleep_start;
        var sh = Math.floor(sleepDiff / 3600000);
        var sm = Math.floor((sleepDiff % 3600000) / 60000);
        var nowLocal = toDatetimeLocal(Date.now());
        container.innerHTML =
          '<div style="text-align:center;padding:16px 0">' +
          '<div style="font-size:14px;color:var(--text-light);margin-bottom:8px">宝宝正在睡觉</div>' +
          '<div style="font-size:42px;font-weight:700;color:var(--pink);margin-bottom:4px">' + sh + '小时' + sm + '分钟</div>' +
          '<div style="font-size:13px;color:var(--text-light);margin-bottom:16px">入睡于 ' + formatTime(activeSleep.sleep_start) + '</div>' +
          '<div style="margin-bottom:12px">' +
          '<label style="display:block;font-size:12px;color:var(--text-light);margin-bottom:4px;">醒来时间（可选）</label>' +
          '<input type="datetime-local" id="sleepEndTime" value="' + nowLocal + '" style="width:100%;max-width:260px;padding:12px;border:2px solid var(--border);border-radius:var(--radius-sm);font-size:15px;outline:none;background:var(--card);color:var(--text);text-align:center;">' +
          '</div>' +
          '<button class="btn-primary" onclick="recordSleepEnd()" style="margin-bottom:10px">宝宝醒了</button>' +
          '<br><button onclick="showManualSleep()" style="border:none;background:none;color:var(--text-light);font-size:13px;padding:8px;cursor:pointer;text-decoration:underline">或手动录入完整睡眠</button>' +
          '</div>';
      } else {
        var nowLocal = toDatetimeLocal(Date.now());
        container.innerHTML =
          '<div style="text-align:center;padding:20px 0">' +
          '<button class="btn-primary" onclick="recordSleepStart()" style="font-size:18px;padding:20px 48px;border-radius:28px;font-weight:700;letter-spacing:2px">宝宝睡着了</button>' +
          '<div style="margin-top:20px;border-top:1px solid var(--border);padding-top:16px">' +
          '<label style="display:block;font-size:13px;color:var(--text-light);margin-bottom:6px;">或选择入睡时间</label>' +
          '<input type="datetime-local" id="sleepStartTime" value="' + nowLocal + '" style="width:100%;max-width:260px;padding:12px;border:2px solid var(--border);border-radius:var(--radius-sm);font-size:15px;outline:none;background:var(--card);color:var(--text);margin-bottom:10px;text-align:center;">' +
          '<br><button class="btn-primary" onclick="recordSleepStart(document.getElementById(\'sleepStartTime\').value)" style="background:var(--pink);font-size:15px;padding:12px 32px;border-radius:24px">按时间入睡</button>' +
          '</div>' +
          '<div style="margin-top:12px">' +
          '<button onclick="showManualSleep()" style="border:none;background:none;color:var(--text-light);font-size:13px;padding:8px;cursor:pointer;text-decoration:underline">或手动录入完整睡眠</button>' +
          '</div>' +
          '</div>';
      }
      break;

    case 'diaper':
      container.innerHTML =
        '<div style="font-size:13px;color:var(--text-light);margin-bottom:6px;">类型</div>' +
        '<div class="preset-grid" id="presetGrid"></div>' +
        '<div class="entry-row">' +
        '<input type="text" id="diaperNote" placeholder="备注（可选）" maxlength="50">' +
        '</div>' +
        datetimeRowHtml() +
        '<button class="btn-primary" onclick="recordDiaper()">记录尿布</button>';
      buildPresetGrid(['小便', '大便'], '');
      break;

    case 'custom':
      container.innerHTML =
        '<div style="font-size:13px;color:var(--text-light);margin-bottom:6px;">记录内容</div>' +
        '<div class="preset-grid" id="presetGrid"></div>' +
        '<div class="entry-row">' +
        '<input type="text" id="customContent" placeholder="如：吃药、洗澡、理发等" maxlength="50">' +
        '</div>' +
        '<div class="entry-row">' +
        '<input type="text" id="customNote" placeholder="备注（可选）" maxlength="50">' +
        '</div>' +
        datetimeRowHtml() +
        '<button class="btn-primary" onclick="recordCustom()">记录其他</button>';
      buildPresetGrid(['理发', '洗澡'], '');
      break;

    case 'poop':
      container.innerHTML =
        '<div style="font-size:13px;color:var(--text-light);margin-bottom:6px;">性状</div>' +
        '<div class="preset-grid" id="presetGrid"></div>' +
        '<div class="entry-row">' +
        '<input type="text" id="poopNote" placeholder="备注（可选）" maxlength="50">' +
        '</div>' +
        datetimeRowHtml() +
        '<button class="btn-primary" onclick="recordPoop()">记录大便</button>';
      buildPresetGrid(['正常', '稀便', '干硬', '绿色', '其他'], '');
      break;
  }
}

function getEntryTimestamp() {
  var dateEl = document.getElementById('entryDate');
  var timeEl = document.getElementById('entryTime');
  if (dateEl && timeEl && dateEl.value && timeEl.value) {
    var ts = new Date(dateEl.value + 'T' + timeEl.value).getTime();
    if (!isNaN(ts)) return ts;
  }
  return Date.now();
}

function buildPresetGrid(items, unit) {
  var grid = document.getElementById('presetGrid');
  if (!grid) return;
  grid.innerHTML = '';
  items.forEach(function(item) {
    var btn = document.createElement('button');
    btn.className = 'preset-btn';
    btn.textContent = item + (unit ? unit : '');
    btn.addEventListener('click', function() {
      if (selectedPreset === item) {
        selectedPreset = '';
        btn.classList.remove('selected');
      } else {
        var prev = grid.querySelector('.preset-btn.selected');
        if (prev) prev.classList.remove('selected');
        selectedPreset = item;
        btn.classList.add('selected');
      }
    });
    grid.appendChild(btn);
  });
}

function buildPortionBar() {
  var bar = document.getElementById('portionBar');
  if (!bar) return;
  var portions = ['少', '中', '多'];
  bar.innerHTML = '';
  portions.forEach(function(p) {
    var btn = document.createElement('button');
    btn.className = 'portion-btn';
    btn.textContent = p;
    btn.addEventListener('click', function() {
      if (selectedPortion === p) {
        selectedPortion = '';
        btn.classList.remove('selected');
      } else {
        var prev = bar.querySelector('.portion-btn.selected');
        if (prev) prev.classList.remove('selected');
        selectedPortion = p;
        btn.classList.add('selected');
      }
    });
    bar.appendChild(btn);
  });
}

async function recordMilk() {
  var amount = selectedPreset ? parseInt(selectedPreset) : 0;
  var customEl = document.getElementById('customAmount');
  if (customEl && customEl.value) amount = parseInt(customEl.value);

  if (!amount || amount <= 0) { toast('请选择或输入奶量', 'warning'); return; }

  var noteEl = document.getElementById('milkNote');
  var note = noteEl ? noteEl.value.trim() : '';

  var record = {
    type: 'milk',
    amount: amount,
    unit: 'ml',
    timestamp: getEntryTimestamp(),
    note: note
  };

  await saveRecord(record);
  toast('记录成功：' + amount + 'ml 🍼', 'success');
  entryTab = 'milk';
  selectedPreset = '';
  selectedPortion = '';
  renderEntry();
  navigateTo('dashboard');
}

async function recordMeal() {
  var subtype = selectedPreset;
  var customEl = document.getElementById('customMeal');
  var customFood = customEl ? customEl.value.trim() : '';
  if (!subtype && customFood) subtype = customFood;
  else if (subtype && customFood) subtype = subtype + ' · ' + customFood;
  if (!subtype) { toast('请选择餐次或输入食物', 'warning'); return; }

  var noteEl = document.getElementById('mealNote');
  var note = noteEl ? noteEl.value.trim() : '';

  // Read portion directly from DOM for reliability
  var portionBtn = document.querySelector('#entryContent .portion-btn.selected');
  var portion = portionBtn ? portionBtn.textContent.trim() : '';

  var record = {
    type: 'meal',
    subtype: subtype,
    timestamp: getEntryTimestamp(),
    note: note
  };
  if (portion) record.portion = portion;

  try {
    await saveRecord(record);
    toast('记录成功：' + subtype + ' 🍚', 'success');
  } catch (e) {
    toast('保存失败：' + e.message, 'warning');
    return;
  }
  entryTab = 'meal';
  selectedPreset = '';
  selectedPortion = '';
  renderEntry();
  navigateTo('dashboard');
}

async function recordSnack() {
  var subtype = selectedPreset;
  var customEl = document.getElementById('customSnack');
  var customFood = customEl ? customEl.value.trim() : '';
  if (!subtype && customFood) subtype = customFood;
  else if (subtype && customFood) subtype = subtype + ' · ' + customFood;
  if (!subtype) { toast('请选择辅食类型或输入名称', 'warning'); return; }

  var noteEl = document.getElementById('snackNote');
  var note = noteEl ? noteEl.value.trim() : '';

  // Read portion directly from DOM for reliability
  var portionBtn = document.querySelector('#entryContent .portion-btn.selected');
  var portion = portionBtn ? portionBtn.textContent.trim() : '';

  var record = {
    type: 'snack',
    subtype: subtype,
    timestamp: getEntryTimestamp(),
    note: note
  };
  if (portion) record.portion = portion;

  try {
    await saveRecord(record);
    toast('记录成功：' + subtype + ' 🥄', 'success');
  } catch (e) {
    toast('保存失败：' + e.message, 'warning');
    return;
  }
  entryTab = 'snack';
  selectedPreset = '';
  selectedPortion = '';
  renderEntry();
  navigateTo('dashboard');
}

async function recordHeight() {
  var hEl = document.getElementById('heightInput');
  var height = hEl ? parseFloat(hEl.value) : NaN;

  if (isNaN(height) || height <= 0) { toast('请输入有效身高', 'warning'); return; }

  var record = {
    type: 'height',
    height: height,
    timestamp: getEntryTimestamp()
  };

  await saveRecord(record);
  toast('记录成功：' + height + 'cm 📏', 'success');
  entryTab = 'height';
  selectedPreset = '';
  renderEntry();
  navigateTo('dashboard');
}

async function recordWeight() {
  var wEl = document.getElementById('weightInput');
  var weight = wEl ? parseFloat(wEl.value) : NaN;

  if (isNaN(weight) || weight <= 0) { toast('请输入有效体重', 'warning'); return; }

  var record = {
    type: 'weight',
    weight: weight,
    timestamp: getEntryTimestamp()
  };

  await saveRecord(record);
  toast('记录成功：' + weight + '斤 ⚖️', 'success');
  entryTab = 'weight';
  selectedPreset = '';
  renderEntry();
  navigateTo('dashboard');
}

async function recordSleep() {
  var startEl = document.getElementById('sleepStart');
  var endEl = document.getElementById('sleepEnd');
  var noteEl = document.getElementById('sleepNote');

  var sleepStart = startEl && startEl.value ? new Date(startEl.value).getTime() : NaN;
  var sleepEnd = endEl && endEl.value ? new Date(endEl.value).getTime() : NaN;
  var note = noteEl ? noteEl.value.trim() : '';

  if (isNaN(sleepStart) || isNaN(sleepEnd)) { toast('请选择入睡时间和醒来时间', 'warning'); return; }
  if (sleepEnd <= sleepStart) { toast('醒来时间必须晚于入睡时间', 'warning'); return; }

  var dur = sleepEnd - sleepStart;
  var sh = Math.floor(dur / 3600000);
  var sm = Math.floor((dur % 3600000) / 60000);

  var record = {
    type: 'sleep',
    sleep_start: sleepStart,
    sleep_end: sleepEnd,
    timestamp: sleepStart,   // 用入睡时间作为记录时间
    note: note
  };

  await saveRecord(record);
  toast('记录成功：睡眠 ' + sh + '小时' + sm + '分钟 💤', 'success');
  entryTab = 'sleep';
  selectedPreset = '';
  renderEntry();
  navigateTo('dashboard');
}

async function recordPoop() {
  // Read selected preset directly from DOM to avoid global state issues
  var selectedBtn = document.querySelector('#entryContent .preset-btn.selected');
  var poopType = (selectedBtn ? selectedBtn.textContent.trim() : '') || selectedPreset;
  if (!poopType) { toast('请选择大便性状', 'warning'); return; }

  var noteEl = document.getElementById('poopNote');
  var note = noteEl ? noteEl.value.trim() : '';

  var record = {
    type: 'poop',
    poop_type: poopType,
    timestamp: getEntryTimestamp(),
    note: note
  };

  await saveRecord(record);
  toast('记录成功：大便 · ' + poopType + ' 💩', 'success');
  entryTab = 'poop';
  selectedPreset = '';
  renderEntry();
  navigateTo('dashboard');
}

// addRecord removed — use saveRecord(record) instead

// ------- Sleep: two-phase entry -------
async function recordSleepStart(specifiedTime) {
  var noteEl = document.getElementById('sleepNote');
  var note = noteEl ? noteEl.value.trim() : '';
  var now = specifiedTime ? new Date(specifiedTime).getTime() : getEntryTimestamp();
  if (isNaN(now)) now = Date.now();

  var record = {
    type: 'sleep',
    sleep_start: now,
    sleep_end: null,
    timestamp: now,
    note: note
  };

  await saveRecord(record);
  toast('宝宝睡着了 💤', 'success');
  entryTab = 'sleep';
  selectedPreset = '';
  renderEntry();
  navigateTo('dashboard');
}

async function recordSleepEnd() {
  var activeSleep = getActiveSleep();
  if (!activeSleep) { toast('没有进行中的睡眠记录', 'warning'); return; }

  // Use custom wake-up time if provided
  var endEl = document.getElementById('sleepEndTime');
  var now = Date.now();
  if (endEl && endEl.value) {
    var customTs = new Date(endEl.value).getTime();
    if (!isNaN(customTs) && customTs > activeSleep.sleep_start) {
      now = customTs;
    }
  }

  var dur = now - activeSleep.sleep_start;
  var sh = Math.floor(dur / 3600000);
  var sm = Math.floor((dur % 3600000) / 60000);

  try {
    var sleepEndIso = new Date(now).toISOString();
    var { error } = await supabase
      .from('feeding_records')
      .update({ sleep_end: sleepEndIso })
      .eq('id', activeSleep.id);
    if (error) throw error;

    // Update cached record
    for (var i = 0; i < cachedRecords.length; i++) {
      if (cachedRecords[i].id === activeSleep.id) {
        cachedRecords[i].sleep_end = now;
        break;
      }
    }
    window._activeSleep = null;
    toast('宝宝醒了！睡眠 ' + sh + '小时' + sm + '分钟 💤', 'success');
    entryTab = 'sleep';
    selectedPreset = '';
    renderEntry();
    navigateTo('dashboard');
  } catch (e) {
    toast('更新失败: ' + e.message, 'warning');
  }
}

function showManualSleep() {
  var container = document.getElementById('entryContent');
  container.innerHTML =
    '<div style="margin-bottom:12px">' +
    '<label style="display:block;font-size:13px;color:var(--text-light);margin-bottom:4px;">入睡时间</label>' +
    '<input type="datetime-local" id="sleepStart" value="' + toDatetimeLocal(Date.now()) + '" style="width:100%;padding:14px;border:2px solid var(--border);border-radius:var(--radius-sm);font-size:15px;outline:none;background:var(--card);color:var(--text);margin-bottom:12px;">' +
    '</div>' +
    '<div style="margin-bottom:12px">' +
    '<label style="display:block;font-size:13px;color:var(--text-light);margin-bottom:4px;">醒来时间</label>' +
    '<input type="datetime-local" id="sleepEnd" value="' + toDatetimeLocal(Date.now()) + '" style="width:100%;padding:14px;border:2px solid var(--border);border-radius:var(--radius-sm);font-size:15px;outline:none;background:var(--card);color:var(--text);margin-bottom:12px;">' +
    '</div>' +
    '<div class="entry-row">' +
    '<input type="text" id="sleepNote" placeholder="备注（可选）" maxlength="50">' +
    '</div>' +
    '<button class="btn-primary" onclick="recordSleep()">记录睡眠</button>';
}

// ------- Diaper -------
async function recordDiaper() {
  var selectedBtn = document.querySelector('#entryContent .preset-btn.selected');
  var diaperType = (selectedBtn ? selectedBtn.textContent.trim() : '') || selectedPreset;
  if (!diaperType) { toast('请选择尿布类型', 'warning'); return; }

  var noteEl = document.getElementById('diaperNote');
  var note = noteEl ? noteEl.value.trim() : '';

  var record = {
    type: 'diaper',
    diaper_type: diaperType,
    timestamp: getEntryTimestamp(),
    note: note
  };

  await saveRecord(record);
  toast('记录成功：尿布 · ' + diaperType + ' 🧷', 'success');
  entryTab = 'diaper';
  selectedPreset = '';
  renderEntry();
  navigateTo('dashboard');
}

// ------- Custom -------
async function recordCustom() {
  var contentEl = document.getElementById('customContent');
  var content = (contentEl ? contentEl.value.trim() : '') || selectedPreset;
  if (!content) { toast('请输入记录内容', 'warning'); return; }

  var noteEl = document.getElementById('customNote');
  var note = noteEl ? noteEl.value.trim() : '';

  var record = {
    type: 'custom',
    subtype: content,
    timestamp: getEntryTimestamp(),
    note: note
  };

  try {
    await saveRecord(record);
    toast('记录成功：' + content + ' 📝', 'success');
  } catch (e) {
    toast('保存失败：' + e.message, 'warning');
    return;
  }
  entryTab = 'custom';
  selectedPreset = '';
  selectedPortion = '';
  renderEntry();
  navigateTo('dashboard');
}

// ------- Timeline -------
function isFeedingOrSleep(type) {
  return type === 'milk' || type === 'meal' || type === 'snack' || type === 'sleep' || type === 'poop' || type === 'diaper';
}

function formatInterval(ms) {
  if (ms < 60000) return '刚刚';
  var h = Math.floor(ms / 3600000);
  var m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return '间隔 ' + h + '小时' + m + '分钟';
  return '间隔 ' + m + '分钟';
}

function computeIntervals(records) {
  // records sorted by timestamp descending (newest first)
  // We compute: for each record, the time diff to the previous feeding/sleep record
  var sorted = records.slice().sort(function(a, b) { return a.timestamp - b.timestamp; });
  var intervals = {};
  for (var i = 0; i < sorted.length; i++) {
    var r = sorted[i];
    if (!isFeedingOrSleep(r.type)) continue;
    // Find the previous feeding/sleep record
    for (var j = i - 1; j >= 0; j--) {
      if (isFeedingOrSleep(sorted[j].type)) {
        var diff = r.timestamp - sorted[j].timestamp;
        var key = r.id || (r.timestamp + '|' + r.type);
        intervals[key] = diff;
        break;
      }
    }
  }
  return intervals;
}

function renderTimeline() {
  var records = getRecords();
  var groups = groupByDate(records);
  var intervals = computeIntervals(records);
  var html = '';

  if (groups.length === 0) {
    html = '<div style="text-align:center;padding:40px;color:var(--text-light);font-size:15px;">暂无记录</div>';
  } else {
    groups.forEach(function(g) {
      html += '<div class="date-group"><div class="date-label">' + formatDateCN(new Date(g.date + 'T00:00:00').getTime()) + '</div>';
      g.items.forEach(function(r) {
        var desc = buildRecordDesc(r);
        var key = r.id || (r.timestamp + '|' + r.type);
        var intervalStr = '';
        if (isFeedingOrSleep(r.type) && intervals[key] !== undefined) {
          intervalStr = '<div class="tl-interval">' + formatInterval(intervals[key]) + '</div>';
        }

        var tlNoteHtml = '';
        if (r.note) {
          tlNoteHtml = '<div class="tl-note-text" style="color:var(--text-light);font-size:12px;margin-top:2px;">' + escapeHtml(r.note) + '</div>';
        }

        html += '<div class="tl-item">' +
          '<div class="tl-icon" style="background:' + getIconBg(r.type) + ';border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;">' + getTypeIcon(r.type) + '</div>' +
          '<div class="tl-content"><div class="tl-title">' + desc + '</div>' + tlNoteHtml + '<div class="tl-time">' + formatTime(r.timestamp) + intervalStr + '</div></div>' +
          '<div class="tl-ago">' + timeAgo(r.timestamp) + '</div>' +
          '<button class="tl-edit-btn" title="编辑" onclick="event.stopPropagation();showEditRecord(\'' + r.id + '\')">✎</button>' +
          '<button class="tl-delete-btn" title="删除" onclick="event.stopPropagation();deleteRecord(\'' + r.id + '\')">&times;</button>' +
          '</div>';
      });
      html += '</div>';
    });
  }
  document.getElementById('timelineContent').innerHTML = html;
}

// ------- Stats -------

function getDateRange(mode, customStart, customEnd) {
  var now = new Date();
  var endTs = now.getTime();
  var startTs;
  switch (mode) {
    case '2days':
      startTs = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
      break;
    case '3days':
      startTs = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2).getTime();
      break;
    case '7days':
      startTs = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
      break;
    case '30days':
      startTs = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29).getTime();
      break;
    case 'month':
      var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      startTs = monthStart.getTime();
      break;
    case 'lastmonth':
      startTs = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
      endTs = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).getTime();
      break;
    case 'custom':
      if (customStart && customEnd) {
        startTs = new Date(customStart + 'T00:00:00').getTime();
        endTs = new Date(customEnd + 'T23:59:59').getTime();
        if (isNaN(startTs) || isNaN(endTs)) { startTs = endTs - 7 * 86400000; }
      } else {
        startTs = endTs - 7 * 86400000;
      }
      break;
    default:
      startTs = endTs - 7 * 86400000;
  }
  return { start: startTs, end: endTs };
}

var statsRange = { mode: '7days', customStart: '', customEnd: '' };

function getStatsRange() {
  return getDateRange(statsRange.mode, statsRange.customStart, statsRange.customEnd);
}

function setStatsRange(mode, customStart, customEnd) {
  statsRange.mode = mode;
  if (customStart !== undefined) statsRange.customStart = customStart;
  if (customEnd !== undefined) statsRange.customEnd = customEnd;
  renderStats();
}

function getStatsRangeLabel(m) {
  var labels = { '7days': '近7天', 'month': '本月', 'lastmonth': '上月', 'custom': '自定义' };
  return labels[m] || '近7天';
}

function applyCustomStatsRange() {
  var s = document.getElementById('statsCustomStart');
  var e = document.getElementById('statsCustomEnd');
  var sv = s ? s.value : '';
  var ev = e ? e.value : '';
  if (!sv || !ev) { toast('请选择起止日期', 'warning'); return; }
  if (sv > ev) { toast('开始日期不能晚于结束日期', 'warning'); return; }
  statsRange.mode = 'custom';
  statsRange.customStart = sv;
  statsRange.customEnd = ev;
  renderStats();
}

function buildStatsRangeUI() {
  var m = statsRange.mode;
  var modes = [['7days', '近7天'], ['month', '本月'], ['lastmonth', '上月'], ['custom', '自定义']];
  var html = '<div class="chart-container" style="margin-bottom:12px"><div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">';
  modes.forEach(function(mm) {
    var active = m === mm[0] ? 'style="background:var(--pink);color:#fff;border-color:var(--pink)"' : 'style="background:var(--card);color:var(--text);border-color:var(--border)"';
    html += '<button onclick="setStatsRange(\'' + mm[0] + '\')" ' + active + ' style="padding:8px 16px;border-radius:18px;border:1.5px solid;font-size:13px;cursor:pointer">' + mm[1] + '</button>';
  });
  html += '</div>';
  if (m === 'custom') {
    html += '<div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap">' +
      '<input type="date" id="statsCustomStart" value="' + (statsRange.customStart || '') + '" style="flex:1;min-width:130px;padding:8px;border:2px solid var(--border);border-radius:10px;font-size:13px;background:var(--card);color:var(--text)">' +
      '<span style="color:var(--text-light)">至</span>' +
      '<input type="date" id="statsCustomEnd" value="' + (statsRange.customEnd || '') + '" style="flex:1;min-width:130px;padding:8px;border:2px solid var(--border);border-radius:10px;font-size:13px;background:var(--card);color:var(--text)">' +
      '<button onclick="applyCustomStatsRange()" style="padding:8px 18px;background:var(--pink);color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:500;cursor:pointer">应用</button>' +
      '</div>';
  }
  html += '<div style="text-align:center;font-size:11px;color:var(--text-light);margin-top:8px">当前区间：' + getStatsRangeLabel(m) +
    (m === 'custom' && statsRange.customStart ? ' (' + statsRange.customStart + ' ~ ' + statsRange.customEnd + ')' : '') + '</div>';
  html += '</div>';
  return html;
}

function renderStats() {
  var container = document.getElementById('statsContent');
  var records = getRecords();
  var range = getStatsRange();
  var rangeLabel = getStatsRangeLabel(statsRange.mode);

  // 区间内所有天（按天聚合）
  var days = [];
  var _cur = new Date(range.start);
  var _endD = new Date(range.end);
  while (_cur.getTime() <= _endD.getTime()) {
    days.push(formatDate(_cur.getTime()));
    _cur.setDate(_cur.getDate() + 1);
  }

  var milkByDay = {};
  days.forEach(function(d) { milkByDay[d] = 0; });
  records.forEach(function(r) {
    if (r.type === 'milk') {
      var d = formatDate(r.timestamp);
      if (milkByDay[d] !== undefined) milkByDay[d] += (r.amount || 0);
    }
  });

  // Get height and weight records (new style + legacy hw)
  var heightRecords = records.filter(function(r) { return r.type === 'height' || (r.type === 'hw' && r.height !== undefined); }).sort(function(a, b) { return a.timestamp - b.timestamp; });
  var weightRecords = records.filter(function(r) { return r.type === 'weight' || (r.type === 'hw' && r.weight !== undefined); }).sort(function(a, b) { return a.timestamp - b.timestamp; });

  // Normalize to { height, weight, timestamp } for chart
  function normalizeHW(recs) {
    return recs.map(function(r) {
      var h = r.type === 'height' ? r.height : (r.type === 'hw' ? r.height : undefined);
      var w = r.type === 'weight' ? r.weight : (r.type === 'hw' ? r.weight : undefined);
      return { height: h, weight: w, timestamp: r.timestamp };
    });
  }
  var hwData = normalizeHW(heightRecords.concat(weightRecords)).sort(function(a, b) { return a.timestamp - b.timestamp; });

  // Merge same-day height + weight pairs for chart (use latest of each per day)
  var dayMap = {};
  hwData.forEach(function(d) {
    var key = formatDate(d.timestamp);
    if (!dayMap[key]) dayMap[key] = { height: undefined, weight: undefined, timestamp: d.timestamp };
    if (d.height !== undefined) dayMap[key].height = d.height;
    if (d.weight !== undefined) dayMap[key].weight = d.weight;
    if (d.timestamp > dayMap[key].timestamp) dayMap[key].timestamp = d.timestamp;
  });
  var hwChartData = Object.keys(dayMap).sort().map(function(k) { return dayMap[k]; });

  // BMI display: show latest BMI from paired same-day data
  var bmiText = '';
  var hwWithBoth = hwChartData.filter(function(d) { return d.height !== undefined && d.weight !== undefined; });
  if (hwWithBoth.length > 0) {
    var latest = hwWithBoth[hwWithBoth.length - 1];
    var bmi = ((latest.weight / 2) / ((latest.height / 100) * (latest.height / 100))).toFixed(1);
    bmiText = '<div style="text-align:center;padding:8px 0;font-size:14px;color:var(--pink);font-weight:600">最新 BMI: ' + bmi + '</div>';
  }

  var html = '';

  html += buildStatsRangeUI();

  // Milk bar chart
  var milkValues = days.map(function(d) { return milkByDay[d]; });
  var maxMilk = Math.max.apply(null, milkValues.concat([1]));
  var hasMilk = milkValues.some(function(v) { return v > 0; });

  html += '<div class="chart-container"><div class="chart-title">' + rangeLabel + '奶量 (ml)</div>';
  if (hasMilk) {
    html += '<canvas id="milkChart" width="320" height="180" style="width:100%;max-width:420px"></canvas>';
    html += '<div style="text-align:center;font-size:11px;color:var(--text-light);margin-top:4px">点击柱子查看当天详情</div>';
  } else {
    html += '<div class="stat-empty">暂无奶量数据</div>';
  }
  html += '</div>';

  // Sleep records section
  var allSleepRecords = records.filter(function(r) { return r.type === 'sleep'; }).sort(function(a, b) { return b.timestamp - a.timestamp; });
  html += '<div class="chart-container"><div class="chart-title">睡眠记录</div>';

  var sleepRange = range;
  var sleepRecords = allSleepRecords.filter(function(r) {
    var ts = r.sleep_start || r.timestamp;
    return ts >= sleepRange.start && ts <= sleepRange.end;
  });

  // Sleep summary metrics & bar chart
  window._sleepChartData = null;
  if (sleepRecords.length > 0) {
    var sleepByDay = {};
    sleepRecords.forEach(function(r) {
      var startTs = r.sleep_start || r.timestamp;
      var endTs = r.sleep_end;
      var d = formatDate(startTs);
      if (!sleepByDay[d]) sleepByDay[d] = { night: 0, day: 0, records: [] };
      var dur = (endTs && startTs && endTs > startTs) ? (endTs - startTs) : 0;
      var startHour = new Date(startTs).getHours();
      if (startHour >= 20 || startHour < 6) {
        sleepByDay[d].night += dur;
      } else {
        sleepByDay[d].day += dur;
      }
      sleepByDay[d].records.push(r);
    });

    var sleepDates = Object.keys(sleepByDay).sort();

    html += '<canvas id="sleepChart" width="360" height="200" style="width:100%;max-width:420px"></canvas>';
    html += '<div style="text-align:center;font-size:11px;color:var(--text-light);margin:4px 0 10px">点击柱子查看当天详情</div>';

    window._sleepChartData = { dates: sleepDates, data: sleepByDay };
  } else {
    html += '<div class="record-empty">暂无睡眠数据</div>';
  }
  html += '</div>';

  // Diaper stats
  var allDiaperRecords = records.filter(function(r) { return r.type === 'diaper'; }).sort(function(a, b) { return b.timestamp - a.timestamp; });
  html += '<div class="chart-container"><div class="chart-title">尿布统计</div>';

  var diaperRange = range;
  var diaperRecords = allDiaperRecords.filter(function(r) {
    return r.timestamp >= diaperRange.start && r.timestamp <= diaperRange.end;
  });

  if (diaperRecords.length > 0) {
    // Group by date
    var diaperByDate = {};
    diaperRecords.forEach(function(r) {
      var d = formatDate(r.timestamp);
      if (!diaperByDate[d]) diaperByDate[d] = { pee: 0, poop: 0, total: 0, records: [] };
      var dt = r.diaper_type || '';
      if (dt === '小便') diaperByDate[d].pee += 1;
      else if (dt === '大便') diaperByDate[d].poop += 1;
      diaperByDate[d].total += 1;
      diaperByDate[d].records.push(r);
    });
    var diaperDates = Object.keys(diaperByDate).sort(function(a, b) { return a.localeCompare(b); });

    // Bar chart
    html += '<canvas id="diaperChart" width="320" height="180" style="width:100%;max-width:420px"></canvas>';
    html += '<div style="text-align:center;font-size:11px;color:var(--text-light);margin:4px 0 10px">点击柱子查看当天详情</div>';

    // Store for chart drawing
    window._diaperChartData = { dates: diaperDates, data: diaperByDate };
  } else {
    html += '<div class="record-empty">暂无尿布数据</div>';
    window._diaperChartData = null;
  }
  html += '</div>';

  // ---------- Formula cost: monthly trend (last 6 months, per can ¥369) ----------
  var now = new Date();
  var allCans = getFormulaCans();
  var monthly = [];
  for (var mi = 5; mi >= 0; mi--) {
    var md = new Date(now.getFullYear(), now.getMonth() - mi, 1);
    var my = md.getFullYear();
    var mo = md.getMonth() + 1;
    var prefix = my + '-' + mo.toString().padStart(2, '0');
    var cnt = allCans.filter(function(c) { return c.date.indexOf(prefix) === 0; }).length;
    monthly.push({ key: prefix, month: mo, monthLabel: mo + '月', count: cnt, cost: cnt * 369, isCurrent: (mo === now.getMonth() + 1 && my === now.getFullYear()) });
  }
  var hasAnyFormula = monthly.some(function(m) { return m.count > 0; });
  window._formulaMonthlyData = monthly;

  html += '<div class="chart-container"><div class="chart-title">奶粉费用月度趋势</div>';
  html += '<div style="text-align:center;font-size:11px;color:var(--text-light);margin-bottom:6px">按开罐数 × ¥369/罐（680g）计算</div>';
  if (hasAnyFormula) {
    html += '<canvas id="formulaMonthlyChart" width="320" height="180" style="width:100%;max-width:420px"></canvas>';
    html += '<div style="margin-top:10px">';
    monthly.forEach(function(m) {
      html += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">' +
        '<span>' + m.monthLabel + (m.isCurrent ? '（本月）' : '') + '</span>' +
        '<span style="font-weight:600">' + m.count + '罐 · <span style="color:var(--pink)">¥' + m.cost + '</span></span></div>';
    });
    html += '</div>';
    if (monthly[monthly.length - 1].count === 0) {
      html += '<div style="text-align:center;font-size:11px;color:var(--text-light);margin-top:6px">本月暂未开罐，费用为 0</div>';
    }
  } else {
    html += '<div class="stat-empty">暂无开罐记录</div>';
  }
  html += '</div>';

  // ---------- Formula cost: daily cost within selected range ----------
  var formulaCostByDay = {};
  var formulaDateSet = {};
  records.forEach(function(r) {
    if (r.type === 'milk') {
      var d = formatDate(r.timestamp);
      formulaDateSet[d] = true;
      if (!formulaCostByDay[d]) formulaCostByDay[d] = { total: 0, records: [] };
      var cost = (r.amount || 0) / 30 * FORMULA_COST_PER_30ML;
      formulaCostByDay[d].total += cost;
      formulaCostByDay[d].records.push(r);
    }
  });
  var formulaDays = Object.keys(formulaDateSet).sort(function(a, b) { return a.localeCompare(b); });

  var formulaFilteredDays = formulaDays.filter(function(d) {
    var ts = new Date(d + 'T00:00:00').getTime();
    return ts >= range.start && ts <= range.end;
  });
  var hasFormulaCost = formulaFilteredDays.length > 0;

  var formulaRangeTotal = 0;
  formulaFilteredDays.forEach(function(d) { formulaRangeTotal += formulaCostByDay[d].total; });

  html += '<div class="chart-container"><div class="chart-title">' + rangeLabel + '每日奶粉费用</div>';
  if (hasFormulaCost) {
    html += '<canvas id="formulaCostChart" width="320" height="180" style="width:100%;max-width:420px"></canvas>';
    html += '<div style="text-align:center;font-size:11px;color:var(--text-light);margin-top:4px">点击柱子查看当天详情</div>';
    html += '<div style="text-align:center;padding:6px 0;font-size:15px;font-weight:700;color:var(--pink)">' + rangeLabel + '奶粉费用 ¥' + formulaRangeTotal.toFixed(2) + '</div>';
    window._formulaCostChartData = { dates: formulaFilteredDays, data: formulaCostByDay, monthTotal: formulaRangeTotal };
  } else {
    html += '<div class="stat-empty">区间内暂无奶粉数据</div>';
    window._formulaCostChartData = null;
  }
  html += '</div>';

  // ---------- Feeding pattern (follows selected range) ----------
  var milkInRange = records.filter(function(r) { return r.type === 'milk' && r.timestamp >= range.start && r.timestamp <= range.end; }).sort(function(a, b) { return a.timestamp - b.timestamp; });
  var totalMilk = 0;
  milkInRange.forEach(function(r) { totalMilk += (r.amount || 0); });
  var feedCount = milkInRange.length;
  var hasFeed = feedCount > 0;
  var rangeDayCount = Math.max(1, Math.round((range.end - range.start) / 86400000) + 1);
  var avgDaily = hasFeed ? totalMilk / rangeDayCount : 0;
  var avgDailyCount = hasFeed ? feedCount / rangeDayCount : 0;
  var avgPerFeed = hasFeed ? totalMilk / feedCount : 0;
  var avgInterval = null;
  if (feedCount >= 2) {
    var totalGap = 0;
    for (var gi = 1; gi < feedCount; gi++) {
      totalGap += milkInRange[gi].timestamp - milkInRange[gi - 1].timestamp;
    }
    avgInterval = totalGap / (feedCount - 1) / 3600000;
  }

  html += '<div class="chart-container"><div class="chart-title">喂养规律</div>';
  if (hasFeed) {
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:4px 0">';
    html += '<div style="background:var(--bg);border-radius:12px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:700;color:var(--pink)">' + Math.round(avgDaily) + ' ml</div><div style="font-size:11px;color:var(--text-light)">日均奶量</div></div>';
    html += '<div style="background:var(--bg);border-radius:12px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:700;color:var(--pink)">' + avgDailyCount.toFixed(1) + ' 次/天</div><div style="font-size:11px;color:var(--text-light)">日均喂养次数</div></div>';
    html += '<div style="background:var(--bg);border-radius:12px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:700;color:var(--pink)">' + (avgInterval !== null ? avgInterval.toFixed(1) : '--') + ' h</div><div style="font-size:11px;color:var(--text-light)">平均喂养间隔</div></div>';
    html += '<div style="background:var(--bg);border-radius:12px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:700;color:var(--pink)">' + Math.round(avgPerFeed) + ' ml</div><div style="font-size:11px;color:var(--text-light)">单次平均奶量</div></div>';
    html += '</div>';
  } else {
    html += '<div class="stat-empty">' + rangeLabel + '暂无奶量记录，无法统计喂养规律</div>';
  }
  html += '</div>';

  // Weight chart
  html += '<div class="chart-container"><div class="chart-title">体重变化</div>';
  html += bmiText;
  var weightData = hwChartData.filter(function(d) { return d.weight !== undefined; });
  if (weightData.length >= 2) {
    html += '<canvas id="weightChart" width="320" height="180" style="width:100%;max-width:420px"></canvas>';
  } else if (weightData.length === 1) {
    html += '<div style="text-align:center;padding:16px;font-size:15px;">体重: ' + weightData[0].weight + '斤<br><span style="font-size:12px;color:var(--text-light)">至少需要2条记录才能绘制趋势图</span></div>';
  } else {
    html += '<div class="stat-empty">暂无体重数据</div>';
  }
  html += '</div>';

  // Height chart
  html += '<div class="chart-container"><div class="chart-title">身高变化</div>';
  var heightData = hwChartData.filter(function(d) { return d.height !== undefined; });
  if (heightData.length >= 2) {
    html += '<canvas id="heightChart" width="320" height="180" style="width:100%;max-width:420px"></canvas>';
  } else if (heightData.length === 1) {
    html += '<div style="text-align:center;padding:16px;font-size:15px;">身高: ' + heightData[0].height + 'cm<br><span style="font-size:12px;color:var(--text-light)">至少需要2条记录才能绘制趋势图</span></div>';
  } else {
    html += '<div class="stat-empty">暂无身高数据</div>';
  }
  html += '</div>';

  // WHO 成长曲线
  var whoGender = getSettings().babyGender || 'boy';
  var whoGenderLabel = whoGender === 'girl' ? '女孩' : '男孩';
  var whoBtn = function(g, lbl) {
    var sel = whoGender === g;
    return '<button onclick="setBabyGender(\'' + g + '\')" style="' +
      (sel ? 'background:var(--pink);color:#fff;' : 'background:var(--card);color:var(--text);border:1px solid var(--border);') +
      'padding:5px 14px;border-radius:14px;font-size:12px;cursor:pointer">' + lbl + '</button>';
  };
  var whoHead = function(title) {
    return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
      '<div class="chart-title" style="margin:0">' + title + '</div>' +
      '<div style="display:flex;gap:6px">' + whoBtn('boy', '男孩') + whoBtn('girl', '女孩') + '</div></div>';
  };
  html += '<div class="chart-container">' + whoHead('身高成长曲线 (WHO)') +
    '<canvas id="heightWhoChart" width="320" height="220" style="width:100%;max-width:420px"></canvas>' +
    '<div style="font-size:11px;color:var(--text-light);padding-top:6px">参考：WHO 标准 P3/P50/P97（' + whoGenderLabel + '）</div></div>';
  html += '<div class="chart-container">' + whoHead('体重成长曲线 (WHO)') +
    '<canvas id="weightWhoChart" width="320" height="220" style="width:100%;max-width:420px"></canvas>' +
    '<div style="font-size:11px;color:var(--text-light);padding-top:6px">参考：WHO 标准 P3/P50/P97（' + whoGenderLabel + '）· 体重 kg（记录为斤，自动换算）</div></div>';

  // Haircut records
  var haircutRecords = records.filter(function(r) { return r.type === 'custom' && r.subtype === '理发'; }).sort(function(a, b) { return b.timestamp - a.timestamp; });
  html += '<div class="chart-container"><div class="chart-title">理发记录</div>';
  if (haircutRecords.length > 0) {
    html += '<div style="padding:4px 0">';
    haircutRecords.forEach(function(r) {
      var noteHtml = r.note ? ' <span style="font-size:12px;color:var(--text-light)">(' + escapeHtml(r.note) + ')</span>' : '';
      html += '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px"><span>' + formatDate(r.timestamp) + ' ' + formatTime(r.timestamp) + '</span><span style="color:var(--text-light);font-size:12px">理发' + noteHtml + '</span></div>';
    });
    html += '</div>';
  } else {
    html += '<div class="stat-empty">暂无理发记录</div>';
  }
  html += '</div>';

  container.innerHTML = html;

  if (hasMilk) drawMilkChart(days, milkValues, maxMilk);
  if (window._diaperChartData) drawDiaperChart(window._diaperChartData);
  if (window._formulaCostChartData) drawFormulaCostChart(window._formulaCostChartData);
  if (window._formulaMonthlyData) drawFormulaMonthlyChart();
  if (window._sleepChartData) drawSleepChart(window._sleepChartData);
  if (heightData.length >= 2) drawSingleMetricChart('heightChart', heightData, 'height', '#FF6B8A', '身高(cm)');
  if (weightData.length >= 2) drawSingleMetricChart('weightChart', weightData, 'weight', '#5BA4CF', '体重(斤)');
  drawWhoChart('heightWhoChart', 'height', whoGender);
  drawWhoChart('weightWhoChart', 'weight', whoGender);
}

function drawMilkChart(days, values, max) {
  var canvas = document.getElementById('milkChart');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 180 * dpr;
  ctx.scale(dpr, dpr);
  canvas.style.height = '180px';

  var w = rect.width;
  var h = 180;
  var pad = { top: 16, right: 12, bottom: 28, left: 40 };
  var cw = w - pad.left - pad.right;
  var ch = h - pad.top - pad.bottom;
  var barW = Math.max(2, Math.min(32, cw / days.length * 0.6));
  var gap = Math.max(1, (cw - barW * days.length) / (days.length + 1));

  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = getChartTheme().grid;
  ctx.lineWidth = 1;
  var gridLines = 4;
  for (var i = 0; i <= gridLines; i++) {
    var y = pad.top + (ch / gridLines) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();

    ctx.fillStyle = getChartTheme().axis;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round((max / gridLines) * (gridLines - i)), pad.left - 6, y + 4);
  }

  // Store bar positions for click detection
  window._milkBarPositions = [];

  days.forEach(function(d, i) {
    var val = values[i];
    var barH = val / max * ch;
    var x = pad.left + gap + i * (barW + gap);
    var y = pad.top + ch - barH;

    var gradient = ctx.createLinearGradient(x, y, x, pad.top + ch);
    gradient.addColorStop(0, '#FF9AA2');
    gradient.addColorStop(1, '#FFB7B2');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, [4, 4, 0, 0]);
    ctx.fill();

    // Cursor hint - make bars clickable
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(x - 4, pad.top, barW + 8, ch);

    if (val > 0) {
      ctx.fillStyle = getChartTheme().title;
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(val, x + barW / 2, y - 4);
    }

    ctx.fillStyle = getChartTheme().axis;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    var showLabel = days.length <= 10 || (i % Math.ceil(days.length / 8) === 0) || i === days.length - 1;
    if (showLabel) {
      var dateLabel = (parseInt(d.slice(8, 10), 10)) + '日';
      ctx.fillText(dateLabel, x + barW / 2, pad.top + ch + 18);
    }

    // Store position
    window._milkBarPositions.push({ date: d, x: x, w: barW });
  });

  // Add click handler
  canvas.style.cursor = 'pointer';
  canvas.onclick = function(e) {
    var cr = canvas.getBoundingClientRect();
    var clickX = e.clientX - cr.left;
    var clickY = e.clientY - cr.top;
    var bars = window._milkBarPositions;
    if (!bars) return;
    for (var j = 0; j < bars.length; j++) {
      var b = bars[j];
      if (clickX >= b.x - 6 && clickX <= b.x + b.w + 6) {
        showDayMilkDetail(b.date);
        return;
      }
    }
  };
}

function showDayMilkDetail(dateStr) {
  // Remove existing detail popup if any
  var existing = document.getElementById('milkDetailPopup');
  if (existing) existing.remove();

  var records = getRecords();
  var dayRecords = records.filter(function(r) {
    return r.type === 'milk' && formatDate(r.timestamp) === dateStr;
  }).sort(function(a, b) { return a.timestamp - b.timestamp; });

  var d = new Date(dateStr + 'T00:00:00');
  var title = (d.getMonth() + 1) + '月' + d.getDate() + '日 奶量详情';

  var html = '<div class="modal-overlay show" id="milkDetailPopup" onclick="closeMilkDetail(event)">' +
    '<div class="modal-box" style="max-height:70vh;overflow-y:auto" onclick="event.stopPropagation()">' +
    '<h3 style="margin-bottom:12px">' + title + '</h3>';

  if (dayRecords.length === 0) {
    html += '<div style="text-align:center;padding:20px;color:var(--text-light)">当天无奶量记录</div>';
  } else {
    var totalDay = 0;
    html += '<table style="width:100%;font-size:13px;border-collapse:collapse">';
    html += '<thead><tr style="border-bottom:2px solid var(--border);text-align:left;color:var(--text-light);font-size:11px"><th style="padding:8px 4px">时间</th><th style="padding:8px 4px">奶量</th><th style="padding:8px 4px">备注</th><th style="padding:8px 4px">操作</th></tr></thead><tbody>';
    dayRecords.forEach(function(r) {
      totalDay += (r.amount || 0);
      html += '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:8px 4px;white-space:nowrap">' + formatTime(r.timestamp) + '</td>' +
        '<td style="padding:8px 4px;font-weight:600;color:var(--pink)">' + (r.amount || 0) + ' ml</td>' +
        '<td style="padding:8px 4px;color:var(--text-light);font-size:12px">' + (r.note || '') + '</td>' +
        '<td style="padding:8px 4px;white-space:nowrap"><button class="tl-edit-btn" title="编辑" onclick="showEditRecord(\'' + r.id + '\')">✎</button></td>' +
        '</tr>';
    });
    html += '<tr style="font-weight:700;border-top:2px solid var(--border)">' +
      '<td style="padding:10px 4px">当日合计</td>' +
      '<td style="padding:10px 4px;color:var(--pink)">' + totalDay + ' ml</td>' +
      '<td></td><td></td></tr>';
    html += '</tbody></table>';
  }

  html += '<div class="btn-row" style="margin-top:16px">' +
    '<button class="btn-confirm" onclick="document.getElementById(\'milkDetailPopup\').remove()" style="flex:1;padding:10px;border-radius:20px;font-size:14px;border:none;background:var(--pink);color:#fff;cursor:pointer">关闭</button>' +
    '</div></div></div>';

  document.body.insertAdjacentHTML('beforeend', html);
}

function closeMilkDetail(e) {
  if (e && e.target !== document.getElementById('milkDetailPopup')) return;
  var el = document.getElementById('milkDetailPopup');
  if (el) el.remove();
}

function drawDiaperChart(chartData) {
  var canvas = document.getElementById('diaperChart');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 180 * dpr;
  ctx.scale(dpr, dpr);
  canvas.style.height = '180px';

  var w = rect.width;
  var h = 180;
  var pad = { top: 16, right: 12, bottom: 28, left: 40 };
  var cw = w - pad.left - pad.right;
  var ch = h - pad.top - pad.bottom;

  var dates = chartData.dates;
  var data = chartData.data;
  var barW = Math.max(2, Math.min(32, cw / dates.length * 0.6));
  var gap = Math.max(1, (cw - barW * dates.length) / (dates.length + 1));

  // Find max total for scale
  var maxTotal = 0;
  dates.forEach(function(d) { if (data[d].total > maxTotal) maxTotal = data[d].total; });
  if (maxTotal === 0) maxTotal = 1;

  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = getChartTheme().grid;
  ctx.lineWidth = 1;
  var gridLines = 4;
  for (var i = 0; i <= gridLines; i++) {
    var y = pad.top + (ch / gridLines) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = getChartTheme().axis;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round((maxTotal / gridLines) * (gridLines - i)), pad.left - 6, y + 4);
  }

  window._diaperBarPositions = [];

  dates.forEach(function(d, i) {
    var val = data[d].total;
    var barH = val / maxTotal * ch;
    var x = pad.left + gap + i * (barW + gap);
    var y = pad.top + ch - barH;

    var gradient = ctx.createLinearGradient(x, y, x, pad.top + ch);
    gradient.addColorStop(0, '#FF9AA2');
    gradient.addColorStop(1, '#FFB7B2');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, [4, 4, 0, 0]);
    ctx.fill();

    // Cursor hint - make bars clickable
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(x - 4, pad.top, barW + 8, ch);

    if (val > 0) {
      ctx.fillStyle = getChartTheme().title;
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(val, x + barW / 2, y - 4);
    }

    ctx.fillStyle = getChartTheme().axis;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    var showLabel = dates.length <= 10 || (i % Math.ceil(dates.length / 8) === 0) || i === dates.length - 1;
    if (showLabel) {
      var dateLabel = (parseInt(d.slice(8, 10), 10)) + '日';
      ctx.fillText(dateLabel, x + barW / 2, pad.top + ch + 18);
    }

    window._diaperBarPositions.push({ date: d, x: x, w: barW });
  });

  canvas.style.cursor = 'pointer';
  canvas.onclick = function(e) {
    var cr = canvas.getBoundingClientRect();
    var clickX = e.clientX - cr.left;
    var clickY = e.clientY - cr.top;
    var bars = window._diaperBarPositions;
    if (!bars) return;
    for (var j = 0; j < bars.length; j++) {
      var b = bars[j];
      if (clickX >= b.x - 6 && clickX <= b.x + b.w + 6) {
        showDayDiaperDetail(b.date);
        return;
      }
    }
  };
}

function showDayDiaperDetail(dateStr) {
  var existing = document.getElementById('diaperDetailPopup');
  if (existing) existing.remove();

  var records = getRecords();
  var dayRecords = records.filter(function(r) {
    return r.type === 'diaper' && formatDate(r.timestamp) === dateStr;
  }).sort(function(a, b) { return a.timestamp - b.timestamp; });

  var d = new Date(dateStr + 'T00:00:00');
  var title = (d.getMonth() + 1) + '月' + d.getDate() + '日 尿布详情';

  var html = '<div class="modal-overlay show" id="diaperDetailPopup" onclick="closeDiaperDetail(event)">' +
    '<div class="modal-box" style="max-height:70vh;overflow-y:auto" onclick="event.stopPropagation()">' +
    '<h3 style="margin-bottom:12px">' + title + '</h3>';

  if (dayRecords.length === 0) {
    html += '<div style="text-align:center;padding:20px;color:var(--text-light)">当天无尿布记录</div>';
  } else {
    html += '<table style="width:100%;font-size:13px;border-collapse:collapse">';
    html += '<thead><tr style="border-bottom:2px solid var(--border);text-align:left;color:var(--text-light);font-size:11px"><th style="padding:8px 4px">时间</th><th style="padding:8px 4px">类型</th><th style="padding:8px 4px">备注</th><th style="padding:8px 4px">操作</th></tr></thead><tbody>';
    dayRecords.forEach(function(r) {
      var dt = r.diaper_type || '尿布';
      var icon = dt === '小便' ? '💧' : (dt === '大便' ? '💩' : '🧷');
      html += '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:8px 4px;white-space:nowrap">' + formatTime(r.timestamp) + '</td>' +
        '<td style="padding:8px 4px;font-weight:600;color:var(--pink)">' + icon + ' ' + dt + '</td>' +
        '<td style="padding:8px 4px;color:var(--text-light);font-size:12px">' + (r.note || '') + '</td>' +
        '<td style="padding:8px 4px;white-space:nowrap"><button class="tl-edit-btn" title="编辑" onclick="showEditRecord(\'' + r.id + '\')">✎</button></td>' +
        '</tr>';
    });
    html += '</tbody></table>';
  }

  html += '<div class="btn-row" style="margin-top:16px">' +
    '<button class="btn-confirm" onclick="document.getElementById(\'diaperDetailPopup\').remove()" style="flex:1;padding:10px;border-radius:20px;font-size:14px;border:none;background:var(--pink);color:#fff;cursor:pointer">关闭</button>' +
    '</div></div></div>';

  document.body.insertAdjacentHTML('beforeend', html);
}

function closeDiaperDetail(e) {
  if (e && e.target !== document.getElementById('diaperDetailPopup')) return;
  var el = document.getElementById('diaperDetailPopup');
  if (el) el.remove();
}

function drawSleepChart(chartData) {
  var canvas = document.getElementById('sleepChart');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 200 * dpr;
  ctx.scale(dpr, dpr);
  canvas.style.height = '200px';

  var w = rect.width;
  var h = 200;
  var pad = { top: 16, right: 12, bottom: 32, left: 44 };
  var cw = w - pad.left - pad.right;
  var ch = h - pad.top - pad.bottom;

  var dates = chartData.dates;
  var data = chartData.data;
  var barW = Math.max(2, Math.min(32, cw / dates.length * 0.6));
  var gap = Math.max(1, (cw - barW * dates.length) / (dates.length + 1));

  // Compute max total hours per day for scale (round up to nearest 0.5h)
  var maxTotalH = 0;
  dates.forEach(function(d) {
    var t = (data[d].night + data[d].day) / 3600000;
    if (t > maxTotalH) maxTotalH = t;
  });
  if (maxTotalH === 0) maxTotalH = 12;
  maxTotalH = Math.ceil(maxTotalH * 2) / 2;

  ctx.clearRect(0, 0, w, h);

  // Grid lines (Y axis: hours, step 1h or 2h)
  var gridStep = maxTotalH <= 12 ? 2 : 4;
  var gridLines = Math.floor(maxTotalH / gridStep);
  ctx.strokeStyle = getChartTheme().grid;
  ctx.lineWidth = 1;
  for (var i = 0; i <= gridLines; i++) {
    var val = gridStep * i;
    var y = pad.top + ch - (val / maxTotalH) * ch;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = getChartTheme().axis;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(val + 'h', pad.left - 6, y + 4);
  }

  // Store bar positions for click
  window._sleepBarPositions = [];

  dates.forEach(function(d, i) {
    var nightH = data[d].night / 3600000;
    var dayH = data[d].day / 3600000;
    var totalH = nightH + dayH;
    var x = pad.left + gap + i * (barW + gap);
    var barTop = pad.top + ch - (totalH / maxTotalH) * ch;
    var nightBarH = (nightH / maxTotalH) * ch;
    var dayBarH = (dayH / maxTotalH) * ch;

    // Night sleep (bottom)
    if (nightH > 0) {
      ctx.fillStyle = '#7B68EE';
      var ny = pad.top + ch - nightBarH;
      ctx.beginPath();
      if (dayH <= 0) {
        ctx.roundRect(x, barTop, barW, nightBarH, [4, 4, 4, 4]);
      } else {
        ctx.roundRect(x, ny, barW, nightBarH, [0, 0, 0, 0]);
      }
      ctx.fill();
    }

    // Day sleep (top)
    if (dayH > 0) {
      ctx.fillStyle = '#FF8C00';
      var dy = pad.top + ch - nightBarH - dayBarH;
      ctx.beginPath();
      if (nightH <= 0) {
        ctx.roundRect(x, barTop, barW, dayBarH, [4, 4, 4, 4]);
      } else {
        ctx.roundRect(x, dy, barW, dayBarH, [4, 4, 0, 0]);
      }
      ctx.fill();
    }

    // Duration labels inside bars
    function fmtHM(ms) { var hh = Math.floor(ms / 3600000); var mm = Math.floor((ms % 3600000) / 60000); return hh + 'h' + mm + 'm'; }
    ctx.textAlign = 'center';
    ctx.font = '9px sans-serif';
    if (dayH > 0) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(fmtHM(data[d].day), x + barW / 2, dy + dayBarH / 2 + 3);
    }
    if (nightH > 0) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(fmtHM(data[d].night), x + barW / 2, ny + nightBarH / 2 + 3);
    }

    // Date label (M/D)
    ctx.fillStyle = getChartTheme().axis;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    var showLabel = dates.length <= 10 || (i % Math.ceil(dates.length / 8) === 0) || i === dates.length - 1;
    if (showLabel) {
      var parts = d.split('-');
      var label = parseInt(parts[1], 10) + '/' + parseInt(parts[2], 10);
      ctx.fillText(label, x + barW / 2, pad.top + ch + 16);
    }

    window._sleepBarPositions.push({ date: d, x: x, w: barW });
  });

  // Legend
  var legX = pad.left;
  var legY = pad.top + ch + 24;
  ctx.fillStyle = '#7B68EE';
  ctx.fillRect(legX, legY, 10, 10);
  ctx.fillStyle = getChartTheme().axis;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('夜间', legX + 14, legY + 9);

  ctx.fillStyle = '#FF8C00';
  ctx.fillRect(legX + 50, legY, 10, 10);
  ctx.fillStyle = getChartTheme().axis;
  ctx.fillText('白天', legX + 64, legY + 9);

  // Click handler
  canvas.style.cursor = 'pointer';
  canvas.onclick = function(e) {
    var cr = canvas.getBoundingClientRect();
    var clickX = e.clientX - cr.left;
    var bars = window._sleepBarPositions;
    if (!bars) return;
    for (var j = 0; j < bars.length; j++) {
      var b = bars[j];
      if (clickX >= b.x - 6 && clickX <= b.x + b.w + 6) {
        showDaySleepDetail(b.date);
        return;
      }
    }
  };
}

function showDaySleepDetail(dateStr) {
  var existing = document.getElementById('sleepDetailPopup');
  if (existing) existing.remove();

  var records = getRecords();
  var dayRecords = records.filter(function(r) {
    var ts = r.sleep_start || r.timestamp;
    return r.type === 'sleep' && formatDate(ts) === dateStr;
  }).sort(function(a, b) { return (a.sleep_start || a.timestamp) - (b.sleep_start || b.timestamp); });

  var d = new Date(dateStr + 'T00:00:00');
  var title = (d.getMonth() + 1) + '月' + d.getDate() + '日 睡眠详情';

  var html = '<div class="modal-overlay show" id="sleepDetailPopup" onclick="closeSleepDetail(event)">' +
    '<div class="modal-box" style="max-height:70vh;overflow-y:auto" onclick="event.stopPropagation()">' +
    '<h3 style="margin-bottom:12px">' + title + '</h3>';

  if (dayRecords.length === 0) {
    html += '<div style="text-align:center;padding:20px;color:var(--text-light)">当天无睡眠记录</div>';
  } else {
    var totalDay = 0;
    html += '<table style="width:100%;font-size:13px;border-collapse:collapse">';
    html += '<thead><tr style="border-bottom:2px solid var(--border);text-align:left;color:var(--text-light);font-size:11px"><th style="padding:8px 4px">时间</th><th style="padding:8px 4px">时长</th><th style="padding:8px 4px">类型</th></tr></thead><tbody>';
    dayRecords.forEach(function(r) {
      var startTs = r.sleep_start || r.timestamp;
      var endTs = r.sleep_end;
      var dur = (endTs && startTs && endTs > startTs) ? (endTs - startTs) : 0;
      totalDay += dur;
      var sh = Math.floor(dur / 3600000);
      var sm = Math.floor((dur % 3600000) / 60000);
      var durStr = dur > 0 ? sh + 'h' + sm + 'm' : '--';

      var startHour = new Date(startTs).getHours();
      var isNight = (startHour >= 20 || startHour < 6);
      var typeTag = isNight ? '夜间' : '白天';
      var tagColor = isNight ? '#7B68EE' : '#FF8C00';

      html += '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:8px 4px;white-space:nowrap">' + formatTime(startTs) + '~' + (endTs ? formatTime(endTs) : '--') + '</td>' +
        '<td style="padding:8px 4px;font-weight:600;color:var(--pink)">' + durStr + '</td>' +
        '<td style="padding:8px 4px"><span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;background:' + tagColor + '18;color:' + tagColor + '">' + typeTag + '</span></td>' +
        '</tr>';
    });
    var totalH = Math.floor(totalDay / 3600000);
    var totalM = Math.floor((totalDay % 3600000) / 60000);
    html += '<tr style="font-weight:700;border-top:2px solid var(--border)">' +
      '<td style="padding:10px 4px">当日合计</td>' +
      '<td style="padding:10px 4px;color:var(--pink)" colspan="2">' + totalH + 'h' + totalM + 'm</td>' +
      '</tr>';
    html += '</tbody></table>';
  }

  html += '<div class="btn-row" style="margin-top:16px">' +
    '<button class="btn-confirm" onclick="document.getElementById(\'sleepDetailPopup\').remove()" style="flex:1;padding:10px;border-radius:20px;font-size:14px;border:none;background:var(--pink);color:#fff;cursor:pointer">关闭</button>' +
    '</div></div></div>';

  document.body.insertAdjacentHTML('beforeend', html);
}

function closeSleepDetail(e) {
  if (e && e.target !== document.getElementById('sleepDetailPopup')) return;
  var el = document.getElementById('sleepDetailPopup');
  if (el) el.remove();
}

function drawSingleMetricChart(canvasId, data, metricKey, color, label) {
  var canvas = document.getElementById(canvasId);
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 180 * dpr;
  ctx.scale(dpr, dpr);
  canvas.style.height = '180px';

  var w = rect.width;
  var h = 180;
  var pad = { top: 16, right: 12, bottom: 32, left: 52 };

  data = data.slice(-12);

  var vals = data.filter(function(d) { return d[metricKey] !== undefined; }).map(function(d) { return d[metricKey]; });
  if (vals.length < 2) return;
  var minVal = Math.floor(Math.min.apply(null, vals) * 0.9);
  var maxVal = Math.ceil(Math.max.apply(null, vals) * 1.1);
  if (maxVal === minVal) { maxVal = minVal + 10; minVal = Math.max(0, minVal - 10); }

  var cw = w - pad.left - pad.right;
  var ch = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = getChartTheme().grid;
  ctx.lineWidth = 1;
  var gridLines = 4;
  for (var i = 0; i <= gridLines; i++) {
    var y = pad.top + (ch / gridLines) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = getChartTheme().axis;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(((maxVal - (maxVal - minVal) / gridLines * i)).toFixed(1), pad.left - 6, y + 3);
  }

  var xGap = cw / Math.max(data.length - 1, 1);
  for (var j = 0; j < data.length; j++) {
    var r = data[j];
    var x = pad.left + j * xGap;
    ctx.fillStyle = getChartTheme().axis;
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(formatDate(r.timestamp).slice(5), x, pad.top + ch + 16);
  }

  var points = [];
  for (var k = 0; k < data.length; k++) {
    if (data[k][metricKey] !== undefined) {
      points.push({ x: pad.left + k * xGap, y: pad.top + ch - (data[k][metricKey] - minVal) / (maxVal - minVal) * ch, val: data[k][metricKey] });
    }
  }
  drawLine(ctx, points, color, label);

  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = getChartTheme().title;
  ctx.textAlign = 'center';
  ctx.fillText(label, pad.left + cw / 2, 14);
}

function drawHWChartV2(data) {
  var canvas = document.getElementById('hwChart');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 180 * dpr;
  ctx.scale(dpr, dpr);
  canvas.style.height = '180px';

  var w = rect.width;
  var h = 180;
  var pad = { top: 16, right: 12, bottom: 32, left: 44 };

  // Limit to 12 data points
  data = data.slice(-12);

  var drawHeight = data.filter(function(d) { return d.height !== undefined; }).length >= 2;
  var drawWeight = data.filter(function(d) { return d.weight !== undefined; }).length >= 2;
  if (!drawHeight && !drawWeight) return;

  var allHVals = data.filter(function(d) { return d.height !== undefined; }).map(function(d) { return d.height; });
  var allWVals = data.filter(function(d) { return d.weight !== undefined; }).map(function(d) { return d.weight; });

  var allVals = allHVals.concat(allWVals);
  if (allVals.length === 0) return;
  var minVal = Math.floor(Math.min.apply(null, allVals) * 0.9);
  var maxVal = Math.ceil(Math.max.apply(null, allVals) * 1.1);
  if (maxVal === minVal) { maxVal = minVal + 10; minVal = Math.max(0, minVal - 10); }

  var cw = w - pad.left - pad.right;
  var ch = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = getChartTheme().grid;
  ctx.lineWidth = 1;
  var gridLines = 4;
  for (var i = 0; i <= gridLines; i++) {
    var y = pad.top + (ch / gridLines) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();

    ctx.fillStyle = getChartTheme().axis;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(((maxVal - (maxVal - minVal) / gridLines * i)).toFixed(1), pad.left - 6, y + 3);
  }

  var xGap = cw / Math.max(data.length - 1, 1);
  for (var j = 0; j < data.length; j++) {
    var r = data[j];
    var x = pad.left + j * xGap;
    ctx.fillStyle = getChartTheme().axis;
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(formatDate(r.timestamp).slice(5), x, pad.top + ch + 16);
  }

  if (drawHeight) {
    var hPoints = [];
    for (var k1 = 0; k1 < data.length; k1++) {
      if (data[k1].height !== undefined) {
        hPoints.push({ x: pad.left + k1 * xGap, y: pad.top + ch - (data[k1].height - minVal) / (maxVal - minVal) * ch, val: data[k1].height });
      }
    }
    drawLine(ctx, hPoints, '#FF6B8A', '身高(cm)');
  }

  if (drawWeight) {
    var wPoints = [];
    for (var k2 = 0; k2 < data.length; k2++) {
      if (data[k2].weight !== undefined) {
        wPoints.push({ x: pad.left + k2 * xGap, y: pad.top + ch - (data[k2].weight - minVal) / (maxVal - minVal) * ch, val: data[k2].weight });
      }
    }
    drawLine(ctx, wPoints, '#5BA4CF', '体重(斤)');
  }

  ctx.font = '11px sans-serif';
  var legendY = pad.top + 4;
  if (drawHeight) {
    ctx.fillStyle = '#FF6B8A';
    ctx.fillText('● 身高(cm)', pad.left, legendY);
  }
  if (drawWeight) {
    ctx.fillStyle = '#5BA4CF';
    ctx.fillText('● 体重(斤)', drawHeight ? pad.left + 100 : pad.left, legendY);
  }
}

function monthAgeOf(ts) {
  var birth = new Date(BIRTH_DATE + 'T00:00:00').getTime();
  return Math.max(0, (ts - birth) / (30.4375 * 24 * 3600 * 1000));
}

function setBabyGender(g) {
  if (g !== 'boy' && g !== 'girl') return;
  var s = getSettings();
  s.babyGender = g;
  saveSettings(s);
  renderStats();
}

// 提取身高(cm)或体重(kg)的按时间排序宝宝数据，用于 WHO 曲线
function getHwDataForWho(metricType) {
  var birth = new Date(BIRTH_DATE + 'T00:00:00').getTime();
  var map = {};
  getRecords().forEach(function(r) {
    var d = formatDate(r.timestamp);
    if (!map[d]) map[d] = { date: d, ts: r.timestamp, height: undefined, weight: undefined };
    if (r.type === 'hw') {
      if (r.height !== undefined) map[d].height = r.height;
      if (r.weight !== undefined) map[d].weight = r.weight;
    } else if (r.type === 'height' && r.height !== undefined) {
      map[d].height = r.height;
    } else if (r.type === 'weight' && r.weight !== undefined) {
      map[d].weight = r.weight;
    }
    if (r.timestamp > map[d].ts) map[d].ts = r.timestamp;
  });
  var arr = [];
  Object.keys(map).sort().forEach(function(k) {
    var item = map[k];
    if (metricType === 'height' && item.height !== undefined) {
      arr.push({ month: Math.max(0, (item.ts - birth) / (30.4375 * 24 * 3600 * 1000)), val: item.height, date: item.date });
    } else if (metricType === 'weight' && item.weight !== undefined) {
      arr.push({ month: Math.max(0, (item.ts - birth) / (30.4375 * 24 * 3600 * 1000)), val: item.weight / 2, date: item.date });
    }
  });
  arr.sort(function(a, b) { return a.month - b.month; });
  return arr;
}

// WHO 成长曲线：叠加宝宝记录 + P3/P50/P97 参考线，标注最近一次测量
function drawWhoChart(canvasId, metricType, gender) {
  var canvas = document.getElementById(canvasId);
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 220 * dpr;
  ctx.scale(dpr, dpr);
  canvas.style.height = '220px';

  var w = rect.width;
  var h = 220;
  var pad = { top: 16, right: 14, bottom: 30, left: 44 };
  var cw = w - pad.left - pad.right;
  var ch = h - pad.top - pad.bottom;
  var maxMonth = 24;

  var who = WHO_GROWTH[gender] ? WHO_GROWTH[gender][metricType] : null;
  if (!who) return;
  var hw = getHwDataForWho(metricType);
  var theme = getChartTheme();

  // 纵轴范围：WHO + 宝宝数据
  var minV = Infinity, maxV = -Infinity;
  who.p3.forEach(function(v) { if (v < minV) minV = v; });
  who.p97.forEach(function(v) { if (v > maxV) maxV = v; });
  hw.forEach(function(d) { if (d.val < minV) minV = d.val; if (d.val > maxV) maxV = d.val; });
  if (!isFinite(minV) || !isFinite(maxV)) { minV = 0; maxV = 1; }
  var span = (maxV - minV) || 1;
  minV = Math.max(0, minV - span * 0.12);
  maxV = maxV + span * 0.12;

  function X(m) { return pad.left + (m / maxMonth) * cw; }
  function Y(v) { return pad.top + ch - ((v - minV) / (maxV - minV)) * ch; }

  ctx.clearRect(0, 0, w, h);

  // 网格 + Y 轴
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  var gridLines = 4;
  for (var i = 0; i <= gridLines; i++) {
    var y = pad.top + (ch / gridLines) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
    ctx.fillStyle = theme.axis;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText((maxV - (maxV - minV) / gridLines * i).toFixed(1), pad.left - 6, y + 3);
  }
  // X 轴刻度（月龄）
  ctx.fillStyle = theme.axis;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  for (var m = 0; m <= maxMonth; m += 3) {
    ctx.fillText(m + '月', X(m), pad.top + ch + 15);
  }

  // WHO P3/P50/P97 参考线
  function drawWhoLine(arr, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(arr === who.p50 ? [] : [4, 3]);
    ctx.beginPath();
    for (var i = 0; i < arr.length; i++) {
      var x = X(i), y = Y(arr[i]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  drawWhoLine(who.p3, 'rgba(160,160,160,0.7)', 1.5);
  drawWhoLine(who.p50, 'rgba(110,110,110,0.95)', 2);
  drawWhoLine(who.p97, 'rgba(160,160,160,0.7)', 1.5);

  // 空态
  if (hw.length === 0) {
    ctx.fillStyle = theme.axis;
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('暂无' + (metricType === 'height' ? '身高' : '体重') + '记录', pad.left + cw / 2, pad.top + ch / 2);
    return;
  }

  var color = metricType === 'height' ? '#FF6B8A' : '#5BA4CF';
  var pts = hw.map(function(d) { return { x: X(d.month), y: Y(d.val), val: d.val, date: d.date, month: d.month }; });

  // 宝宝折线
  if (pts.length >= 2) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach(function(p, i) { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    ctx.stroke();
  }
  // 散点
  pts.forEach(function(p) {
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
  });

  // 最近一次测量标注
  var last = pts[pts.length - 1];
  var label = metricType === 'height' ? (last.val.toFixed(1) + ' cm') : (last.val.toFixed(1) + ' kg');
  var lx = last.x + 6, ly = last.y - 8;
  if (lx + 110 > w - pad.right) lx = last.x - 6 - 110;
  if (ly < pad.top + 8) ly = last.y + 20;
  ctx.fillStyle = color;
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('最近 ' + label, lx, ly);
  ctx.font = '9px sans-serif';
  ctx.fillStyle = theme.axis;
  ctx.fillText(last.date + ' · ' + last.month.toFixed(1) + '月', lx, ly + 11);

  // 图例
  ctx.font = '10px sans-serif';
  ctx.fillStyle = theme.axis;
  ctx.textAlign = 'left';
  ctx.fillText('-- P3/P97    -- P50    ● 宝宝', pad.left, pad.top + ch + 28);
}

function drawLine(ctx, points, color, label) {
  if (points.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (var i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();

  points.forEach(function(p) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.val, p.x, p.y - 8);
  });
}

// ------- Settings -------
function renderSettings() {
  var s = getSettings();
  document.getElementById('notifToggle').checked = s.notifEnabled;
  document.getElementById('intervalSelect').value = s.interval;
  document.getElementById('notifStatus').textContent = s.notifEnabled ? '已开启 · ' + (s.interval / 60) + '小时提醒' : '未开启';
  var themeSel = document.getElementById('themeSelect');
  if (themeSel) themeSel.value = getThemePreference();
  renderFormulaCans();
}

function toggleNotification() {
  var s = getSettings();
  s.notifEnabled = document.getElementById('notifToggle').checked;
  saveSettings(s);

  if (s.notifEnabled) {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(function(perm) {
        if (perm === 'granted') {
          toast('通知已开启', 'success');
        } else {
          s.notifEnabled = false;
          document.getElementById('notifToggle').checked = false;
          saveSettings(s);
          toast('需要允许通知权限才能使用提醒功能', 'warning');
        }
        renderSettings();
      });
    } else if ('Notification' in window && Notification.permission === 'granted') {
      toast('通知已开启', 'success');
    } else if ('Notification' in window && Notification.permission === 'denied') {
      s.notifEnabled = false;
      document.getElementById('notifToggle').checked = false;
      saveSettings(s);
      toast('通知权限已被拒绝，请在浏览器设置中开启', 'warning');
    } else {
      toast('当前浏览器不支持通知', 'warning');
      s.notifEnabled = false;
      document.getElementById('notifToggle').checked = false;
      saveSettings(s);
    }
    renderSettings();
  } else {
    toast('通知已关闭', 'success');
    renderSettings();
  }
}

function updateInterval() {
  var s = getSettings();
  s.interval = parseInt(document.getElementById('intervalSelect').value);
  saveSettings(s);
  toast('提醒间隔已设为 ' + (s.interval / 60) + ' 小时', 'success');
  renderSettings();
}

function exportAll() {
  exportExcel(getRecords(), '全部');
}

function exportLast7() {
  var cutoff = Date.now() - 7 * 86400000;
  var records = getRecords().filter(function(r) { return r.timestamp >= cutoff; });
  exportExcel(records, '近7天');
}

function exportLast30() {
  var cutoff = Date.now() - 30 * 86400000;
  var records = getRecords().filter(function(r) { return r.timestamp >= cutoff; });
  exportExcel(records, '近30天');
}

function exportExcel(records, label) {
  if (records.length === 0) { toast('没有可导出的数据', 'warning'); return; }

  try {
    if (typeof XLSX === 'undefined') {
      toast('Excel 库加载中，请稍后再试', 'warning');
      return;
    }

    var data = records.map(function(r) {
      var row = {
        '日期': formatDate(r.timestamp),
        '时间': formatTime(r.timestamp),
        '类型': getTypeName(r.type),
        '子类型': r.subtype || '',
        '分量': r.portion || '',
        '备注': r.note || ''
      };
      if (r.type === 'milk') {
        row['奶量(ml)'] = r.amount || '';
      } else if (r.type === 'height') {
        row['身高(cm)'] = r.height || '';
      } else if (r.type === 'weight') {
        row['体重(斤)'] = r.weight || '';
      } else if (r.type === 'hw') {
        row['身高(cm)'] = r.height || '';
        row['体重(斤)'] = r.weight || '';
      } else if (r.type === 'sleep') {
        row['入睡时间'] = r.sleep_start ? formatTime(r.sleep_start) : '';
        row['醒来时间'] = r.sleep_end ? formatTime(r.sleep_end) : '';
        if (r.sleep_start && r.sleep_end) {
          var sdur = r.sleep_end - r.sleep_start;
          row['睡眠时长'] = Math.floor(sdur / 3600000) + '小时' + Math.floor((sdur % 3600000) / 60000) + '分钟';
        }
      } else if (r.type === 'poop') {
        row['大便性状'] = r.poop_type || '';
      } else if (r.type === 'diaper') {
        row['尿布类型'] = r.diaper_type || '';
      }
      return row;
    });

    var ws = XLSX.utils.json_to_sheet(data);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '喂养记录');
    XLSX.writeFile(wb, '杨一舟喂养记录_' + formatDate(Date.now()) + '.xlsx');
    toast('导出成功：' + label + ' ' + records.length + ' 条记录', 'success');
  } catch (e) {
    toast('导出失败：' + e.message, 'warning');
  }
}

async function clearAllData() {
  var records = getRecords();
  if (records.length === 0) { toast('没有数据可清空', 'warning'); return; }

  if (confirm('确定要清空所有 ' + records.length + ' 条喂养记录吗？此操作不可恢复！')) {
    try {
      var { error } = await supabase
        .from('feeding_records')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');
      if (error) throw error;
      cachedRecords = [];
      localStorage.removeItem(FORMULA_CANS_KEY);
      toast('所有数据已清空', 'success');
    } catch (e) {
      toast('清空失败: ' + e.message, 'warning');
      return;
    }
    clearInterval(timerInterval);
    timerInterval = null;
    navigateTo('dashboard');
  }
}

// ------- 数据备份 / 导入 -------
function exportBackup() {
  var data = {
    app: 'baby-feeding',
    version: '3.44',
    exportedAt: new Date().toISOString(),
    records: getRecords(),
    formulaCans: getFormulaCans()
  };
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  var d = new Date();
  var p2 = function(n) { return n.toString().padStart(2, '0'); };
  a.download = 'baby-feeding-backup-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(function() { URL.revokeObjectURL(url); a.remove(); }, 1000);
  toast('备份已导出：' + getRecords().length + ' 条记录、' + getFormulaCans().length + ' 条开罐记录', 'success');
}

function importBackupFile() {
  var input = document.getElementById('backupFileInput');
  if (input) input.click();
}

function handleBackupImport(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    var obj = null;
    try {
      obj = JSON.parse(e.target.result);
    } catch (err) {
      toast('备份文件解析失败：不是有效的 JSON', 'warning');
      input.value = '';
      return;
    }
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.records)) {
      toast('备份文件格式无效：缺少 records 数组', 'warning');
      input.value = '';
      return;
    }
    if (obj.formulaCans !== undefined && !Array.isArray(obj.formulaCans)) {
      toast('备份文件格式无效：formulaCans 必须是数组', 'warning');
      input.value = '';
      return;
    }
    var mode = (document.getElementById('backupMode') || {}).value || 'merge';
    importBackupData(obj, mode).then(function() { input.value = ''; });
  };
  reader.readAsText(file);
}

function recordToISO(r) {
  var clean = {};
  for (var k in r) clean[k] = r[k];
  if (typeof clean.timestamp === 'number') clean.timestamp = new Date(clean.timestamp).toISOString();
  if (typeof clean.sleep_start === 'number') clean.sleep_start = new Date(clean.sleep_start).toISOString();
  if (typeof clean.sleep_end === 'number') clean.sleep_end = new Date(clean.sleep_end).toISOString();
  return clean;
}

async function importBackupData(obj, mode) {
  var backupRecords = obj.records.slice();
  var backupCans = Array.isArray(obj.formulaCans) ? obj.formulaCans.slice() : [];
  try {
    if (mode === 'overwrite') {
      if (backupRecords.length === 0) { toast('备份中没有记录可导入', 'warning'); return; }
      // 清空云端后全量导入（保留原 id）
      var { error: delErr } = await supabase.from('feeding_records').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (delErr) throw delErr;
      var ups = backupRecords.map(recordToISO);
      var { data: inserted, error: insErr } = await supabase.from('feeding_records').insert(ups).select();
      if (insErr) throw insErr;
      cachedRecords = normalizeTimestamps(inserted || ups);
      saveFormulaCans(backupCans);
      toast('导入成功：覆盖 ' + cachedRecords.length + ' 条记录、' + backupCans.length + ' 条开罐记录', 'success');
    } else {
      // 合并：按 id 去重，时间戳较新的覆盖旧值
      var merged = cachedRecords.slice();
      var idMap = {};
      var keyMap = {};
      merged.forEach(function(r) {
        if (r.id !== undefined && r.id !== null) idMap[r.id] = r;
        keyMap[(r.timestamp || 0) + '|' + r.type] = true;
      });
      var toSync = [];
      var added = 0, updated = 0;
      backupRecords.forEach(function(br) {
        var bid = br.id;
        if (bid !== undefined && bid !== null && idMap[bid] !== undefined) {
          var local = idMap[bid];
          if ((br.timestamp || 0) > (local.timestamp || 0)) {
            for (var i = 0; i < merged.length; i++) {
              if (merged[i].id === bid) { merged[i] = br; break; }
            }
            idMap[bid] = br;
            toSync.push(br);
            updated++;
          }
        } else if (bid === undefined || bid === null) {
          var key = (br.timestamp || 0) + '|' + br.type;
          if (!keyMap[key]) {
            merged.push(br);
            keyMap[key] = true;
            toSync.push(br);
            added++;
          }
        } else {
          merged.push(br);
          idMap[bid] = br;
          keyMap[(br.timestamp || 0) + '|' + br.type] = true;
          toSync.push(br);
          added++;
        }
      });
      cachedRecords = merged;
      // 合并开罐记录（按 id 去重，较新覆盖）
      var canMap = {};
      getFormulaCans().forEach(function(c) { canMap[c.id] = c; });
      backupCans.forEach(function(c) {
        if (!canMap[c.id] || (c.ts || 0) > (canMap[c.id].ts || 0)) canMap[c.id] = c;
      });
      var mergedCans = Object.keys(canMap).map(function(k) { return canMap[k]; })
        .sort(function(a, b) { return (b.ts || 0) - (a.ts || 0); });
      saveFormulaCans(mergedCans);
      // 同步云端（有 id 的走 upsert 更新/新增，无 id 的走 insert）
      if (toSync.length > 0) {
        var ups = toSync.map(recordToISO);
        var { error: syncErr } = await supabase.from('feeding_records').upsert(ups, { onConflict: 'id' });
        if (syncErr) throw syncErr;
      }
      toast('导入成功：新增 ' + added + ' 条、更新 ' + updated + ' 条；开罐记录 ' + mergedCans.length + ' 条', 'success');
    }
    // 刷新界面
    renderDashboard();
    renderFormulaCans();
    if (currentPage === 'stats') renderStats();
    else if (currentPage === 'timeline') renderTimeline();
  } catch (e) {
    toast('导入失败：' + e.message, 'warning');
  }
}

// ------- Notification -------
var timerInterval = null;

function startNotifTimer() {
  stopNotifTimer();
  timerInterval = setInterval(checkNotif, 30000);
}

function stopNotifTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function checkNotif() {
  var s = getSettings();
  if (!s.notifEnabled) return;

  var records = getRecords();
  var feedingRecords = records.filter(function(r) { return r.type === 'milk' || r.type === 'meal' || r.type === 'snack' || r.type === 'sleep' || r.type === 'poop' || r.type === 'diaper'; });
  feedingRecords.sort(function(a, b) { return b.timestamp - a.timestamp; });
  var last = feedingRecords[0];

  if (!last) return;

  var elapsed = Date.now() - last.timestamp;
  var intervalMs = s.interval * 60000;

  if (elapsed >= intervalMs) {
    var h = Math.floor(elapsed / 3600000);
    var m = Math.floor((elapsed % 3600000) / 60000);
    var msg = s.babyName + '已经 ' + h + ' 小时 ' + m + ' 分钟没有进食啦！';

    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('喂养提醒', { body: msg, icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="80" font-size="80">🍼</text></svg>', tag: 'feeding-notif', requireInteraction: true });
    }

    showNotifToast(msg);
  }
}

function showNotifToast(msg) {
  var el = document.getElementById('notifToast');
  var msgEl = document.getElementById('notifMsg');
  if (!el || !msgEl) return;
  msgEl.textContent = msg;
  el.classList.add('show');
}

function closeNotif() {
  var el = document.getElementById('notifToast');
  if (el) el.classList.remove('show');
}

// ------- Timer Update -------
function updateTimer() {
  if (currentPage !== 'dashboard') return;

  var activeSleep = window._activeSleep;
  var timerSleepCard = document.getElementById('timerSleep');

  // Update sleep timer if active, hide card otherwise
  if (activeSleep && activeSleep.sleep_start) {
    if (timerSleepCard) timerSleepCard.style.display = '';
    var timerValue = document.getElementById('timerValue');
    if (timerValue) {
      var diff = Date.now() - activeSleep.sleep_start;
      var h = Math.floor(diff / 3600000);
      var m = Math.floor((diff % 3600000) / 60000);
      timerValue.textContent = h + '小时' + m + '分钟';
    }
  } else {
    if (timerSleepCard) timerSleepCard.style.display = 'none';
  }

  var records = getRecords();

  // Update feeding timer
  var timerFeedingVal = document.getElementById('timerFeedingValue');
  if (timerFeedingVal) {
    var feedingRecords = records.filter(function(r) { return r.type === 'milk'; });
    feedingRecords.sort(function(a, b) { return b.timestamp - a.timestamp; });
    var last = feedingRecords[0];
    if (last) {
      var diff = Date.now() - last.timestamp;
      var h = Math.floor(diff / 3600000);
      var m = Math.floor((diff % 3600000) / 60000);
      timerFeedingVal.textContent = h + '小时' + m + '分钟';
    }
  }
}

// ------- Service Worker -------
function drawFormulaMonthlyChart() {
  var canvas = document.getElementById('formulaMonthlyChart');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 180 * dpr;
  ctx.scale(dpr, dpr);
  canvas.style.height = '180px';

  var w = rect.width;
  var h = 180;
  var pad = { top: 16, right: 12, bottom: 28, left: 48 };
  var cw = w - pad.left - pad.right;
  var ch = h - pad.top - pad.bottom;

  var data = window._formulaMonthlyData || [];
  if (data.length === 0) return;
  var maxCost = 1;
  data.forEach(function(m) { if (m.cost > maxCost) maxCost = m.cost; });

  var barW = Math.max(14, Math.min(40, cw / data.length * 0.55));
  var gap = (cw - barW * data.length) / (data.length + 1);

  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = getChartTheme().grid;
  ctx.lineWidth = 1;
  var gridLines = 4;
  for (var i = 0; i <= gridLines; i++) {
    var y = pad.top + (ch / gridLines) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = getChartTheme().axis;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('¥' + Math.round(maxCost / gridLines * (gridLines - i)), pad.left - 6, y + 4);
  }

  data.forEach(function(m, idx) {
    var val = m.cost;
    var barH = val / maxCost * ch;
    var x = pad.left + gap + idx * (barW + gap);
    var y = pad.top + ch - barH;

    var gradient = ctx.createLinearGradient(x, y, x, pad.top + ch);
    if (m.isCurrent) {
      gradient.addColorStop(0, '#FF6B8A');
      gradient.addColorStop(1, '#FF9AA2');
    } else {
      gradient.addColorStop(0, '#FF9AA2');
      gradient.addColorStop(1, '#FFB7B2');
    }
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, [4, 4, 0, 0]);
    ctx.fill();

    if (val > 0) {
      ctx.fillStyle = getChartTheme().title;
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('¥' + Math.round(val), x + barW / 2, y - 4);
    }

    ctx.fillStyle = getChartTheme().axis;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(m.monthLabel, x + barW / 2, pad.top + ch + 18);
  });
}

function drawFormulaCostChart(chartData) {
  var canvas = document.getElementById('formulaCostChart');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 180 * dpr;
  ctx.scale(dpr, dpr);
  canvas.style.height = '180px';

  var w = rect.width;
  var h = 180;
  var pad = { top: 16, right: 12, bottom: 28, left: 48 };
  var cw = w - pad.left - pad.right;
  var ch = h - pad.top - pad.bottom;
  var dates = chartData.dates;
  var data = chartData.data;

  var maxCost = 0;
  dates.forEach(function(d) { if (data[d].total > maxCost) maxCost = data[d].total; });
  if (maxCost === 0) maxCost = 1;

  var barW = Math.max(2, Math.min(32, cw / dates.length * 0.6));
  var gap = Math.max(1, (cw - barW * dates.length) / (dates.length + 1));

  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = getChartTheme().grid;
  ctx.lineWidth = 1;
  var gridLines = 4;
  for (var i = 0; i <= gridLines; i++) {
    var y = pad.top + (ch / gridLines) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();

    ctx.fillStyle = getChartTheme().axis;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('¥' + (maxCost / gridLines * (gridLines - i)).toFixed(1), pad.left - 6, y + 4);
  }

  window._formulaBarPositions = [];

  dates.forEach(function(d, i) {
    var val = data[d].total;
    var barH = val / maxCost * ch;
    var x = pad.left + gap + i * (barW + gap);
    var y = pad.top + ch - barH;

    var gradient = ctx.createLinearGradient(x, y, x, pad.top + ch);
    gradient.addColorStop(0, '#FF9AA2');
    gradient.addColorStop(1, '#FFB7B2');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, [4, 4, 0, 0]);
    ctx.fill();

    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(x - 4, pad.top, barW + 8, ch);

    if (val > 0) {
      ctx.fillStyle = getChartTheme().title;
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('¥' + val.toFixed(2), x + barW / 2, y - 4);
    }

    ctx.fillStyle = getChartTheme().axis;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    var showLabel = dates.length <= 10 || (i % Math.ceil(dates.length / 8) === 0) || i === dates.length - 1;
    if (showLabel) {
      var dateParts = d.split('-');
      var dateLabel = (parseInt(dateParts[1], 10)) + '/' + (parseInt(dateParts[2], 10));
      ctx.fillText(dateLabel, x + barW / 2, pad.top + ch + 18);
    }

    window._formulaBarPositions.push({ date: d, x: x, w: barW });
  });

  canvas.style.cursor = 'pointer';
  canvas.onclick = function(e) {
    var cr = canvas.getBoundingClientRect();
    var clickX = e.clientX - cr.left;
    var bars = window._formulaBarPositions;
    if (!bars) return;
    for (var j = 0; j < bars.length; j++) {
      var b = bars[j];
      if (clickX >= b.x - 6 && clickX <= b.x + b.w + 6) {
        showDayFormulaDetail(b.date);
        return;
      }
    }
  };
}

function showDayFormulaDetail(dateStr) {
  var existing = document.getElementById('formulaDetailPopup');
  if (existing) existing.remove();

  var records = getRecords();
  var dayRecords = records.filter(function(r) {
    return r.type === 'milk' && formatDate(r.timestamp) === dateStr;
  }).sort(function(a, b) { return a.timestamp - b.timestamp; });

  var d = new Date(dateStr + 'T00:00:00');
  var title = (d.getMonth() + 1) + '月' + d.getDate() + '日 奶粉费用详情';

  var html = '<div class="modal-overlay show" id="formulaDetailPopup" onclick="closeFormulaDetail(event)">' +
    '<div class="modal-box" style="max-height:70vh;overflow-y:auto" onclick="event.stopPropagation()">' +
    '<h3 style="margin-bottom:12px">' + title + '</h3>';

  if (dayRecords.length === 0) {
    html += '<div style="text-align:center;padding:20px;color:var(--text-light)">当天无奶量记录</div>';
  } else {
    var totalCost = 0;
    html += '<table style="width:100%;font-size:13px;border-collapse:collapse">';
    html += '<thead><tr style="border-bottom:2px solid var(--border);text-align:left;color:var(--text-light);font-size:11px"><th style="padding:8px 4px">时间</th><th style="padding:8px 4px">奶量</th><th style="padding:8px 4px">费用</th></tr></thead><tbody>';
    dayRecords.forEach(function(r) {
      var cost = (r.amount || 0) / 30 * FORMULA_COST_PER_30ML;
      totalCost += cost;
      html += '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:8px 4px;white-space:nowrap">' + formatTime(r.timestamp) + '</td>' +
        '<td style="padding:8px 4px;font-weight:600;color:var(--pink)">' + (r.amount || 0) + ' ml</td>' +
        '<td style="padding:8px 4px;font-weight:600;color:var(--pink)">¥' + cost.toFixed(2) + '</td>' +
        '</tr>';
    });
    html += '<tr style="font-weight:700;border-top:2px solid var(--border)">' +
      '<td style="padding:10px 4px">当日合计</td>' +
      '<td style="padding:10px 4px"></td>' +
      '<td style="padding:10px 4px;color:var(--pink)">¥' + totalCost.toFixed(2) + '</td></tr>';
    html += '</tbody></table>';
  }

  html += '<div class="btn-row" style="margin-top:16px">' +
    '<button class="btn-confirm" onclick="document.getElementById(\'formulaDetailPopup\').remove()" style="flex:1;padding:10px;border-radius:20px;font-size:14px;border:none;background:var(--pink);color:#fff;cursor:pointer">关闭</button>' +
    '</div></div></div>';

  document.body.insertAdjacentHTML('beforeend', html);
}

function closeFormulaDetail(e) {
  if (e && e.target !== document.getElementById('formulaDetailPopup')) return;
  var el = document.getElementById('formulaDetailPopup');
  if (el) el.remove();
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).then(function(reg) {
      // SW registered
    }).catch(function(err) {
      // SW registration failed
    });
  }
}

// ------- Formula Can Opening (local only, not synced to Supabase) -------
const FORMULA_CANS_KEY = 'formulaCans';

function getFormulaCans() {
  try {
    var raw = localStorage.getItem(FORMULA_CANS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function saveFormulaCans(cans) {
  localStorage.setItem(FORMULA_CANS_KEY, JSON.stringify(cans));
}

function formatDateTimeMinute(ts) {
  var d = new Date(ts);
  var p = function(n) { return n.toString().padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function addFormulaCan() {
  var cans = getFormulaCans();
  var rec = { date: formatDateTimeMinute(Date.now()), ts: Date.now(), id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7) };
  cans.unshift(rec);
  saveFormulaCans(cans);
  renderFormulaCans();
  if (currentPage === 'dashboard') renderDashboard();
  toast('已记录开启一罐新奶粉', 'success');
}

function deleteFormulaCan(id) {
  var cans = getFormulaCans().filter(function(c) { return c.id !== id; });
  saveFormulaCans(cans);
  renderFormulaCans();
  if (currentPage === 'dashboard') renderDashboard();
  if (document.getElementById('queryDayFormulaPopup') && _queryFormulaDate) {
    showQueryDayFormulaCans(_queryFormulaDate);
  }
}

function renderFormulaCans() {
  var el = document.getElementById('formulaCansList');
  if (!el) return;
  var cans = getFormulaCans();
  if (cans.length === 0) {
    el.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-light);font-size:13px">暂无开罐记录</div>';
    return;
  }
  var html = '';
  cans.forEach(function(c) {
    html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">' +
      '<span style="font-size:14px">📦 ' + c.date + '</span>' +
      '<button onclick="deleteFormulaCan(\'' + c.id + '\')" style="border:none;background:none;color:#FF6B8A;font-size:16px;cursor:pointer;padding:4px 8px" title="删除">&times;</button>' +
      '</div>';
  });
  el.innerHTML = html;
}

function countMonthFormulaCans() {
  var now = new Date();
  var monthPrefix = now.getFullYear() + '-' + (now.getMonth() + 1).toString().padStart(2, '0');
  return getFormulaCans().filter(function(c) { return c.date.indexOf(monthPrefix) === 0; }).length;
}

function showMonthFormulaDetail() {
  var existing = document.getElementById('monthFormulaPopup');
  if (existing) existing.remove();

  var now = new Date();
  var monthLabel = now.getFullYear() + '年' + (now.getMonth() + 1) + '月';
  var monthPrefix = now.getFullYear() + '-' + (now.getMonth() + 1).toString().padStart(2, '0');
  var cans = getFormulaCans().filter(function(c) { return c.date.indexOf(monthPrefix) === 0; });

  var html = '<div class="modal-overlay show" id="monthFormulaPopup" onclick="closeMonthFormulaDetail(event)">' +
    '<div class="modal-box" style="max-height:70vh;overflow-y:auto" onclick="event.stopPropagation()">' +
    '<h3 style="margin-bottom:12px">' + monthLabel + '开罐明细</h3>';

  if (cans.length === 0) {
    html += '<div style="text-align:center;padding:20px;color:var(--text-light)">本月暂无开罐记录</div>';
  } else {
    html += '<table style="width:100%;font-size:13px;border-collapse:collapse">' +
      '<thead><tr style="border-bottom:2px solid var(--border);text-align:left;color:var(--text-light);font-size:11px"><th style="padding:8px 4px">日期</th><th style="padding:8px 4px">操作</th></tr></thead><tbody>';
    cans.forEach(function(c) {
      html += '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:8px 4px">📦 ' + c.date + '</td>' +
        '<td style="padding:8px 4px"><button onclick="deleteFormulaCan(\'' + c.id + '\')" style="border:none;background:none;color:#FF6B8A;font-size:14px;cursor:pointer" title="删除">&times;</button></td>' +
        '</tr>';
    });
    html += '</tbody></table>';
  }

  html += '<div class="btn-row" style="margin-top:16px">' +
    '<button class="btn-confirm" onclick="document.getElementById(\'monthFormulaPopup\').remove()" style="flex:1;padding:10px;border-radius:20px;font-size:14px;border:none;background:var(--pink);color:#fff;cursor:pointer">关闭</button>' +
    '</div></div></div>';

  document.body.insertAdjacentHTML('beforeend', html);
}

function closeMonthFormulaDetail(e) {
  if (e && e.target !== document.getElementById('monthFormulaPopup')) return;
  var el = document.getElementById('monthFormulaPopup');
  if (el) el.remove();
}

// ------- Query Day Records -------
function queryDayRecords() {
  var dateInput = document.getElementById('queryDate');
  if (!dateInput || !dateInput.value) {
    toast('请选择日期', 'warning');
    return;
  }
  var selectedDate = dateInput.value;
  var records = getRecords();
  var matched = records.filter(function(r) {
    return formatDate(r.timestamp) === selectedDate;
  });

  // Build summary
  var milkTotal = 0, mealCount = 0, snackCount = 0, diaperCount = 0, customCount = 0;
  var sleepTotalMs = 0;

  // Formula cans that day (localStorage only)
  var dayCans = getFormulaCans().filter(function(c) { return c.date.indexOf(selectedDate) === 0; }).length;

  matched.forEach(function(r) {
    if (r.type === 'milk') milkTotal += (r.amount || 0);
    else if (r.type === 'meal') mealCount++;
    else if (r.type === 'snack') snackCount++;
    else if (r.type === 'diaper') diaperCount++;
    else if (r.type === 'custom') customCount++;
    else if (r.type === 'sleep') {
      if (r.sleep_start && r.sleep_end) sleepTotalMs += (r.sleep_end - r.sleep_start);
    }
  });

  function fmtDur(ms) {
    var h = Math.floor(ms / 3600000);
    var m = Math.floor((ms % 3600000) / 60000);
    return h + 'h' + m + 'm';
  }

  document.getElementById('queryModalTitle').textContent = selectedDate + ' 记录汇总';
  var bodyEl = document.getElementById('queryModalBody');
  var html = '';

  if (matched.length === 0) {
    html = '<div class="query-empty">当日无记录</div>';
  } else {
    html += '<div class="dash-summary" style="margin-bottom:0">';

    html += '<div class="dash-item" style="cursor:pointer" onclick="showQueryTypeDetail(\'' + selectedDate + '\',\'milk\')">' +
      '<div class="value" style="font-size:22px">' + milkTotal + '<span class="unit">ml</span></div>' +
      '<div class="label">🍼 奶量</div></div>';

    html += '<div class="dash-item" style="cursor:pointer" onclick="showQueryTypeDetail(\'' + selectedDate + '\',\'meal\')">' +
      '<div class="value" style="font-size:22px">' + mealCount + '<span class="unit">次</span></div>' +
      '<div class="label">🍚 吃饭</div></div>';

    html += '<div class="dash-item" style="cursor:pointer" onclick="showQueryTypeDetail(\'' + selectedDate + '\',\'snack\')">' +
      '<div class="value" style="font-size:22px">' + snackCount + '<span class="unit">次</span></div>' +
      '<div class="label">🥄 辅食</div></div>';

    html += '<div class="dash-item" style="cursor:pointer" onclick="showQueryTypeDetail(\'' + selectedDate + '\',\'sleep\')">' +
      '<div class="value" style="font-size:14px;font-weight:700">' + fmtDur(sleepTotalMs) + '</div>' +
      '<div class="label">💤 睡眠</div></div>';

    html += '<div class="dash-item" style="cursor:pointer" onclick="showQueryTypeDetail(\'' + selectedDate + '\',\'diaper\')">' +
      '<div class="value" style="font-size:22px">' + diaperCount + '<span class="unit">次</span></div>' +
      '<div class="label">🧷 尿布</div></div>';

    html += '<div class="dash-item" style="cursor:pointer" onclick="showQueryTypeDetail(\'' + selectedDate + '\',\'custom\')">' +
      '<div class="value" style="font-size:22px">' + customCount + '<span class="unit">条</span></div>' +
      '<div class="label">📝 其他</div></div>';

    if (dayCans > 0) {
      html += '<div class="dash-item" style="cursor:pointer" onclick="showQueryDayFormulaCans(\'' + selectedDate + '\')">' +
        '<div class="value" style="font-size:22px">' + dayCans + '<span class="unit">罐</span></div>' +
        '<div class="label">📦 奶粉开罐</div></div>';
    }

    html += '</div>';
    html += '<div style="text-align:center;font-size:11px;color:var(--text-light);margin-top:8px">点击卡片查看详情</div>';
  }

  bodyEl.innerHTML = html;
  document.getElementById('queryModalOverlay').classList.add('show');

  document.getElementById('queryModalOverlay').onclick = function(e) {
    if (e.target === this) closeQueryModal();
  };
}

function closeQueryModal() {
  document.getElementById('queryModalOverlay').classList.remove('show');
}

function showQueryTypeDetail(dateStr, type) {
  var records = getRecords();
  var typeName = getTypeName(type);

  var dayRecords;
  if (type === 'meal') {
    dayRecords = records.filter(function(r) {
      return (r.type === 'meal' || r.type === 'snack') && formatDate(r.timestamp) === dateStr;
    }).sort(function(a, b) { return a.timestamp - b.timestamp; });
  } else {
    dayRecords = records.filter(function(r) {
      return r.type === type && formatDate(r.timestamp) === dateStr;
    }).sort(function(a, b) { return a.timestamp - b.timestamp; });
  }

  var html = '<div class="modal-overlay show" id="queryTypeDetailPopup" onclick="closeQueryTypeDetail(event)">' +
    '<div class="modal-box" style="max-height:70vh;overflow-y:auto" onclick="event.stopPropagation()">' +
    '<h3 style="margin-bottom:12px">' + dateStr + ' ' + typeName + '详情</h3>';

  if (dayRecords.length === 0) {
    html += '<div style="text-align:center;padding:20px;color:var(--text-light)">暂无' + typeName + '记录</div>';
  } else if (type === 'sleep') {
    html += '<table style="width:100%;font-size:13px;border-collapse:collapse">';
    html += '<thead><tr style="border-bottom:2px solid var(--border);text-align:left;color:var(--text-light);font-size:11px"><th style="padding:8px 4px">入睡</th><th style="padding:8px 4px">醒来</th><th style="padding:8px 4px">时长</th><th style="padding:8px 4px">备注</th><th style="padding:8px 4px">操作</th></tr></thead><tbody>';
    dayRecords.forEach(function(r) {
      var dur = (r.sleep_start && r.sleep_end && r.sleep_end > r.sleep_start) ? (r.sleep_end - r.sleep_start) : 0;
      var h = Math.floor(dur / 3600000);
      var m = Math.floor((dur % 3600000) / 60000);
      html += '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:8px 4px;white-space:nowrap">' + (r.sleep_start ? formatTime(r.sleep_start) : '') + '</td>' +
        '<td style="padding:8px 4px;white-space:nowrap">' + (r.sleep_end ? formatTime(r.sleep_end) : '') + '</td>' +
        '<td style="padding:8px 4px;font-weight:600;color:var(--pink)">' + h + 'h' + m + 'm</td>' +
        '<td style="padding:8px 4px;color:var(--text-light);font-size:12px">' + (r.note || '') + '</td>' +
        '<td style="padding:8px 4px;white-space:nowrap"><button class="tl-edit-btn" title="编辑" onclick="showEditRecord(\'' + r.id + '\')">✎</button></td>' +
        '</tr>';
    });
    html += '</tbody></table>';
  } else {
    html += '<table style="width:100%;font-size:13px;border-collapse:collapse">';
    html += '<thead><tr style="border-bottom:2px solid var(--border);text-align:left;color:var(--text-light);font-size:11px"><th style="padding:8px 4px">时间</th><th style="padding:8px 4px">内容</th><th style="padding:8px 4px">备注</th><th style="padding:8px 4px">操作</th></tr></thead><tbody>';
    dayRecords.forEach(function(r) {
      var desc = buildRecordDesc(r);
      html += '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:8px 4px;white-space:nowrap">' + formatTime(r.timestamp) + '</td>' +
        '<td style="padding:8px 4px;font-weight:600;color:var(--pink)">' + desc + '</td>' +
        '<td style="padding:8px 4px;color:var(--text-light);font-size:12px">' + (r.note || '') + '</td>' +
        '<td style="padding:8px 4px;white-space:nowrap"><button class="tl-edit-btn" title="编辑" onclick="showEditRecord(\'' + r.id + '\')">✎</button></td>' +
        '</tr>';
    });
    html += '</tbody></table>';
  }

  html += '<div class="btn-row" style="margin-top:16px">' +
    '<button class="btn-confirm" onclick="document.getElementById(\'queryTypeDetailPopup\').remove()" style="flex:1;padding:10px;border-radius:20px;font-size:14px;border:none;background:var(--pink);color:#fff;cursor:pointer">关闭</button>' +
    '</div></div></div>';

  document.body.insertAdjacentHTML('beforeend', html);
}

function closeQueryTypeDetail(e) {
  if (e && e.target !== document.getElementById('queryTypeDetailPopup')) return;
  var el = document.getElementById('queryTypeDetailPopup');
  if (el) el.remove();
}

// ------- Edit Record -------
function showEditRecord(id) {
  var existing = document.getElementById('editRecordPopup');
  if (existing) existing.remove();

  var records = getRecords();
  var r = null;
  for (var i = 0; i < records.length; i++) {
    if (String(records[i].id) === String(id)) { r = records[i]; break; }
  }
  if (!r) { toast('未找到该记录', 'warning'); return; }

  var type = r.type;
  var fieldsHtml = '';

  function fieldWrap(label, inner) {
    return '<div style="margin-bottom:10px"><label style="display:block;font-size:12px;color:var(--text-light);margin-bottom:4px;">' + label + '</label>' + inner + '</div>';
  }
  function inputStyle() {
    return 'width:100%;padding:10px;border:2px solid var(--border);border-radius:var(--radius-sm);font-size:14px;outline:none;background:var(--card);color:var(--text);box-sizing:border-box;';
  }

  if (type === 'milk') {
    fieldsHtml += fieldWrap('奶量 (ml)', '<input type="number" id="editAmount" min="1" value="' + (r.amount != null ? r.amount : '') + '" style="' + inputStyle() + '">');
  } else if (type === 'meal' || type === 'snack') {
    fieldsHtml += fieldWrap('内容', '<input type="text" id="editSubtype" value="' + escapeHtml(r.subtype || '') + '" maxlength="50" style="' + inputStyle() + '">');
    var portionOpts = ['少', '中', '多'];
    var portionSel = '';
    portionOpts.forEach(function(p) {
      portionSel += '<option value="' + p + '"' + (r.portion === p ? ' selected' : '') + '>' + p + '</option>';
    });
    fieldsHtml += fieldWrap('分量（可选）', '<select id="editPortion" style="' + inputStyle() + '"><option value="">不选</option>' + portionSel + '</select>');
  } else if (type === 'sleep') {
    fieldsHtml += fieldWrap('入睡时间', '<input type="datetime-local" id="editSleepStart" value="' + (r.sleep_start ? toDatetimeLocal(r.sleep_start) : '') + '" style="' + inputStyle() + '">');
    fieldsHtml += fieldWrap('醒来时间（正在睡觉可留空）', '<input type="datetime-local" id="editSleepEnd" value="' + (r.sleep_end ? toDatetimeLocal(r.sleep_end) : '') + '" style="' + inputStyle() + '">');
  } else if (type === 'diaper') {
    var diaperOptions = ['小便', '大便'];
    var diaperSel = '';
    diaperOptions.forEach(function(opt) {
      diaperSel += '<option value="' + opt + '"' + (r.diaper_type === opt ? ' selected' : '') + '>' + opt + '</option>';
    });
    fieldsHtml += fieldWrap('类型', '<select id="editDiaperType" style="' + inputStyle() + '">' + diaperSel + '</select>');
    fieldsHtml += fieldWrap('备注（可选）', '<input type="text" id="editNote" value="' + escapeHtml(r.note || '') + '" maxlength="50" style="' + inputStyle() + '">');
  } else if (type === 'height') {
    fieldsHtml += fieldWrap('身高 (cm)', '<input type="number" id="editMeasure" step="0.1" min="0" value="' + (r.height != null ? r.height : '') + '" style="' + inputStyle() + '">');
  } else if (type === 'weight') {
    fieldsHtml += fieldWrap('体重 (斤)', '<input type="number" id="editMeasure" step="0.1" min="0" value="' + (r.weight != null ? r.weight : '') + '" style="' + inputStyle() + '">');
  } else if (type === 'hw') {
    fieldsHtml += fieldWrap('身高 (cm)', '<input type="number" id="editHeight" step="0.1" min="0" value="' + (r.height != null ? r.height : '') + '" style="' + inputStyle() + '">');
    fieldsHtml += fieldWrap('体重 (斤)', '<input type="number" id="editWeight" step="0.1" min="0" value="' + (r.weight != null ? r.weight : '') + '" style="' + inputStyle() + '">');
  } else if (type === 'custom') {
    fieldsHtml += fieldWrap('内容', '<input type="text" id="editSubtype" value="' + escapeHtml(r.subtype || '') + '" maxlength="100" style="' + inputStyle() + '">');
    fieldsHtml += fieldWrap('备注（可选）', '<input type="text" id="editNote" value="' + escapeHtml(r.note || '') + '" maxlength="50" style="' + inputStyle() + '">');
  } else {
    // poop 等其它类型仅支持改时间
  }

  fieldsHtml += fieldWrap('日期时间', '<input type="datetime-local" id="editTimestamp" value="' + toDatetimeLocal(r.timestamp) + '" style="' + inputStyle() + '">');

  var html = '<div class="modal-overlay show" id="editRecordPopup" onclick="closeEditRecord(event)">' +
    '<div class="modal-box" onclick="event.stopPropagation()">' +
    '<h3 style="margin-bottom:12px">编辑' + getTypeName(type) + '记录</h3>' +
    fieldsHtml +
    '<div class="btn-row" style="margin-top:16px">' +
    '<button class="btn-confirm" onclick="closeEditRecord()" style="flex:1;padding:10px;border-radius:20px;font-size:14px;border:none;background:var(--bg);color:var(--text);cursor:pointer">取消</button>' +
    '<button class="btn-confirm" onclick="saveEditRecord(\'' + id + '\')" style="flex:1;padding:10px;border-radius:20px;font-size:14px;border:none;background:var(--pink);color:#fff;cursor:pointer">保存</button>' +
    '</div></div></div>';

  document.body.insertAdjacentHTML('beforeend', html);
}

function closeEditRecord(e) {
  if (e && e.target !== document.getElementById('editRecordPopup')) return;
  var el = document.getElementById('editRecordPopup');
  if (el) el.remove();
}

async function saveEditRecord(id) {
  var records = getRecords();
  var idx = -1;
  for (var i = 0; i < records.length; i++) {
    if (String(records[i].id) === String(id)) { idx = i; break; }
  }
  if (idx < 0) { toast('未找到该记录', 'warning'); return; }

  var src = records[idx];
  var type = src.type;
  var updated = {};
  for (var k in src) updated[k] = src[k];

  function val(elId) {
    var el = document.getElementById(elId);
    return el ? el.value : '';
  }

  // 日期时间（通用）
  var tsVal = val('editTimestamp');
  if (tsVal) {
    var newTs = new Date(tsVal).getTime();
    if (!isNaN(newTs)) updated.timestamp = newTs;
  }

  if (type === 'milk') {
    var amt = parseFloat(val('editAmount'));
    if (isNaN(amt) || amt <= 0) { toast('请输入有效奶量', 'warning'); return; }
    updated.amount = amt;
  } else if (type === 'meal' || type === 'snack') {
    var sub = val('editSubtype').trim();
    if (!sub) { toast('请输入内容', 'warning'); return; }
    updated.subtype = sub;
    updated.portion = val('editPortion').trim();
  } else if (type === 'sleep') {
    var ss = val('editSleepStart');
    var se = val('editSleepEnd');
    var ssTs = ss ? new Date(ss).getTime() : NaN;
    if (isNaN(ssTs)) { toast('请选择入睡时间', 'warning'); return; }
    updated.sleep_start = ssTs;
    updated.timestamp = ssTs; // 睡眠记录时间 = 入睡时间
    if (se) {
      var seTs = new Date(se).getTime();
      if (isNaN(seTs)) { toast('醒来时间无效', 'warning'); return; }
      if (seTs <= ssTs) { toast('醒来时间必须晚于入睡时间', 'warning'); return; }
      updated.sleep_end = seTs;
    } else {
      updated.sleep_end = null;
    }
  } else if (type === 'diaper') {
    var dt = val('editDiaperType');
    if (!dt) { toast('请选择尿布类型', 'warning'); return; }
    updated.diaper_type = dt;
    updated.note = val('editNote').trim();
  } else if (type === 'height') {
    var hv = parseFloat(val('editMeasure'));
    if (isNaN(hv) || hv <= 0) { toast('请输入有效身高', 'warning'); return; }
    updated.height = hv;
  } else if (type === 'weight') {
    var wv = parseFloat(val('editMeasure'));
    if (isNaN(wv) || wv <= 0) { toast('请输入有效体重', 'warning'); return; }
    updated.weight = wv;
  } else if (type === 'hw') {
    var eh = parseFloat(val('editHeight'));
    var ew = parseFloat(val('editWeight'));
    if (!isNaN(eh) && eh > 0) updated.height = eh;
    if (!isNaN(ew) && ew > 0) updated.weight = ew;
  } else if (type === 'custom') {
    var csub = val('editSubtype').trim();
    if (!csub) { toast('请输入记录内容', 'warning'); return; }
    updated.subtype = csub;
    updated.note = val('editNote').trim();
  }

  var ok = await updateRecord(updated);
  if (!ok) return;

  // 关闭相关弹窗并重渲染当前页
  var editEl = document.getElementById('editRecordPopup');
  if (editEl) editEl.remove();
  var qdEl = document.getElementById('queryTypeDetailPopup');
  if (qdEl) qdEl.remove();
  var tdEl = document.getElementById('todayDetailPopup');
  if (tdEl) tdEl.remove();
  var milkEl = document.getElementById('milkDetailPopup');
  if (milkEl) milkEl.remove();
  var diaperEl = document.getElementById('diaperDetailPopup');
  if (diaperEl) diaperEl.remove();
  var qmOverlay = document.getElementById('queryModalOverlay');
  if (qmOverlay) qmOverlay.classList.remove('show');

  renderPage(currentPage);
  toast('记录已更新', 'success');
}

// ------- Query Day Formula Cans -------
var _queryFormulaDate = '';
function showQueryDayFormulaCans(dateStr) {
  var existing = document.getElementById('queryDayFormulaPopup');
  if (existing) existing.remove();
  _queryFormulaDate = dateStr;

  var cans = getFormulaCans().filter(function(c) { return c.date.indexOf(dateStr) === 0; });

  var html = '<div class="modal-overlay show" id="queryDayFormulaPopup" onclick="closeQueryDayFormulaCans(event)">' +
    '<div class="modal-box" style="max-height:70vh;overflow-y:auto" onclick="event.stopPropagation()">' +
    '<h3 style="margin-bottom:12px">' + dateStr + ' 奶粉开罐明细</h3>';

  if (cans.length === 0) {
    html += '<div style="text-align:center;padding:20px;color:var(--text-light)">当日暂无开罐记录</div>';
  } else {
    html += '<table style="width:100%;font-size:13px;border-collapse:collapse">' +
      '<thead><tr style="border-bottom:2px solid var(--border);text-align:left;color:var(--text-light);font-size:11px"><th style="padding:8px 4px">开罐时间</th><th style="padding:8px 4px">操作</th></tr></thead><tbody>';
    cans.forEach(function(c) {
      html += '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:8px 4px">📦 ' + c.date + '</td>' +
        '<td style="padding:8px 4px"><button onclick="deleteFormulaCan(\'' + c.id + '\')" style="border:none;background:none;color:#FF6B8A;font-size:14px;cursor:pointer" title="删除">&times;</button></td>' +
        '</tr>';
    });
    html += '</tbody></table>';
  }

  html += '<div class="btn-row" style="margin-top:16px">' +
    '<button class="btn-confirm" onclick="document.getElementById(\'queryDayFormulaPopup\').remove()" style="flex:1;padding:10px;border-radius:20px;font-size:14px;border:none;background:var(--pink);color:#fff;cursor:pointer">关闭</button>' +
    '</div></div></div>';

  document.body.insertAdjacentHTML('beforeend', html);
}

function closeQueryDayFormulaCans(e) {
  if (e && e.target !== document.getElementById('queryDayFormulaPopup')) return;
  var el = document.getElementById('queryDayFormulaPopup');
  if (el) el.remove();
}

// ------- Init -------
async function init() {
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  // 应用深色模式（跟随系统 / 手动），并监听系统主题变化
  applyTheme();
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  if (mq && mq.addEventListener) {
    mq.addEventListener('change', function() {
      if (getThemePreference() === 'system') applyTheme();
    });
  }

  document.querySelectorAll('.nav-item').forEach(function(item) {
    item.addEventListener('click', function() {
      navigateTo(this.dataset.page);
    });
  });

  await loadRecords();
  subscribeRealtime();

  renderDashboard();

  setInterval(updateTimer, 1000);
  startNotifTimer();

  registerSW();
}

document.addEventListener('DOMContentLoaded', init);
