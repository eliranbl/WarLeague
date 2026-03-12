// Test oref API + local server

const API_BASE = 'https://alerts-history.oref.org.il//Shared/Ajax/GetAlarmsHistory.aspx?lang=he&mode=3';

function dateToNum(s) { const [d,m,y]=s.split('.'); return parseInt(y)*10000+parseInt(m)*100+parseInt(d); }

async function testOrefAPI() {
    console.log('=== Test oref API ===\n');

    try {
        console.log(`URL: ${API_BASE}`);
        const res = await fetch(API_BASE);
        console.log(`Status: ${res.status}`);
        const text = await res.text();
        console.log(`Response length: ${text.length} chars`);

        let data;
        try {
            data = JSON.parse(text);
        } catch {
            console.log('Not JSON! Start:', text.substring(0, 300));
            return;
        }

        if (!Array.isArray(data)) {
            console.log('Not an array:', JSON.stringify(data).substring(0, 300));
            return;
        }

        console.log(`Array with ${data.length} items`);
        if (data.length > 0) {
            console.log('First item:', JSON.stringify(data[0], null, 2));
            const cats = {};
            data.forEach(a => { cats[a.category] = (cats[a.category] || 0) + 1; });
            console.log('Categories:', cats);

            const dates = new Set(data.map(a => a.date));
            console.log('Unique dates:', [...dates].sort());
        }

        // Test date filtering
        console.log('\n--- Date filtering test ---');
        const allFrom = dateToNum('07.10.2023');
        const seasonFrom = dateToNum('28.02.2026');
        const now = dateToNum(new Date().toLocaleDateString('en-GB').replace(/\//g, '.'));

        const allFiltered = data.filter(a => { const d = dateToNum(a.date); return d >= allFrom && d <= now; });
        const seasonFiltered = data.filter(a => { const d = dateToNum(a.date); return d >= seasonFrom && d <= now; });

        console.log(`All (07.10.2023-today): ${allFiltered.length} alerts`);
        console.log(`שאגת הארי (28.02.2026-today): ${seasonFiltered.length} alerts`);
    } catch (err) {
        console.log('Error:', err.message);
    }
}

async function testLocalServer() {
    console.log('\n=== Test local server ===\n');

    const seasons = ['all', 'שאגת הארי'];

    for (const season of seasons) {
        try {
            const url = `http://localhost:3000/api/league?season=${encodeURIComponent(season)}`;
            console.log(`Season: ${season}`);
            const res = await fetch(url);
            const data = await res.json();
            console.log(`  Cities: ${data.stats.totalCities} | Alarms: ${data.stats.totalRealAlarms} | Busiest day: ${data.stats.busiestDay}`);
            if (data.league.length > 0) {
                console.log(`  #1: ${data.league[0].name} - ${data.league[0].points} pts (rockets: ${data.league[0].rockets}, warnings: ${data.league[0].warnings}, drones: ${data.league[0].drones})`);
            }
        } catch (err) {
            console.log(`  Error:`, err.message);
        }
    }

    // Test private league
    console.log('\n--- Private league test ---');
    try {
        const url = `http://localhost:3000/api/league?season=all&cities=${encodeURIComponent('חריש,עפולה')}`;
        console.log('Private league (חריש, עפולה):');
        const res = await fetch(url);
        const data = await res.json();
        console.log(`  Cities: ${data.stats.totalCities} | Alarms: ${data.stats.totalRealAlarms}`);
        data.league.forEach(t => console.log(`  ${t.name}: ${t.points} pts`));
    } catch (err) {
        console.log('  Error:', err.message);
    }
}

async function main() {
    await testOrefAPI();
    await testLocalServer();
}

main();
