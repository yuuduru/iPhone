/**
 * Google Maps タイムライン可視化アプリ
 */
(function () {
    // State
    let map = null;
    let allPlaces = new Map();
    let allVisits = [];
    let allActivities = [];
    let allTimelinePaths = [];
    let filteredPlaces = new Map();
    let filteredVisits = [];
    let dateRange = { min: null, max: null };
    let currentMode = 'markers';

    // Route state
    let dailyTimeline = new Map(); // "YYYY-MM-DD" → DayData
    let selectedDate = null;
    let sortedDates = [];           // dailyTimelineのキーをソート済みで保持

    // Layers
    let markerLayer = null;
    let heatLayer = null;
    let clusterLayer = null;
    let routeLayer = null;
    let routeMarkerLayer = null;

    // DOM elements
    const uploadScreen = document.getElementById('upload-screen');
    const mapScreen = document.getElementById('map-screen');
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const fileSelectBtn = document.getElementById('file-select-btn');
    const uploadProgress = document.getElementById('upload-progress');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebarOpen = document.getElementById('sidebar-open');
    const filterStart = document.getElementById('filter-start');
    const filterEnd = document.getElementById('filter-end');
    const filterApply = document.getElementById('filter-apply');
    const filterReset = document.getElementById('filter-reset');
    const reuploadBtn = document.getElementById('reupload-btn');

    // Init
    function init() {
        setupUpload();
        setupSidebar();
        setupFilters();
        setupViewModes();
        setupRouteNavigation();
        setupReupload();
    }

    // --- Upload ---
    function setupUpload() {
        fileSelectBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', handleFileSelect);

        dropZone.addEventListener('click', (e) => {
            if (e.target !== fileSelectBtn) fileInput.click();
        });

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('drag-over');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.json'));
            if (files.length > 0) processFiles(files);
        });
    }

    function handleFileSelect(e) {
        const files = Array.from(e.target.files);
        if (files.length > 0) processFiles(files);
    }

    async function processFiles(files) {
        uploadProgress.hidden = false;
        progressFill.style.width = '0%';
        progressText.textContent = `${files.length}個のファイルを読み込み中...`;

        try {
            const result = await TimelineParser.parseFiles(files, (progress) => {
                progressFill.style.width = `${progress}%`;
            });

            allPlaces = result.places;
            allVisits = result.visits;
            allActivities = result.activities || [];
            allTimelinePaths = result.timelinePaths || [];
            dateRange = result.dateRange;

            if (allVisits.length === 0) {
                progressText.textContent = 'データが見つかりませんでした。正しいファイルを選択してください。';
                progressFill.style.width = '0%';
                return;
            }

            // 日次タイムラインインデックスを構築
            dailyTimeline = buildDailyTimeline(allVisits, allActivities, allTimelinePaths);
            sortedDates = Array.from(dailyTimeline.keys()).sort();

            progressText.textContent = `${allVisits.length.toLocaleString()}件のデータを読み込みました`;

            // フィルターなしで全データ表示
            filteredPlaces = allPlaces;
            filteredVisits = allVisits;

            setTimeout(() => {
                showMapScreen();
            }, 500);

        } catch (err) {
            console.error('Parse error:', err);
            progressText.textContent = `エラー: ${err.message}`;
            progressFill.style.width = '0%';
        }
    }

    // --- Daily Timeline Index ---
    function buildDailyTimeline(visits, activities, timelinePaths) {
        const timeline = new Map();

        function getOrCreateDay(dateStr) {
            if (!timeline.has(dateStr)) {
                timeline.set(dateStr, {
                    date: dateStr,
                    visits: [],
                    activities: [],
                    timelinePaths: [],
                    totalDistanceMeters: 0,
                    transportBreakdown: new Map(),
                });
            }
            return timeline.get(dateStr);
        }

        for (const v of visits) {
            const dateStr = toISODate(new Date(v.timestamp));
            getOrCreateDay(dateStr).visits.push(v);
        }

        for (const a of activities) {
            const dateStr = toISODate(new Date(a.startTime));
            const day = getOrCreateDay(dateStr);
            day.activities.push(a);
            day.totalDistanceMeters += a.distanceMeters;
            const existing = day.transportBreakdown.get(a.transportType) || 0;
            day.transportBreakdown.set(a.transportType, existing + a.distanceMeters);
        }

        for (const tp of timelinePaths) {
            const dateStr = toISODate(new Date(tp.startTime));
            getOrCreateDay(dateStr).timelinePaths.push(tp);
        }

        return timeline;
    }

    // --- Map Screen ---
    function showMapScreen() {
        uploadScreen.hidden = true;
        mapScreen.hidden = false;

        if (!map) {
            initMap();
        }

        // ルートボタンの有効/無効
        const routeBtn = document.getElementById('route-mode-btn');
        if (allActivities.length === 0) {
            routeBtn.disabled = true;
            routeBtn.title = 'ルートデータがありません';
        } else {
            routeBtn.disabled = false;
            routeBtn.title = '';
        }

        updateStats();
        updateDateFilter();
        updateTopPlaces();
        renderMap();
    }

    function initMap() {
        map = L.map('map', {
            zoomControl: true,
            attributionControl: true,
        }).setView([35.6812, 139.7671], 5); // 初期表示: 日本

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 19,
        }).addTo(map);

        markerLayer = L.layerGroup().addTo(map);
        clusterLayer = L.markerClusterGroup({
            maxClusterRadius: 50,
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
        });
        routeLayer = L.layerGroup();
        routeMarkerLayer = L.layerGroup();
    }

    function renderMap() {
        clearLayers();

        switch (currentMode) {
            case 'markers':
                renderMarkers();
                break;
            case 'heatmap':
                renderHeatmap();
                break;
            case 'cluster':
                renderClusters();
                break;
            case 'route':
                renderRoute();
                return; // renderRouteが独自にfitBoundsする
        }

        fitBounds();
    }

    function clearLayers() {
        if (markerLayer) markerLayer.clearLayers();
        if (heatLayer) {
            map.removeLayer(heatLayer);
            heatLayer = null;
        }
        if (clusterLayer) {
            map.removeLayer(clusterLayer);
            clusterLayer.clearLayers();
        }
        if (routeLayer) {
            map.removeLayer(routeLayer);
            routeLayer.clearLayers();
        }
        if (routeMarkerLayer) {
            map.removeLayer(routeMarkerLayer);
            routeMarkerLayer.clearLayers();
        }
    }

    function renderMarkers() {
        const places = Array.from(filteredPlaces.values());
        // 訪問数で色分け
        const maxVisits = Math.max(...places.map(p => p.visitCount), 1);

        for (const place of places) {
            const intensity = Math.min(place.visitCount / maxVisits, 1);
            const color = getMarkerColor(intensity);
            const radius = Math.max(4, Math.min(12, 4 + (intensity * 8)));

            const marker = L.circleMarker([place.lat, place.lng], {
                radius,
                fillColor: color,
                color: '#fff',
                weight: 1.5,
                fillOpacity: 0.8,
            });

            marker.bindPopup(createPopupContent(place));
            markerLayer.addLayer(marker);
        }

        map.addLayer(markerLayer);
    }

    function renderHeatmap() {
        const heatData = [];
        for (const place of filteredPlaces.values()) {
            heatData.push([place.lat, place.lng, place.visitCount]);
        }

        heatLayer = L.heatLayer(heatData, {
            radius: 20,
            blur: 15,
            maxZoom: 17,
            max: Math.max(...heatData.map(d => d[2]), 1),
            gradient: {
                0.2: '#2196f3',
                0.4: '#4caf50',
                0.6: '#ffeb3b',
                0.8: '#ff9800',
                1.0: '#f44336',
            },
        }).addTo(map);
    }

    function renderClusters() {
        clusterLayer.clearLayers();

        for (const place of filteredPlaces.values()) {
            const marker = L.marker([place.lat, place.lng]);
            marker.bindPopup(createPopupContent(place));
            clusterLayer.addLayer(marker);
        }

        map.addLayer(clusterLayer);
    }

    // --- Route Rendering ---
    function renderRoute() {
        if (!selectedDate) {
            // 自動で直近日を選択
            if (sortedDates.length > 0) {
                selectedDate = sortedDates[sortedDates.length - 1];
                document.getElementById('route-date-input').value = selectedDate;
            } else {
                return;
            }
        }

        const dayData = dailyTimeline.get(selectedDate);
        if (!dayData) {
            updateRouteSummaryEmpty();
            return;
        }

        routeLayer.clearLayers();
        routeMarkerLayer.clearLayers();

        const allPoints = [];

        // 移動区間のポリラインを描画
        for (const activity of dayData.activities) {
            const polylinePoints = getRoutePoints(activity, dayData.timelinePaths);
            const color = getTransportColor(activity.transportType);

            const polyline = L.polyline(polylinePoints, {
                color: color,
                weight: 4,
                opacity: 0.8,
                dashArray: getDashArray(activity.transportType),
            });

            polyline.bindPopup(`<div class="route-popup">
                <h4>${getTransportLabel(activity.transportType)}</h4>
                <p>${formatTime(activity.startTime)} - ${formatTime(activity.endTime)}</p>
                <p>${formatDistance(activity.distanceMeters)}</p>
            </div>`);

            routeLayer.addLayer(polyline);

            allPoints.push([activity.startLat, activity.startLng]);
            allPoints.push([activity.endLat, activity.endLng]);
        }

        // 訪問地点のマーカーを描画
        dayData.visits.forEach((visit, index) => {
            const marker = L.marker([visit.lat, visit.lng], {
                icon: createNumberedIcon(index + 1),
                zIndexOffset: 1000,
            });

            const durationStr = visit.endTimestamp
                ? `<p class="route-duration">滞在: ${formatDuration(visit.endTimestamp - visit.timestamp)}</p>`
                : '';

            marker.bindPopup(`<div class="route-popup">
                <h4>${escapeHtml(visit.name || '訪問地点 #' + (index + 1))}</h4>
                <p>到着: ${formatTime(visit.timestamp)}</p>
                ${visit.endTimestamp ? `<p>出発: ${formatTime(visit.endTimestamp)}</p>` : ''}
                ${durationStr}
            </div>`);

            routeMarkerLayer.addLayer(marker);
            allPoints.push([visit.lat, visit.lng]);
        });

        map.addLayer(routeLayer);
        map.addLayer(routeMarkerLayer);

        // 表示範囲を調整
        if (allPoints.length > 0) {
            map.fitBounds(L.latLngBounds(allPoints), { padding: [50, 50], maxZoom: 15 });
        }

        updateRouteSummary(dayData);
    }

    /**
     * activityの時間帯に合致するtimelinePathのGPS点を取得
     * なければstart→endの直線を返す
     */
    function getRoutePoints(activity, timelinePaths) {
        const matchingPoints = [];

        for (const tp of timelinePaths) {
            // 時間帯の重複チェック
            if (tp.endTime < activity.startTime || tp.startTime > activity.endTime) continue;

            for (const pt of tp.points) {
                if (pt.timestamp >= activity.startTime && pt.timestamp <= activity.endTime) {
                    matchingPoints.push({ lat: pt.lat, lng: pt.lng, timestamp: pt.timestamp });
                }
            }
        }

        if (matchingPoints.length >= 2) {
            matchingPoints.sort((a, b) => a.timestamp - b.timestamp);
            return matchingPoints.map(p => [p.lat, p.lng]);
        }

        // フォールバック: start→end の直線
        return [
            [activity.startLat, activity.startLng],
            [activity.endLat, activity.endLng],
        ];
    }

    // --- Transport Styling ---
    function getTransportColor(type) {
        const colors = {
            'in passenger vehicle': '#4285f4',
            'walking': '#34a853',
            'in train': '#ea4335',
            'in bus': '#fbbc04',
            'cycling': '#ff6d01',
            'in subway': '#9c27b0',
            'flying': '#00bcd4',
            'in tram': '#795548',
            'in ferry': '#607d8b',
            'running': '#e91e63',
        };
        return colors[type] || '#9e9e9e';
    }

    function getDashArray(type) {
        if (type === 'walking' || type === 'running') return '6, 8';
        if (type === 'cycling') return '10, 5';
        return null;
    }

    function getTransportLabel(type) {
        const labels = {
            'in passenger vehicle': '車',
            'walking': '徒歩',
            'in train': '電車',
            'in bus': 'バス',
            'cycling': '自転車',
            'in subway': '地下鉄',
            'flying': '飛行機',
            'in tram': '路面電車',
            'in ferry': 'フェリー',
            'running': 'ランニング',
        };
        return labels[type] || type;
    }

    function createNumberedIcon(number) {
        return L.divIcon({
            className: 'route-marker-icon',
            html: `<div class="route-marker-number">${number}</div>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
            popupAnchor: [0, -14],
        });
    }

    // --- Route Summary ---
    function updateRouteSummary(dayData) {
        const container = document.getElementById('route-summary');
        const visitCount = dayData.visits.length;
        const totalKm = (dayData.totalDistanceMeters / 1000).toFixed(1);
        const activityCount = dayData.activities.length;

        let breakdownHtml = '';
        for (const [type, meters] of dayData.transportBreakdown) {
            const km = (meters / 1000).toFixed(1);
            const color = getTransportColor(type);
            const label = getTransportLabel(type);
            breakdownHtml += `
                <div class="transport-item">
                    <span class="transport-color" style="background:${color}"></span>
                    <span class="transport-label">${label}</span>
                    <span class="transport-distance">${km} km</span>
                </div>
            `;
        }

        container.innerHTML = `
            <div class="route-stats">
                <div class="route-stat">
                    <span class="route-stat-value">${visitCount}</span>
                    <span class="route-stat-label">訪問</span>
                </div>
                <div class="route-stat">
                    <span class="route-stat-value">${totalKm}</span>
                    <span class="route-stat-label">km</span>
                </div>
                <div class="route-stat">
                    <span class="route-stat-value">${activityCount}</span>
                    <span class="route-stat-label">移動</span>
                </div>
            </div>
            ${breakdownHtml ? `<div class="transport-breakdown">${breakdownHtml}</div>` : ''}
        `;
    }

    function updateRouteSummaryEmpty() {
        const container = document.getElementById('route-summary');
        container.innerHTML = '<p style="color:var(--text-light);font-size:13px;">この日のデータはありません</p>';
    }

    // --- Route Date Navigation ---
    function setupRouteNavigation() {
        const dateInput = document.getElementById('route-date-input');
        const prevBtn = document.getElementById('route-prev');
        const nextBtn = document.getElementById('route-next');

        dateInput.addEventListener('change', () => {
            selectedDate = dateInput.value;
            if (currentMode === 'route') renderMap();
        });

        prevBtn.addEventListener('click', () => navigateDate(-1));
        nextBtn.addEventListener('click', () => navigateDate(1));
    }

    function navigateDate(direction) {
        if (sortedDates.length === 0) return;

        if (!selectedDate) {
            selectedDate = sortedDates[sortedDates.length - 1];
        } else {
            const currentIndex = sortedDates.indexOf(selectedDate);
            if (currentIndex === -1) {
                // 現在の日付がデータにない場合、最も近い日を探す
                selectedDate = sortedDates[sortedDates.length - 1];
            } else {
                const newIndex = currentIndex + direction;
                if (newIndex >= 0 && newIndex < sortedDates.length) {
                    selectedDate = sortedDates[newIndex];
                }
            }
        }

        document.getElementById('route-date-input').value = selectedDate;
        if (currentMode === 'route') renderMap();
    }

    function fitBounds() {
        const points = Array.from(filteredPlaces.values()).map(p => [p.lat, p.lng]);
        if (points.length > 0) {
            const bounds = L.latLngBounds(points);
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
        }
    }

    function getMarkerColor(intensity) {
        // 青 → 緑 → 黄 → オレンジ → 赤
        if (intensity < 0.2) return '#2196f3';
        if (intensity < 0.4) return '#4caf50';
        if (intensity < 0.6) return '#ffeb3b';
        if (intensity < 0.8) return '#ff9800';
        return '#f44336';
    }

    function createPopupContent(place) {
        const name = place.name || '不明な場所';
        const address = place.address || '';
        const firstVisit = place.visits[0]
            ? formatDate(new Date(place.visits[0].timestamp))
            : '';
        const lastVisit = place.visits[place.visits.length - 1]
            ? formatDate(new Date(place.visits[place.visits.length - 1].timestamp))
            : '';

        return `<div class="location-popup">
            <h4>${escapeHtml(name)}</h4>
            ${address ? `<p>${escapeHtml(address)}</p>` : ''}
            <p class="visit-count">${place.visitCount}回訪問</p>
            ${firstVisit ? `<p>初回: ${firstVisit}</p>` : ''}
            ${lastVisit && lastVisit !== firstVisit ? `<p>最終: ${lastVisit}</p>` : ''}
        </div>`;
    }

    // --- Stats ---
    function updateStats() {
        document.getElementById('stat-total-places').textContent =
            filteredPlaces.size.toLocaleString();
        document.getElementById('stat-total-visits').textContent =
            filteredVisits.length.toLocaleString();

        if (dateRange.min && dateRange.max) {
            const min = formatDate(dateRange.min);
            const max = formatDate(dateRange.max);
            document.getElementById('stat-date-range').textContent =
                min === max ? min : `${min} ~ ${max}`;
        }
    }

    // --- Date Filter ---
    function updateDateFilter() {
        if (dateRange.min) {
            filterStart.value = toISODate(dateRange.min);
            filterStart.min = toISODate(dateRange.min);
        }
        if (dateRange.max) {
            filterEnd.value = toISODate(dateRange.max);
            filterEnd.max = toISODate(dateRange.max);
        }
    }

    function setupFilters() {
        filterApply.addEventListener('click', applyFilter);
        filterReset.addEventListener('click', resetFilter);
    }

    function applyFilter() {
        const startDate = filterStart.value ? new Date(filterStart.value).getTime() : null;
        const endDate = filterEnd.value ? new Date(filterEnd.value + 'T23:59:59').getTime() : null;

        if (!startDate && !endDate) return;

        filteredVisits = allVisits.filter(v => {
            if (startDate && v.timestamp < startDate) return false;
            if (endDate && v.timestamp > endDate) return false;
            return true;
        });

        // filteredPlacesを再計算
        filteredPlaces = new Map();
        for (const visit of filteredVisits) {
            const key = getPlaceKeyFromVisit(visit);
            if (filteredPlaces.has(key)) {
                const place = filteredPlaces.get(key);
                place.visitCount++;
                place.visits.push(visit);
            } else {
                filteredPlaces.set(key, {
                    key,
                    lat: visit.lat,
                    lng: visit.lng,
                    name: visit.name,
                    address: visit.address,
                    placeId: visit.placeId,
                    visitCount: 1,
                    visits: [visit],
                });
            }
        }

        updateStats();
        updateTopPlaces();
        renderMap();
    }

    function resetFilter() {
        filteredPlaces = allPlaces;
        filteredVisits = allVisits;

        updateDateFilter();
        updateStats();
        updateTopPlaces();
        renderMap();
    }

    function getPlaceKeyFromVisit(visit) {
        if (visit.placeId) return `pid:${visit.placeId}`;
        const latRound = Math.round(visit.lat * 2000) / 2000;
        const lngRound = Math.round(visit.lng * 2000) / 2000;
        return `${latRound},${lngRound}`;
    }

    // --- Top Places ---
    function updateTopPlaces() {
        const list = document.getElementById('top-places-list');
        const sorted = Array.from(filteredPlaces.values())
            .sort((a, b) => b.visitCount - a.visitCount)
            .slice(0, 20);

        list.innerHTML = '';

        sorted.forEach((place, i) => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span class="place-rank">${i + 1}</span>
                <div class="place-info">
                    <div class="place-name">${escapeHtml(place.name || '不明な場所')}</div>
                    ${place.address ? `<div class="place-address">${escapeHtml(place.address)}</div>` : ''}
                </div>
                <span class="place-count">${place.visitCount}回</span>
            `;

            li.addEventListener('click', () => {
                map.setView([place.lat, place.lng], 16);
                // モバイルではサイドバーを閉じる
                if (window.innerWidth <= 768) {
                    sidebar.classList.add('collapsed');
                }
            });

            list.appendChild(li);
        });
    }

    // --- View Modes ---
    function setupViewModes() {
        const buttons = document.querySelectorAll('.view-btn');
        const routePanel = document.getElementById('route-panel');

        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.disabled) return;

                buttons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentMode = btn.dataset.mode;

                // ルートパネルの表示/非表示
                if (currentMode === 'route') {
                    routePanel.hidden = false;
                    if (!selectedDate && sortedDates.length > 0) {
                        selectedDate = sortedDates[sortedDates.length - 1];
                        document.getElementById('route-date-input').value = selectedDate;
                    }
                } else {
                    routePanel.hidden = true;
                }

                renderMap();
            });
        });
    }

    // --- Sidebar ---
    function setupSidebar() {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.add('collapsed');
        });

        sidebarOpen.addEventListener('click', () => {
            sidebar.classList.remove('collapsed');
        });
    }

    // --- Reupload ---
    function setupReupload() {
        reuploadBtn.addEventListener('click', () => {
            mapScreen.hidden = true;
            uploadScreen.hidden = false;
            uploadProgress.hidden = true;
            fileInput.value = '';

            clearLayers();
            allPlaces = new Map();
            allVisits = [];
            allActivities = [];
            allTimelinePaths = [];
            filteredPlaces = new Map();
            filteredVisits = [];
            dailyTimeline = new Map();
            selectedDate = null;
            sortedDates = [];

            // ルートパネルを閉じてマーカーモードに戻す
            document.getElementById('route-panel').hidden = true;
            const buttons = document.querySelectorAll('.view-btn');
            buttons.forEach(b => b.classList.remove('active'));
            const markersBtn = document.querySelector('.view-btn[data-mode="markers"]');
            if (markersBtn) markersBtn.classList.add('active');
            currentMode = 'markers';
        });
    }

    // --- Helpers ---
    function formatDate(date) {
        if (!date) return '';
        const d = date instanceof Date ? date : new Date(date);
        return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    }

    function toISODate(date) {
        const d = date instanceof Date ? date : new Date(date);
        return d.toISOString().split('T')[0];
    }

    function formatTime(timestamp) {
        const d = new Date(timestamp);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    function formatDuration(ms) {
        const totalMinutes = Math.round(ms / 60000);
        if (totalMinutes < 60) return `${totalMinutes}分`;
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return minutes > 0 ? `${hours}時間${minutes}分` : `${hours}時間`;
    }

    function formatDistance(meters) {
        if (meters < 1000) return `${Math.round(meters)} m`;
        return `${(meters / 1000).toFixed(1)} km`;
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // Start
    document.addEventListener('DOMContentLoaded', init);
})();
