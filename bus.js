// バス停可視化 - メインアプリケーション

(function () {
  'use strict';

  let map;
  let markers = {};
  let activePopupStopId = null;
  let currentTimetableStop = null;
  let currentTimetableRoute = null;
  let currentTimetableDay = null;

  // ===== 初期化 =====
  function init() {
    initMap();
    drawRadiusCircle();
    placeMarkers();
    buildRouteLegend();
    updateClock();
    updateNextBuses();
    setInterval(updateClock, 1000);
    setInterval(updateNextBuses, 60000);
    setupMobileToggle();
    setupTimetableClose();
    setupTimetableTabs();
  }

  // ===== 地図初期化 =====
  function initMap() {
    map = L.map('map', {
      zoomControl: true,
      attributionControl: true
    }).setView([CENTER.lat, CENTER.lng], 15);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19
    }).addTo(map);

    // 中心マーカー（自宅位置）
    const homeIcon = L.divIcon({
      className: 'home-marker',
      html: '<div style="background:#e91e63;width:16px;height:16px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });

    L.marker([CENTER.lat, CENTER.lng], { icon: homeIcon, zIndexOffset: 1000 })
      .addTo(map)
      .bindPopup('<strong>岩戸南3-27-11</strong><br>（中心地点）');
  }

  // ===== 1km半径円 =====
  function drawRadiusCircle() {
    L.circle([CENTER.lat, CENTER.lng], {
      radius: RADIUS,
      color: '#1a237e',
      fillColor: '#1a237e',
      fillOpacity: 0.04,
      weight: 2,
      dashArray: '8,6',
      opacity: 0.4
    }).addTo(map);
  }

  // ===== バス停マーカー配置 =====
  function placeMarkers() {
    BUS_STOPS.forEach(function (stop) {
      const primaryRoute = stop.routes[0];
      const color = ROUTES[primaryRoute].color;

      const icon = L.divIcon({
        className: 'bus-stop-marker',
        html: '<div style="' +
          'background:' + color + ';' +
          'width:12px;height:12px;' +
          'border-radius:50%;' +
          'border:2px solid white;' +
          'box-shadow:0 1px 4px rgba(0,0,0,0.3);' +
          '"></div>',
        iconSize: [12, 12],
        iconAnchor: [6, 6]
      });

      const marker = L.marker([stop.lat, stop.lng], { icon: icon })
        .addTo(map);

      marker.bindPopup(function () { return createPopupContent(stop); }, {
        maxWidth: 280,
        minWidth: 220
      });

      marker.on('click', function () {
        activePopupStopId = stop.id;
      });

      markers[stop.id] = marker;
    });
  }

  // ===== ポップアップ内容生成 =====
  function createPopupContent(stop) {
    const now = new Date();
    const dayType = getDayType(now);

    let html = '<div class="popup-title">' + stop.name + '</div>';
    html += '<ul class="popup-routes">';

    stop.routes.forEach(function (routeId) {
      const route = ROUTES[routeId];
      html += '<li><span class="popup-route-dot" style="background:' + route.color + '"></span>' +
        '<span>' + route.name + '</span></li>';
    });
    html += '</ul>';

    // 次のバス
    const nextBuses = getNextBusesForStop(stop.id, now, dayType);
    if (nextBuses.length > 0) {
      const next = nextBuses[0];
      const mins = getMinutesUntil(now, next.time);
      html += '<div class="popup-next">';
      html += '次のバス: <strong>' + mins + '分後</strong>（' + next.time + '）';
      html += '<br><span style="font-size:0.8rem;color:#666;">' +
        ROUTES[next.routeId].name + ' ' + next.direction + '</span>';
      html += '</div>';
    } else {
      html += '<div class="popup-next" style="background:#f5f5f5;">本日の運行は終了</div>';
    }

    // 時刻表ボタン
    stop.routes.forEach(function (routeId) {
      if (TIMETABLES[stop.id] && TIMETABLES[stop.id][routeId]) {
        html += '<button class="popup-btn" onclick="window.busApp.showTimetable(\'' +
          stop.id + '\',\'' + routeId + '\')">' +
          ROUTES[routeId].name + ' の時刻表を見る</button>';
      }
    });

    return html;
  }

  // ===== 路線凡例 =====
  function buildRouteLegend() {
    const list = document.getElementById('route-legend');
    Object.keys(ROUTES).forEach(function (routeId) {
      const route = ROUTES[routeId];
      const li = document.createElement('li');
      li.innerHTML = '<span class="legend-color" style="background:' + route.color + '"></span>' +
        '<span class="legend-name">' + route.name + '</span>' +
        '<span class="legend-desc">' + route.description + '</span>';
      list.appendChild(li);
    });
  }

  // ===== 曜日判定 =====
  function getDayType(date) {
    const day = date.getDay();
    // 簡易的な祝日判定（日曜 + 主要祝日）
    const holidays = getHolidays(date.getFullYear());
    const dateStr = formatDate(date);

    if (holidays.indexOf(dateStr) >= 0 || day === 0) return 'holiday';
    if (day === 6) return 'saturday';
    return 'weekday';
  }

  function formatDate(date) {
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return date.getFullYear() + '-' + m + '-' + d;
  }

  function getHolidays(year) {
    // 日本の主要祝日（固定日）
    return [
      year + '-01-01', // 元旦
      year + '-01-13', // 成人の日（第2月曜の概算）
      year + '-02-11', // 建国記念の日
      year + '-02-23', // 天皇誕生日
      year + '-03-20', // 春分の日（概算）
      year + '-04-29', // 昭和の日
      year + '-05-03', // 憲法記念日
      year + '-05-04', // みどりの日
      year + '-05-05', // こどもの日
      year + '-07-21', // 海の日（概算）
      year + '-08-11', // 山の日
      year + '-09-15', // 敬老の日（概算）
      year + '-09-23', // 秋分の日（概算）
      year + '-10-13', // スポーツの日（概算）
      year + '-11-03', // 文化の日
      year + '-11-23', // 勤労感謝の日
    ];
  }

  function getDayTypeLabel(dayType) {
    var labels = { weekday: '平日', saturday: '土曜', holiday: '日祝' };
    return labels[dayType] || '平日';
  }

  // ===== 時刻計算 =====
  function timeToMinutes(timeStr) {
    var parts = timeStr.split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  }

  function currentTimeMinutes(date) {
    return date.getHours() * 60 + date.getMinutes();
  }

  function getMinutesUntil(now, timeStr) {
    var nowMin = currentTimeMinutes(now);
    var targetMin = timeToMinutes(timeStr);
    var diff = targetMin - nowMin;
    return diff >= 0 ? diff : diff + 1440;
  }

  function getNextBusesForStop(stopId, now, dayType) {
    var results = [];
    var nowMin = currentTimeMinutes(now);

    if (!TIMETABLES[stopId]) return results;

    Object.keys(TIMETABLES[stopId]).forEach(function (routeId) {
      var timetable = TIMETABLES[stopId][routeId];
      var times = timetable[dayType] || timetable.weekday || [];
      var direction = timetable.direction || '';

      for (var i = 0; i < times.length; i++) {
        if (timeToMinutes(times[i]) > nowMin) {
          results.push({
            time: times[i],
            routeId: routeId,
            direction: direction,
            minutesUntil: timeToMinutes(times[i]) - nowMin
          });
          break;
        }
      }
    });

    results.sort(function (a, b) { return a.minutesUntil - b.minutesUntil; });
    return results;
  }

  // ===== 次のバス一覧更新 =====
  function updateNextBuses() {
    var now = new Date();
    var dayType = getDayType(now);
    var nowMin = currentTimeMinutes(now);
    var allNextBuses = [];

    BUS_STOPS.forEach(function (stop) {
      if (!TIMETABLES[stop.id]) return;

      Object.keys(TIMETABLES[stop.id]).forEach(function (routeId) {
        var timetable = TIMETABLES[stop.id][routeId];
        var times = timetable[dayType] || timetable.weekday || [];
        var direction = timetable.direction || '';

        for (var i = 0; i < times.length; i++) {
          var targetMin = timeToMinutes(times[i]);
          if (targetMin > nowMin) {
            allNextBuses.push({
              stopId: stop.id,
              stopName: stop.name,
              time: times[i],
              routeId: routeId,
              direction: direction,
              minutesUntil: targetMin - nowMin
            });
            // 各バス停・路線から次の1本だけ
            break;
          }
        }
      });
    });

    allNextBuses.sort(function (a, b) { return a.minutesUntil - b.minutesUntil; });

    // 上位10件表示
    var list = document.getElementById('next-bus-list');
    var noMsg = document.getElementById('no-bus-message');

    if (allNextBuses.length === 0) {
      list.innerHTML = '';
      noMsg.style.display = 'block';
      return;
    }

    noMsg.style.display = 'none';
    var html = '';
    var top = allNextBuses.slice(0, 10);

    top.forEach(function (bus) {
      var route = ROUTES[bus.routeId];
      var imminent = bus.minutesUntil <= 5 ? ' imminent' : '';

      html += '<li class="next-bus-item' + imminent + '" ' +
        'style="border-left-color:' + route.color + ';" ' +
        'onclick="window.busApp.focusStop(\'' + bus.stopId + '\')">' +
        '<div class="bus-time-left" style="color:' + route.color + ';">' +
        bus.minutesUntil + '<span class="unit">分</span></div>' +
        '<div class="bus-info">' +
        '<div class="bus-stop-name">' + bus.stopName + '</div>' +
        '<div class="bus-route-name">' + route.name + '</div>' +
        '<div class="bus-direction">' + bus.direction + '</div>' +
        '</div>' +
        '<div class="bus-depart-time">' + bus.time + '</div>' +
        '</li>';
    });

    list.innerHTML = html;
  }

  // ===== 時計更新 =====
  function updateClock() {
    var now = new Date();
    var h = String(now.getHours()).padStart(2, '0');
    var m = String(now.getMinutes()).padStart(2, '0');
    var s = String(now.getSeconds()).padStart(2, '0');
    document.getElementById('clock').textContent = h + ':' + m + ':' + s;

    var dayType = getDayType(now);
    document.getElementById('day-type').textContent = getDayTypeLabel(dayType);
  }

  // ===== 時刻表表示 =====
  function showTimetable(stopId, routeId) {
    var stop = BUS_STOPS.find(function (s) { return s.id === stopId; });
    if (!stop || !TIMETABLES[stopId] || !TIMETABLES[stopId][routeId]) return;

    currentTimetableStop = stopId;
    currentTimetableRoute = routeId;

    var now = new Date();
    currentTimetableDay = getDayType(now);

    document.getElementById('timetable-title').textContent = stop.name;
    document.getElementById('timetable-route-name').textContent =
      ROUTES[routeId].name + '　' + TIMETABLES[stopId][routeId].direction;

    // タブアクティブ設定
    var tabs = document.querySelectorAll('.timetable-tab');
    tabs.forEach(function (tab) {
      tab.classList.toggle('active', tab.getAttribute('data-day') === currentTimetableDay);
    });

    renderTimetableGrid(stopId, routeId, currentTimetableDay);

    document.getElementById('timetable-section').classList.add('active');
    // サイドパネルをスクロール
    document.getElementById('timetable-section').scrollIntoView({ behavior: 'smooth' });

    // ポップアップを閉じる
    map.closePopup();
  }

  function renderTimetableGrid(stopId, routeId, dayType) {
    var timetable = TIMETABLES[stopId][routeId];
    var times = timetable[dayType] || timetable.weekday || [];
    var now = new Date();
    var nowMin = currentTimeMinutes(now);
    var currentDayType = getDayType(now);
    var isToday = dayType === currentDayType;

    // 時間帯ごとにグループ化
    var hourGroups = {};
    times.forEach(function (t) {
      var hour = parseInt(t.split(':')[0], 10);
      if (!hourGroups[hour]) hourGroups[hour] = [];
      hourGroups[hour].push(t);
    });

    var grid = document.getElementById('timetable-grid');
    var html = '';
    var foundNext = false;

    var hours = Object.keys(hourGroups).map(Number).sort(function (a, b) { return a - b; });
    hours.forEach(function (hour) {
      html += '<div class="timetable-hour">' + hour + '</div>';
      html += '<div class="timetable-minutes">';

      hourGroups[hour].forEach(function (t) {
        var min = t.split(':')[1];
        var tMin = timeToMinutes(t);
        var cls = '';

        if (isToday) {
          if (tMin <= nowMin) {
            cls = ' class="past"';
          } else if (!foundNext) {
            cls = ' class="next"';
            foundNext = true;
          }
        }

        html += '<span' + cls + '>' + min + '</span>';
      });

      html += '</div>';
    });

    grid.innerHTML = html;
  }

  // ===== 時刻表のタブ切り替え =====
  function setupTimetableTabs() {
    document.getElementById('timetable-tabs').addEventListener('click', function (e) {
      var tab = e.target.closest('.timetable-tab');
      if (!tab) return;

      var dayType = tab.getAttribute('data-day');
      currentTimetableDay = dayType;

      var tabs = document.querySelectorAll('.timetable-tab');
      tabs.forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');

      if (currentTimetableStop && currentTimetableRoute) {
        renderTimetableGrid(currentTimetableStop, currentTimetableRoute, dayType);
      }
    });
  }

  // ===== 時刻表を閉じる =====
  function setupTimetableClose() {
    document.getElementById('timetable-close').addEventListener('click', function () {
      document.getElementById('timetable-section').classList.remove('active');
    });
  }

  // ===== マーカーにフォーカス =====
  function focusStop(stopId) {
    var stop = BUS_STOPS.find(function (s) { return s.id === stopId; });
    if (!stop) return;

    map.setView([stop.lat, stop.lng], 17, { animate: true });
    if (markers[stopId]) {
      markers[stopId].openPopup();
    }
  }

  // ===== モバイルトグル =====
  function setupMobileToggle() {
    var btn = document.getElementById('mobile-toggle');
    var panel = document.getElementById('side-panel');
    var isCollapsed = false;

    btn.addEventListener('click', function () {
      isCollapsed = !isCollapsed;
      panel.classList.toggle('collapsed', isCollapsed);
      btn.innerHTML = isCollapsed ? '&#x1F4CB; 次のバスを見る' : '&#x1F5FA; 地図を見る';
    });
  }

  // ===== 公開API（ポップアップから呼び出し用） =====
  window.busApp = {
    showTimetable: showTimetable,
    focusStop: focusStop
  };

  // ===== DOM Ready =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
