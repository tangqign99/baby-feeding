/* ============================================
   宝宝喂养记录 PWA - 应用逻辑 v3.27 (Supabase)
   ============================================ */

// ------- Supabase -------
const SUPABASE_URL = 'https://nzbpopxrxniixnhnqktw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56YnBvcHhyeG5paXhuaG5xa3R3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4ODQ2MzQsImV4cCI6MjA5NzQ2MDYzNH0.wLk-FdQlKha8YObTvgINW2M_9QVSpJk8c91bKJeQO7Q';
var supabase;
var cachedRecords = [];
var _realtimeSub = null;

// ------- Baby Age -------
const BIRTH_DATE = '2025-11-11';

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
    default: return '其他';
  }
}

function getIconBg(type) {
  switch (type) {
    case 'milk': return '#FFF0F5';
    case 'meal': return '#FFF8F0';
    case 'snack': return '#FFFDEB';
    case 'sleep': return '#F0F0FF';
    case 'poop': return '#F5E6CC';
    case 'diaper': return '#F0F8FF';
    case 'height': return '#F0F4FF';
    case 'weight': return '#F0FFF4';
    default: return '#F5F5F5';
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

// ------- Dashboard -------
function getActiveSleep() {
  var records = getRecords();
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    if (r.type === 'sleep' && r.sleep_start && !r.sleep_end) return r;
  }
  return null;
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

  document.getElementById('dashSummary').innerHTML =
    '<div class="dash-milk-hero" style="cursor:pointer" onclick="showTodayDetail(\'milk\')"><div class="hero-value">' + totalMilk + '<span class="unit">ml</span></div><div class="label">今日奶量</div></div>' +
    '<div class="dash-sub-row" style="grid-template-columns:repeat(3,1fr)">' +
    '<div class="dash-item" style="cursor:pointer" onclick="showTodayDetail(\'meal\')"><div class="value">' + mealCount + '<span class="unit">次</span></div><div class="label">吃饭</div></div>' +
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
  } else {
    timerSleep.innerHTML = '';
    timerSleep.style.display = 'none';
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
  } else {
    timerFeedingEl.innerHTML =
      '<div class="timer-label">距上次喝奶</div>' +
      '<div class="timer-value">--</div>' +
      '<div class="timer-detail">暂无记录</div>';
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
  return '';
}

function showTodayDetail(type) {
  var existing = document.getElementById('todayDetailPopup');
  if (existing) existing.remove();

  var today = formatDate(Date.now());
  var records = getRecords();
  var typeNames = { milk: '奶量', meal: '吃饭', snack: '辅食', sleep: '睡眠', diaper: '尿布' };
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
    html += '<thead><tr style="border-bottom:2px solid #F0E8E8;text-align:left;color:var(--text-light);font-size:11px"><th style="padding:8px 4px">入睡</th><th style="padding:8px 4px">醒来</th><th style="padding:8px 4px">时长</th><th style="padding:8px 4px">备注</th></tr></thead><tbody>';
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
        '</tr>';
    });
    html += '</tbody></table>';
  } else {
    html += '<table style="width:100%;font-size:13px;border-collapse:collapse">';
    html += '<thead><tr style="border-bottom:2px solid #F0E8E8;text-align:left;color:var(--text-light);font-size:11px"><th style="padding:8px 4px">时间</th><th style="padding:8px 4px">详情</th><th style="padding:8px 4px">备注</th></tr></thead><tbody>';
    dayRecords.forEach(function(r) {
      var detail = buildRecordDesc(r);
      html += '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:8px 4px;white-space:nowrap">' + formatTime(r.timestamp) + '</td>' +
        '<td style="padding:8px 4px;font-weight:600;color:var(--pink)">' + detail + '</td>' +
        '<td style="padding:8px 4px;color:var(--text-light);font-size:12px">' + (r.note || '') + '</td>' +
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
    { id: 'weight', label: '⚖️ 体重' }
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
          '<button class="tl-delete-btn" title="删除" onclick="event.stopPropagation();deleteRecord(\'' + r.id + '\')">&times;</button>' +
          '</div>';
      });
      html += '</div>';
    });
  }
  document.getElementById('timelineContent').innerHTML = html;
}

// ------- Stats -------
var sleepFilterMode = '2days';
var sleepFilterStart = '';
var sleepFilterEnd = '';
var diaperFilterMode = '2days';
var diaperFilterStart = '';
var diaperFilterEnd = '';

function getDateRange(mode, customStart, customEnd) {
  var now = new Date();
  var endTs = now.getTime();
  var startTs;
  switch (mode) {
    case '2days':
      startTs = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
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

function buildFilterHTML(prefix, mode, startVal, endVal) {
  var modes = [
    { id: '2days', label: '最近2天' },
    { id: '7days', label: '最近7天' },
    { id: '30days', label: '最近30天' },
    { id: 'month', label: '本月' },
    { id: 'custom', label: '自定义' }
  ];
  var capPrefix = prefix.charAt(0).toUpperCase() + prefix.slice(1);
  var h = '<div class="filter-bar">';
  modes.forEach(function(m) {
    h += '<button class="filter-btn' + (mode === m.id ? ' active' : '') +
      '" onclick="set' + capPrefix + 'Filter(\'' + m.id + '\')">' + m.label + '</button>';
  });
  h += '</div>';
  if (mode === 'custom') {
    h += '<div class="filter-date-row">' +
      '<input type="date" id="' + prefix + 'Start" value="' + (startVal || '') + '" title="开始日期">' +
      '<span style="font-size:12px;color:var(--text-light)">至</span>' +
      '<input type="date" id="' + prefix + 'End" value="' + (endVal || '') + '" title="结束日期">' +
      '<button onclick="apply' + capPrefix + 'Custom()">确定</button>' +
      '</div>';
  }
  return h;
}

function setSleepFilter(mode) {
  sleepFilterMode = mode;
  if (mode !== 'custom') { sleepFilterStart = ''; sleepFilterEnd = ''; }
  renderStats();
}

function applySleepCustom() {
  var s = document.getElementById('sleepStart');
  var e = document.getElementById('sleepEnd');
  if (s && e && s.value && e.value) {
    sleepFilterStart = s.value;
    sleepFilterEnd = e.value;
    renderStats();
  } else {
    toast('请选择完整的日期范围', 'warning');
  }
}

function setDiaperFilter(mode) {
  diaperFilterMode = mode;
  if (mode !== 'custom') { diaperFilterStart = ''; diaperFilterEnd = ''; }
  renderStats();
}

function applyDiaperCustom() {
  var s = document.getElementById('diaperStart');
  var e = document.getElementById('diaperEnd');
  if (s && e && s.value && e.value) {
    diaperFilterStart = s.value;
    diaperFilterEnd = e.value;
    renderStats();
  } else {
    toast('请选择完整的日期范围', 'warning');
  }
}

function renderStats() {
  var container = document.getElementById('statsContent');
  var records = getRecords();

  // Milk chart: last 7 days
  var days = [];
  for (var i = 6; i >= 0; i--) {
    var d = new Date();
    d.setDate(d.getDate() - i);
    days.push(formatDate(d.getTime()));
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

  // Milk bar chart
  var milkValues = days.map(function(d) { return milkByDay[d]; });
  var maxMilk = Math.max.apply(null, milkValues.concat([1]));
  var hasMilk = milkValues.some(function(v) { return v > 0; });

  html += '<div class="chart-container"><div class="chart-title">近7天奶量 (ml)</div>';
  if (hasMilk) {
    html += '<canvas id="milkChart" width="320" height="180" style="width:100%;max-width:420px"></canvas>';
    html += '<div style="text-align:center;font-size:11px;color:var(--text-light);margin-top:4px">点击柱子查看当天详情</div>';
  } else {
    html += '<div class="stat-empty">暂无奶量数据</div>';
  }
  html += '</div>';

  // Sleep records section
  var allSleepRecords = records.filter(function(r) { return r.type === 'sleep'; }).sort(function(a, b) { return b.timestamp - a.timestamp; });
  var sleepRange = getDateRange(sleepFilterMode, sleepFilterStart, sleepFilterEnd);
  var sleepRecords = allSleepRecords.filter(function(r) {
    var ts = r.sleep_start || r.timestamp;
    return ts >= sleepRange.start && ts <= sleepRange.end;
  });
  html += '<div class="chart-container"><div class="chart-title">睡眠记录</div>';
  html += buildFilterHTML('sleep', sleepFilterMode, sleepFilterStart, sleepFilterEnd);
  if (sleepRecords.length > 0) {
    html += '<div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse;min-width:360px">';
    html += '<thead><tr style="border-bottom:2px solid #F0E8E8;text-align:left;color:var(--text-light);font-size:11px"><th style="padding:8px 4px">日期</th><th style="padding:8px 4px">入睡</th><th style="padding:8px 4px">醒来</th><th style="padding:8px 4px">时长</th><th style="padding:8px 4px">类型</th></tr></thead><tbody>';
    sleepRecords.forEach(function(r) {
      var startTs = r.sleep_start || r.timestamp;
      var endTs = r.sleep_end;
      var dur = (endTs && startTs && endTs > startTs) ? (endTs - startTs) : 0;
      var sh = Math.floor(dur / 3600000);
      var sm = Math.floor((dur % 3600000) / 60000);

      var startDate = new Date(startTs);
      var startHour = startDate.getHours();
      var isNight = (startHour >= 20 || startHour < 6);
      var typeTag = isNight ? '夜间' : '白天';
      var tagColor = isNight ? '#7B68EE' : '#FF8C00';

      html += '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:8px 4px;white-space:nowrap">' + formatDate(startTs) + '</td>' +
        '<td style="padding:8px 4px;white-space:nowrap">' + formatTime(startTs) + '</td>' +
        '<td style="padding:8px 4px;white-space:nowrap">' + (endTs ? formatTime(endTs) : '--') + '</td>' +
        '<td style="padding:8px 4px;white-space:nowrap;font-weight:500">' + (dur > 0 ? sh + 'h' + sm + 'm' : '--') + '</td>' +
        '<td style="padding:8px 4px"><span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;background:' + tagColor + '18;color:' + tagColor + '">' + typeTag + '</span></td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';
  } else {
    html += '<div class="record-empty">暂无睡眠数据</div>';
  }
  html += '</div>';

  // Diaper stats
  var allDiaperRecords = records.filter(function(r) { return r.type === 'diaper'; }).sort(function(a, b) { return b.timestamp - a.timestamp; });
  var diaperRange = getDateRange(diaperFilterMode, diaperFilterStart, diaperFilterEnd);
  var diaperRecords = allDiaperRecords.filter(function(r) {
    return r.timestamp >= diaperRange.start && r.timestamp <= diaperRange.end;
  });
  html += '<div class="chart-container"><div class="chart-title">尿布统计</div>';
  html += buildFilterHTML('diaper', diaperFilterMode, diaperFilterStart, diaperFilterEnd);
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
    var diaperDates = Object.keys(diaperByDate).sort(function(a, b) { return b.localeCompare(a); });

    // Bar chart
    html += '<canvas id="diaperChart" width="320" height="180" style="width:100%;max-width:420px"></canvas>';
    html += '<div style="text-align:center;font-size:11px;color:var(--text-light);margin:4px 0 10px">点击柱子查看当天详情</div>';

    html += '<div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse;min-width:300px">';
    html += '<thead><tr style="border-bottom:2px solid #F0E8E8;text-align:left;color:var(--text-light);font-size:11px"><th style="padding:8px 4px">日期</th><th style="padding:8px 4px">小便</th><th style="padding:8px 4px">大便</th><th style="padding:8px 4px">总计</th></tr></thead><tbody>';
    diaperDates.forEach(function(d) {
      var row = diaperByDate[d];
      html += '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:8px 4px;white-space:nowrap">' + d + '</td>' +
        '<td style="padding:8px 4px">' + row.pee + '</td>' +
        '<td style="padding:8px 4px">' + row.poop + '</td>' +
        '<td style="padding:8px 4px;font-weight:600">' + row.total + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';

    // Store for chart drawing
    window._diaperChartData = { dates: diaperDates, data: diaperByDate };
  } else {
    html += '<div class="record-empty">暂无尿布数据</div>';
    window._diaperChartData = null;
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

  container.innerHTML = html;

  if (hasMilk) drawMilkChart(days, milkValues, maxMilk);
  if (window._diaperChartData) drawDiaperChart(window._diaperChartData);
  if (heightData.length >= 2) drawSingleMetricChart('heightChart', heightData, 'height', '#FF6B8A', '身高(cm)');
  if (weightData.length >= 2) drawSingleMetricChart('weightChart', weightData, 'weight', '#5BA4CF', '体重(斤)');
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
  var barW = Math.max(14, Math.min(32, cw / days.length * 0.6));
  var gap = (cw - barW * days.length) / (days.length + 1);

  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = '#F0E8E8';
  ctx.lineWidth = 1;
  var gridLines = 4;
  for (var i = 0; i <= gridLines; i++) {
    var y = pad.top + (ch / gridLines) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();

    ctx.fillStyle = '#888';
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
      ctx.fillStyle = '#4A4A4A';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(val, x + barW / 2, y - 4);
    }

    ctx.fillStyle = '#888';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    var dateLabel = (parseInt(d.slice(8, 10), 10)) + '日';
    ctx.fillText(dateLabel, x + barW / 2, pad.top + ch + 18);

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
    html += '<thead><tr style="border-bottom:2px solid #F0E8E8;text-align:left;color:var(--text-light);font-size:11px"><th style="padding:8px 4px">时间</th><th style="padding:8px 4px">奶量</th><th style="padding:8px 4px">备注</th></tr></thead><tbody>';
    dayRecords.forEach(function(r) {
      totalDay += (r.amount || 0);
      html += '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:8px 4px;white-space:nowrap">' + formatTime(r.timestamp) + '</td>' +
        '<td style="padding:8px 4px;font-weight:600;color:var(--pink)">' + (r.amount || 0) + ' ml</td>' +
        '<td style="padding:8px 4px;color:var(--text-light);font-size:12px">' + (r.note || '') + '</td>' +
        '</tr>';
    });
    html += '<tr style="font-weight:700;border-top:2px solid var(--border)">' +
      '<td style="padding:10px 4px">当日合计</td>' +
      '<td style="padding:10px 4px;color:var(--pink)">' + totalDay + ' ml</td>' +
      '<td></td></tr>';
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
  var barW = Math.max(14, Math.min(32, cw / dates.length * 0.6));
  var gap = (cw - barW * dates.length) / (dates.length + 1);

  // Find max total for scale
  var maxTotal = 0;
  dates.forEach(function(d) { if (data[d].total > maxTotal) maxTotal = data[d].total; });
  if (maxTotal === 0) maxTotal = 1;

  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = '#F0E8E8';
  ctx.lineWidth = 1;
  var gridLines = 4;
  for (var i = 0; i <= gridLines; i++) {
    var y = pad.top + (ch / gridLines) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = '#888';
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
      ctx.fillStyle = '#4A4A4A';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(val, x + barW / 2, y - 4);
    }

    ctx.fillStyle = '#888';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    var dateLabel = (parseInt(d.slice(8, 10), 10)) + '日';
    ctx.fillText(dateLabel, x + barW / 2, pad.top + ch + 18);

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
    html += '<thead><tr style="border-bottom:2px solid #F0E8E8;text-align:left;color:var(--text-light);font-size:11px"><th style="padding:8px 4px">时间</th><th style="padding:8px 4px">类型</th><th style="padding:8px 4px">备注</th></tr></thead><tbody>';
    dayRecords.forEach(function(r) {
      var dt = r.diaper_type || '尿布';
      var icon = dt === '小便' ? '💧' : (dt === '大便' ? '💩' : '🧷');
      html += '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:8px 4px;white-space:nowrap">' + formatTime(r.timestamp) + '</td>' +
        '<td style="padding:8px 4px;font-weight:600;color:var(--pink)">' + icon + ' ' + dt + '</td>' +
        '<td style="padding:8px 4px;color:var(--text-light);font-size:12px">' + (r.note || '') + '</td>' +
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

  ctx.strokeStyle = '#F0E8E8';
  ctx.lineWidth = 1;
  var gridLines = 4;
  for (var i = 0; i <= gridLines; i++) {
    var y = pad.top + (ch / gridLines) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = '#888';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(((maxVal - (maxVal - minVal) / gridLines * i)).toFixed(1), pad.left - 6, y + 3);
  }

  var xGap = cw / Math.max(data.length - 1, 1);
  for (var j = 0; j < data.length; j++) {
    var r = data[j];
    var x = pad.left + j * xGap;
    ctx.fillStyle = '#888';
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
  ctx.fillStyle = '#4A4A4A';
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

  ctx.strokeStyle = '#F0E8E8';
  ctx.lineWidth = 1;
  var gridLines = 4;
  for (var i = 0; i <= gridLines; i++) {
    var y = pad.top + (ch / gridLines) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();

    ctx.fillStyle = '#888';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(((maxVal - (maxVal - minVal) / gridLines * i)).toFixed(1), pad.left - 6, y + 3);
  }

  var xGap = cw / Math.max(data.length - 1, 1);
  for (var j = 0; j < data.length; j++) {
    var r = data[j];
    var x = pad.left + j * xGap;
    ctx.fillStyle = '#888';
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
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).then(function(reg) {
      // SW registered
    }).catch(function(err) {
      // SW registration failed
    });
  }
}

// ------- Init -------
async function init() {
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

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
