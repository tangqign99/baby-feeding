/* ============================================
   宝宝喂养记录 PWA - 应用逻辑 v3.4 (Supabase)
   ============================================ */

// ------- Supabase -------
const SUPABASE_URL = 'https://nzbpopxrxniixnhnqktw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56YnBvcHhyeG5paXhuaG5xa3R3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4ODQ2MzQsImV4cCI6MjA5NzQ2MDYzNH0.wLk-FdQlKha8YObTvgINW2M_9QVSpJk8c91bKJeQO7Q';
var supabase;
var cachedRecords = [];
var _realtimeSub = null;

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
            toast('已从本地上传 ' + inserted.length + ' 条历史记录', 'success');
          }
        }
      } catch (e) { toast('本地数据迁移失败: ' + e.message, 'warning'); }
      localStorage.removeItem(STORAGE_KEY);
    }

    cachedRecords = normalizeTimestamps(data || []);
    var count = cachedRecords.length;
    if (count > 0) {
      toast('已加载 ' + count + ' 条云端记录', 'success');
    } else {
      toast('云端暂无记录，请先录入数据', 'info');
    }
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
  try {
    var { data, error } = await supabase.from('feeding_records').insert(cleanRecord).select();
    if (error) throw error;
    if (data && data.length > 0) {
      normalizeTimestamps(data);
      cachedRecords.unshift(data[0]);
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
function renderDashboard() {
  var records = getRecords();
  var settings = getSettings();
  document.getElementById('headerTitle').textContent = settings.babyName + '的喂养记录';
  
  // Summary: today
  var today = formatDate(Date.now());
  var todayRecords = records.filter(function(r) { return formatDate(r.timestamp) === today; });
  var totalMilk = 0, mealCount = 0, snackCount = 0;
  todayRecords.forEach(function(r) {
    if (r.type === 'milk') totalMilk += (r.amount || 0);
    if (r.type === 'meal') mealCount += 1;
    if (r.type === 'snack') snackCount += 1;
  });

  document.getElementById('dashSummary').innerHTML =
    '<div class="dash-item"><div class="value">' + totalMilk + '<span class="unit">ml</span></div><div class="label">今日奶量</div></div>' +
    '<div class="dash-item"><div class="value">' + mealCount + '</div><div class="label">吃饭次数</div></div>' +
    '<div class="dash-item"><div class="value">' + snackCount + '</div><div class="label">辅食次数</div></div>';

  // Timer: last feeding
  var feedingRecords = records.filter(function(r) { return r.type === 'milk' || r.type === 'meal' || r.type === 'snack'; });
  feedingRecords.sort(function(a, b) { return b.timestamp - a.timestamp; });
  var lastFeeding = feedingRecords[0];

  var timerCard = document.getElementById('timerCard');
  if (lastFeeding) {
    var diff = Date.now() - lastFeeding.timestamp;
    var h = Math.floor(diff / 3600000);
    var m = Math.floor((diff % 3600000) / 60000);
    var typeName = getTypeName(lastFeeding.type);
    var detail = '';
    if (lastFeeding.type === 'milk') detail = lastFeeding.amount + 'ml';
    else if (lastFeeding.subtype) detail = lastFeeding.subtype;

    timerCard.innerHTML =
      '<div class="timer-label">距上次' + typeName + '</div>' +
      '<div class="timer-value" id="timerValue">' + h + '小时' + m + '分钟</div>' +
      '<div class="timer-detail">' + detail + ' · ' + formatTime(lastFeeding.timestamp) + '</div>';
  } else {
    timerCard.innerHTML =
      '<div class="timer-label">距上次进食</div>' +
      '<div class="timer-value">--</div>' +
      '<div class="timer-detail">暂无喂养记录</div>';
  }

  // Recent 4 records — enhanced card style
  var recent = records.slice().sort(function(a, b) { return b.timestamp - a.timestamp; }).slice(0, 4);
  var recentHtml = '';
  if (recent.length === 0) {
    recentHtml = '<div style="text-align:center;padding:20px;color:var(--text-light);font-size:14px;">暂无记录，快去录入吧~</div>';
  } else {
    recent.forEach(function(r) {
      var desc = buildRecordDesc(r);
      recentHtml +=
        '<div class="record-card">' +
        '<div class="rc-icon-wrap" style="background:' + getIconBg(r.type) + '">' + getTypeIcon(r.type) + '</div>' +
        '<div class="rc-body">' +
        '<div class="rc-type">' + getTypeName(r.type) + '</div>' +
        '<div class="rc-detail">' + desc + '</div>' +
        '<div class="rc-meta"><span class="rc-time">' + formatTime(r.timestamp) + '</span><span class="rc-ago">' + timeAgo(r.timestamp) + '</span></div>' +
        '</div>' +
        '<button class="rc-delete-btn" title="删除" onclick="event.stopPropagation();deleteRecord(\'' + r.id + '\')">&times;</button>' +
        '</div>';
    });
  }
  document.getElementById('recentList').innerHTML = recentHtml;
}

function buildRecordDesc(r) {
  if (r.type === 'milk') return r.amount + ' ml' + (r.note ? ' · ' + r.note : '');
  if (r.type === 'meal' || r.type === 'snack') return (r.subtype || getTypeName(r.type)) + (r.portion ? ' · ' + r.portion + '量' : '') + (r.note ? ' · ' + r.note : '');
  if (r.type === 'height') return r.height + ' cm';
  if (r.type === 'weight') return r.weight + ' 斤';
  if (r.type === 'hw') return (r.height ? r.height + 'cm' : '') + (r.weight ? ' ' + r.weight + '斤' : '');
  return '';
}

// ------- Entry -------
var entryTab = 'milk';
var selectedPreset = '';
var selectedPortion = '';

function renderEntry() {
  var tabs = [
    { id: 'milk', label: '🍼 奶量' },
    { id: 'meal', label: '🍚 吃饭' },
    { id: 'snack', label: '🥄 辅食' },
    { id: 'height', label: '📏 身高' },
    { id: 'weight', label: '⚖️ 体重' }
  ];

  var tabHtml = '';
  tabs.forEach(function(t) {
    tabHtml += '<button class="tab-btn' + (entryTab === t.id ? ' active' : '') + '" data-tab="' + t.id + '">' + t.label + '</button>';
  });
  document.getElementById('entryTabs').innerHTML = tabHtml;

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
  return '<div class="datetime-row">' +
    '<span class="dt-label">时间</span>' +
    '<input type="datetime-local" id="entryDatetime" value="' + toDatetimeLocal(Date.now()) + '">' +
    '</div>';
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
  }
}

function getEntryTimestamp() {
  var el = document.getElementById('entryDatetime');
  if (el && el.value) {
    var ts = new Date(el.value).getTime();
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
  if (!subtype && customEl && customEl.value) subtype = customEl.value.trim();
  if (!subtype) { toast('请选择餐次或输入食物', 'warning'); return; }

  var noteEl = document.getElementById('mealNote');
  var note = noteEl ? noteEl.value.trim() : '';

  var record = {
    type: 'meal',
    subtype: subtype,
    portion: selectedPortion || undefined,
    timestamp: getEntryTimestamp(),
    note: note
  };

  await saveRecord(record);
  toast('记录成功：' + subtype + ' 🍚', 'success');
  entryTab = 'meal';
  selectedPreset = '';
  selectedPortion = '';
  renderEntry();
  navigateTo('dashboard');
}

async function recordSnack() {
  var subtype = selectedPreset;
  var customEl = document.getElementById('customSnack');
  if (!subtype && customEl && customEl.value) subtype = customEl.value.trim();
  if (!subtype) { toast('请选择辅食类型或输入名称', 'warning'); return; }

  var noteEl = document.getElementById('snackNote');
  var note = noteEl ? noteEl.value.trim() : '';

  var record = {
    type: 'snack',
    subtype: subtype,
    portion: selectedPortion || undefined,
    timestamp: getEntryTimestamp(),
    note: note
  };

  await saveRecord(record);
  toast('记录成功：' + subtype + ' 🥄', 'success');
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

// addRecord removed — use saveRecord(record) instead

// ------- Timeline -------
function renderTimeline() {
  var records = getRecords();
  var groups = groupByDate(records);
  var html = '';

  if (groups.length === 0) {
    html = '<div style="text-align:center;padding:40px;color:var(--text-light);font-size:15px;">暂无记录</div>';
  } else {
    groups.forEach(function(g) {
      html += '<div class="date-group"><div class="date-label">' + formatDateCN(new Date(g.date + 'T00:00:00').getTime()) + '</div>';
      g.items.forEach(function(r) {
        var desc = buildRecordDesc(r);

        html += '<div class="tl-item">' +
          '<div class="tl-icon">' + getTypeIcon(r.type) + '</div>' +
          '<div class="tl-content"><div class="tl-title">' + desc + '</div><div class="tl-time">' + formatTime(r.timestamp) + '</div></div>' +
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
  } else {
    html += '<div class="stat-empty">暂无奶量数据</div>';
  }
  html += '</div>';

  // H/W line chart with BMI
  html += '<div class="chart-container"><div class="chart-title">身高体重变化</div>';
  html += bmiText;
  if (hwChartData.length >= 2) {
    html += '<canvas id="hwChart" width="320" height="180" style="width:100%;max-width:420px"></canvas>';
  } else if (hwChartData.length === 1) {
    var r = hwChartData[0];
    html += '<div style="text-align:center;padding:16px;font-size:15px;">' +
      (r.height ? '身高: ' + r.height + 'cm  ' : '') +
      (r.weight ? '体重: ' + r.weight + '斤' : '') +
      '<br><span style="font-size:12px;color:var(--text-light)">至少需要2条记录才能绘制趋势图</span></div>';
  } else {
    html += '<div class="stat-empty">暂无身高体重数据</div>';
  }
  html += '</div>';

  container.innerHTML = html;

  if (hasMilk) drawMilkChart(days, milkValues, maxMilk);
  if (hwChartData.length >= 2) drawHWChartV2(hwChartData);
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
  });
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
  var allWVals = data.filter(function(d) { return d.weight !== undefined; }).map(function(d) { return d.weight * 10; });

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
        wPoints.push({ x: pad.left + k2 * xGap, y: pad.top + ch - (data[k2].weight * 10 - minVal) / (maxVal - minVal) * ch, val: data[k2].weight });
      }
    }
    drawLine(ctx, wPoints, '#5BA4CF', '体重(x10斤)');
  }

  ctx.font = '11px sans-serif';
  var legendY = pad.top + 4;
  if (drawHeight) {
    ctx.fillStyle = '#FF6B8A';
    ctx.fillText('● 身高(cm)', pad.left, legendY);
  }
  if (drawWeight) {
    ctx.fillStyle = '#5BA4CF';
    ctx.fillText('● 体重(x10斤)', drawHeight ? pad.left + 100 : pad.left, legendY);
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
  var feedingRecords = records.filter(function(r) { return r.type === 'milk' || r.type === 'meal' || r.type === 'snack'; });
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
  var records = getRecords();
  var feedingRecords = records.filter(function(r) { return r.type === 'milk' || r.type === 'meal' || r.type === 'snack'; });
  feedingRecords.sort(function(a, b) { return b.timestamp - a.timestamp; });
  var last = feedingRecords[0];
  var timerValue = document.getElementById('timerValue');
  if (!timerValue) return;
  if (last) {
    var diff = Date.now() - last.timestamp;
    var h = Math.floor(diff / 3600000);
    var m = Math.floor((diff % 3600000) / 60000);
    timerValue.textContent = h + '小时' + m + '分钟';
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

  setInterval(updateTimer, 30000);
  startNotifTimer();

  registerSW();
}

document.addEventListener('DOMContentLoaded', init);
