/**
 * Google Maps タイムライン可視化アプリ
 */
(function () {
    // State
    let map = null;
    let allPlaces = new Map();
    let allVisits = [];
    let filteredPlaces = new Map();
    let filteredVisits = [];
    let dateRange = { min: null, max: null };
    let currentMode = 'markers';

    // Layers
    let markerLayer = null;
    let heatLayer = null;
    let clusterLayer = null;

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
            dateRange = result.dateRange;

            if (allVisits.length === 0) {
                progressText.textContent = 'データが見つかりませんでした。正しいファイルを選択してください。';
                progressFill.style.width = '0%';
                return;
            }

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

    // --- Map Screen ---
    function showMapScreen() {
        uploadScreen.hidden = true;
        mapScreen.hidden = false;

        if (!map) {
            initMap();
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
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                buttons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentMode = btn.dataset.mode;
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
            filteredPlaces = new Map();
            filteredVisits = [];
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

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // Start
    document.addEventListener('DOMContentLoaded', init);
})();
