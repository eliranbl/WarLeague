const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Load city list from cities.json
const citiesJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'data', 'cities.json'), 'utf-8'));
// Map from label to mixname for quick lookup
const cityMixnameMap = {};
citiesJson.forEach(c => { if (c.label) cityMixnameMap[c.label] = c.mixname; });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API base URL and date range for שאגת הארי
const API_BASE = 'https://alerts-history.oref.org.il//Shared/Ajax/GetAlarmsHistory.aspx?lang=he&mode=3';
const FROM_DATE = '28.02.2026';

// Convert date in DD.MM.YYYY format to number for comparison
function dateToNum(dateStr) {
    const [d, m, y] = dateStr.split('.');
    return parseInt(y) * 10000 + parseInt(m) * 100 + parseInt(d);
}

// Get today's date in DD.MM.YYYY format
function getTodayStr() {
    const now = new Date();
    const d = String(now.getDate()).padStart(2, '0');
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const y = now.getFullYear();
    return `${d}.${m}.${y}`;
}

// Filter alerts by date range
function filterByDateRange(alerts, fromDate, toDate) {
    const from = dateToNum(fromDate);
    const to = dateToNum(toDate);
    return alerts.filter(a => {
        const d = dateToNum(a.date);
        return d >= from && d <= to;
    });
}

// Fetch alert data from Home Front Command API
// city: if provided, adds &city_0=city to the URL
async function fetchData(city) {
    console.log(`Fetching data | city: ${city || 'all'}`);

    const toDate = getTodayStr();
    let url = `${API_BASE}&fromDate=${FROM_DATE}&toDate=${toDate}`;
    if (city) url += `&city_0=${encodeURIComponent(city)}`;

    try {
        const res = await fetch(url);
        const text = await res.text();

        let data;
        try {
            data = JSON.parse(text);
        } catch {
            console.error('Invalid response (not JSON):', text.substring(0, 200));
            return [];
        }

        if (!Array.isArray(data)) {
            console.error('Response is not an array:', JSON.stringify(data).substring(0, 200));
            return [];
        }

        // Filter by date range on server side
        const filtered = filterByDateRange(data, FROM_DATE, toDate);
        console.log(`  Received ${data.length} from API, ${filtered.length} after date filter (${FROM_DATE}-${toDate})`);
        return filtered;
    } catch (err) {
        console.error('Error fetching data:', err.message);
        return [];
    }
}

// Process data into league table
function processLeagueData(data) {
    const teams = {};
    let totalRealAlarms = 0;
    const datesCount = {};

    data.forEach(alert => {
        const cat = alert.category;
        const city = alert.data;
        const date = alert.date;

        if (!teams[city]) teams[city] = { name: city, warnings: 0, rockets: 0, drones: 0, total: 0, points: 0 };

        if (cat === 14) {
            teams[city].warnings++;
            teams[city].total++;
            teams[city].points += 1;
            totalRealAlarms++;
            if (!datesCount[date]) datesCount[date] = 0;
            datesCount[date]++;
        } else if (cat === 1) {
            teams[city].rockets++;
            teams[city].total++;
            teams[city].points += 2;
            totalRealAlarms++;
            if (!datesCount[date]) datesCount[date] = 0;
            datesCount[date]++;
        } else if (cat === 2) {
            teams[city].drones++;
            teams[city].total++;
            teams[city].points += 3;
            totalRealAlarms++;
            if (!datesCount[date]) datesCount[date] = 0;
            datesCount[date]++;
        }
    });

    // Find busiest day
    let busiestDay = "-";
    let maxAlarmsInDay = 0;
    for (const [d, count] of Object.entries(datesCount)) {
        if (count > maxAlarmsInDay) {
            maxAlarmsInDay = count;
            busiestDay = d;
        }
    }

    // Sort by points and assign rank
    const league = Object.values(teams).sort((a, b) => b.points - a.points);
    league.forEach((team, index) => team.rank = index + 1);

    return {
        league,
        stats: {
            totalRealAlarms,
            busiestDay,
            maxAlarmsInDay,
            totalCities: league.length
        }
    };
}

// City search with autocomplete from cities.json
// GET /api/cities?q=...&limit=15
app.get('/api/cities', (req, res) => {
    const q = req.query.q || '';
    const limit = parseInt(req.query.limit) || 15;

    let results = citiesJson;
    if (q) {
        results = citiesJson.filter(c => c.label && c.label.includes(q));
    }

    res.json(results.slice(0, limit).filter(c => c && c.label).map(c => ({
        label: c.label,
        mixname: c.mixname || c.label
    })));
});

// League table with private league + search
// GET /api/league?cities=city1,city2&search=...
app.get('/api/league', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
        const citiesParam = req.query.cities;
        const search = req.query.search || '';

        console.log(`API /league | search: ${search || '-'} | cities: ${citiesParam || '-'}`);

        let allAlerts = [];

        if (citiesParam) {
            // Private league - fetch each city separately with date params
            const cities = citiesParam.split(',').map(c => c.trim());
            const fetches = cities.map(city => fetchData(city));
            const results = await Promise.all(fetches);
            results.forEach(alerts => allAlerts.push(...alerts));
        } else if (search) {
            // Search - fetch specific city
            allAlerts = await fetchData(search);
        } else {
            // All data
            allAlerts = await fetchData(null);
        }

        const result = processLeagueData(allAlerts);

        // Add mixname from cities.json
        result.league.forEach(team => {
            team.mixname = cityMixnameMap[team.name] || team.name;
        });

        res.json(result);
    } catch (err) {
        console.error('League API error:', err);
        res.status(500).json({ error: 'Failed to process league data', league: [], stats: { totalRealAlarms: 0, busiestDay: '-', maxAlarmsInDay: 0, totalCities: 0 } });
    }
});

// Start server
app.listen(PORT, async () => {
    console.log(`League Server is running on http://localhost:${PORT}`);
    // Preload data
    await fetchData(null);
    console.log('Data loaded successfully');
});
