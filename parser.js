/**
 * Google Takeout ロケーション履歴データパーサー
 * 複数のフォーマットに対応:
 * - Records.json (新フォーマット)
 * - Semantic Location History (月別JSON)
 * - Location History.json (旧フォーマット)
 */

const TimelineParser = (() => {
    /**
     * 複数ファイルを解析して統合した訪問データを返す
     * @param {File[]} files
     * @param {function} onProgress - 進捗コールバック (0-100)
     * @returns {Promise<{places: Map, visits: Array, dateRange: {min: Date, max: Date}}>}
     */
    async function parseFiles(files, onProgress) {
        const allVisits = [];
        const totalFiles = files.length;

        for (let i = 0; i < files.length; i++) {
            onProgress(Math.round((i / totalFiles) * 80));
            const text = await readFile(files[i]);
            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                console.warn(`Failed to parse ${files[i].name}:`, e);
                continue;
            }

            const visits = extractVisits(data);
            allVisits.push(...visits);
        }

        onProgress(85);

        // 訪問データを日時順にソート
        allVisits.sort((a, b) => a.timestamp - b.timestamp);

        // 場所ごとに集計
        const places = aggregatePlaces(allVisits);

        onProgress(95);

        // 日付範囲を計算
        const dateRange = {
            min: allVisits.length > 0 ? new Date(allVisits[0].timestamp) : null,
            max: allVisits.length > 0 ? new Date(allVisits[allVisits.length - 1].timestamp) : null,
        };

        onProgress(100);

        return { places, visits: allVisits, dateRange };
    }

    function readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsText(file);
        });
    }

    /**
     * JSONデータからフォーマットを自動判定して訪問データを抽出
     */
    function extractVisits(data) {
        // Records.json 形式 (新フォーマット)
        if (data.locations && Array.isArray(data.locations)) {
            return parseRecordsFormat(data);
        }

        // Semantic Location History 形式
        if (data.timelineObjects && Array.isArray(data.timelineObjects)) {
            return parseSemanticFormat(data);
        }

        // 旧フォーマット (Location History.json)
        if (data.locations && Array.isArray(data.locations) && data.locations[0]?.latitudeE7) {
            return parseRecordsFormat(data);
        }

        // location-history.json 形式 (新タイムラインエクスポート)
        // 配列のルートに visit/activity オブジェクトが並ぶ形式
        if (Array.isArray(data) && data.length > 0 && (data[0].visit || data[0].activity)) {
            return parseNewTimelineFormat(data);
        }

        console.warn('Unknown data format:', Object.keys(data));
        return [];
    }

    /**
     * Records.json形式をパース
     * ロケーションポイントを適度に間引いて訪問として扱う
     */
    function parseRecordsFormat(data) {
        const visits = [];
        const locations = data.locations;

        // データが大量の場合は間引く（滞在点を検出）
        let prevLat = null;
        let prevLng = null;
        let stayCount = 0;
        const STAY_THRESHOLD = 0.001; // ~100m

        for (const loc of locations) {
            const lat = loc.latitudeE7 != null
                ? loc.latitudeE7 / 1e7
                : loc.latitude;
            const lng = loc.longitudeE7 != null
                ? loc.longitudeE7 / 1e7
                : loc.longitude;

            if (lat == null || lng == null) continue;
            if (lat === 0 && lng === 0) continue;

            const timestamp = parseTimestamp(loc.timestamp || loc.timestampMs);
            if (!timestamp) continue;

            // 前の位置からの差分で滞在判定
            if (prevLat !== null) {
                const dist = Math.abs(lat - prevLat) + Math.abs(lng - prevLng);
                if (dist < STAY_THRESHOLD) {
                    stayCount++;
                    if (stayCount < 3) continue; // 滞在点を検出するまでスキップ
                    stayCount = 0;
                } else {
                    stayCount = 0;
                }
            }

            visits.push({
                lat,
                lng,
                timestamp,
                name: loc.name || null,
                address: loc.address || null,
                placeId: loc.placeId || null,
            });

            prevLat = lat;
            prevLng = lng;
        }

        return visits;
    }

    /**
     * Semantic Location History形式をパース
     */
    function parseSemanticFormat(data) {
        const visits = [];

        for (const obj of data.timelineObjects) {
            if (obj.placeVisit) {
                const pv = obj.placeVisit;
                const location = pv.location;
                if (!location) continue;

                const lat = location.latitudeE7 != null
                    ? location.latitudeE7 / 1e7
                    : location.latitude;
                const lng = location.longitudeE7 != null
                    ? location.longitudeE7 / 1e7
                    : location.longitude;

                if (lat == null || lng == null) continue;
                if (lat === 0 && lng === 0) continue;

                const startTs = parseTimestamp(
                    pv.duration?.startTimestamp ||
                    pv.duration?.startTimestampMs
                );
                const endTs = parseTimestamp(
                    pv.duration?.endTimestamp ||
                    pv.duration?.endTimestampMs
                );

                visits.push({
                    lat,
                    lng,
                    timestamp: startTs || endTs || Date.now(),
                    endTimestamp: endTs,
                    name: location.name || null,
                    address: location.address || null,
                    placeId: location.placeId || null,
                    semanticType: location.semanticType || null,
                });
            }
        }

        return visits;
    }

    /**
     * 新タイムラインエクスポート形式をパース (location-history.json)
     * ルート配列に visit/activity オブジェクトが並ぶ形式
     * 座標は "geo:lat,lng" 文字列
     */
    function parseNewTimelineFormat(data) {
        const visits = [];

        for (const entry of data) {
            if (entry.visit) {
                const v = entry.visit;
                const candidate = v.topCandidate;
                if (!candidate || !candidate.placeLocation) continue;

                const coords = parseGeoUri(candidate.placeLocation);
                if (!coords) continue;

                const startTs = parseTimestamp(entry.startTime);
                const endTs = parseTimestamp(entry.endTime);

                visits.push({
                    lat: coords.lat,
                    lng: coords.lng,
                    timestamp: startTs || endTs || Date.now(),
                    endTimestamp: endTs,
                    name: null,
                    address: null,
                    placeId: candidate.placeID || null,
                    semanticType: candidate.semanticType || null,
                });
            }
        }

        return visits;
    }

    /**
     * "geo:lat,lng" 形式のURIをパース
     */
    function parseGeoUri(geoStr) {
        if (!geoStr || !geoStr.startsWith('geo:')) return null;
        const parts = geoStr.slice(4).split(',');
        if (parts.length < 2) return null;
        const lat = parseFloat(parts[0]);
        const lng = parseFloat(parts[1]);
        if (isNaN(lat) || isNaN(lng)) return null;
        if (lat === 0 && lng === 0) return null;
        return { lat, lng };
    }

    /**
     * タイムスタンプを数値(ms)に変換
     */
    function parseTimestamp(ts) {
        if (!ts) return null;
        if (typeof ts === 'number') {
            // milliseconds vs seconds
            return ts > 1e12 ? ts : ts * 1000;
        }
        if (typeof ts === 'string') {
            // ミリ秒の文字列
            if (/^\d+$/.test(ts)) {
                const n = parseInt(ts, 10);
                return n > 1e12 ? n : n * 1000;
            }
            // ISO 8601
            const d = new Date(ts);
            return isNaN(d.getTime()) ? null : d.getTime();
        }
        return null;
    }

    /**
     * 訪問データを場所ごとに集計
     */
    function aggregatePlaces(visits) {
        const places = new Map();

        for (const visit of visits) {
            // 場所の一意キーを生成（近接座標をグループ化）
            const key = getPlaceKey(visit);

            if (places.has(key)) {
                const place = places.get(key);
                place.visitCount++;
                place.visits.push(visit);
                // 名前が取得できた場合は更新
                if (visit.name && !place.name) {
                    place.name = visit.name;
                }
                if (visit.address && !place.address) {
                    place.address = visit.address;
                }
            } else {
                places.set(key, {
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

        return places;
    }

    /**
     * 座標を丸めて場所キーを生成
     * 約50m精度でグループ化
     */
    function getPlaceKey(visit) {
        if (visit.placeId) return `pid:${visit.placeId}`;
        const latRound = Math.round(visit.lat * 2000) / 2000;
        const lngRound = Math.round(visit.lng * 2000) / 2000;
        return `${latRound},${lngRound}`;
    }

    return { parseFiles };
})();
