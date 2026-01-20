// Simple local development server
// Run with: node server.js

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3001;

// Load environment variables from .env.local
function loadEnvFile() {
    try {
        const envPath = path.join(__dirname, '.env.local');
        const envContent = fs.readFileSync(envPath, 'utf8');
        const lines = envContent.split('\n');
        const env = {};
        lines.forEach(line => {
            const [key, ...valueParts] = line.split('=');
            if (key && valueParts.length) {
                env[key.trim()] = valueParts.join('=').trim();
            }
        });
        return env;
    } catch (e) {
        console.error('Error loading .env.local:', e.message);
        return {};
    }
}

const env = loadEnvFile();
const SF_CLIENT_ID = env.SF_CLIENT_ID || process.env.SF_CLIENT_ID;
const SF_CLIENT_SECRET = env.SF_CLIENT_SECRET || process.env.SF_CLIENT_SECRET;
const SF_REFRESH_TOKEN = env.SF_REFRESH_TOKEN || process.env.SF_REFRESH_TOKEN;
const SF_INSTANCE_URL = env.SF_INSTANCE_URL || process.env.SF_INSTANCE_URL;

// MIME types
const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.csv': 'text/csv'
};

// Salesforce API handler
async function handleSalesforceAPI(req, res) {
    console.log('[API] Fetching from Salesforce...');

    try {
        // Step 1: Get access token
        const tokenParams = new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: SF_CLIENT_ID,
            client_secret: SF_CLIENT_SECRET,
            refresh_token: SF_REFRESH_TOKEN
        });

        const tokenResponse = await fetch('https://login.salesforce.com/services/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: tokenParams.toString()
        });

        const tokenData = await tokenResponse.json();
        if (!tokenData.access_token) {
            throw new Error(tokenData.error_description || 'OAuth failed');
        }
        console.log('[API] Got access token');

        // Step 2: Execute SOQL query with pagination
        const soqlQuery = `SELECT Id, Amount, CloseDate, Quote_sent_TImestamp_2__c, StageName, Owner.Name FROM Opportunity WHERE Quote_sent_TImestamp_2__c != null`;

        let allRecords = [];
        let nextUrl = `${SF_INSTANCE_URL}/services/data/v59.0/query?q=${encodeURIComponent(soqlQuery)}`;

        while (nextUrl) {
            const queryResponse = await fetch(nextUrl, {
                headers: {
                    'Authorization': `Bearer ${tokenData.access_token}`,
                    'Content-Type': 'application/json'
                }
            });

            const queryData = await queryResponse.json();
            if (queryData.records) {
                allRecords = allRecords.concat(queryData.records);
            }
            nextUrl = queryData.nextRecordsUrl ? `${SF_INSTANCE_URL}${queryData.nextRecordsUrl}` : null;
        }

        console.log(`[API] Fetched ${allRecords.length} records`);

        // Step 3: Transform data
        const transformedData = allRecords.map(record => ({
            'Amount': record.Amount != null ? record.Amount.toString() : '0',
            'Close Date': formatDateMDY(record.CloseDate),
            'Quote sent TImestamp 2': formatTimestamp(record.Quote_sent_TImestamp_2__c),
            'Stage': record.StageName || '',
            'Opportunity Owner': record.Owner?.Name || 'Unknown',
            'Close Month': deriveCloseMonth(record.CloseDate)
        }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            data: transformedData,
            recordCount: transformedData.length,
            fetchedAt: new Date().toISOString()
        }));

    } catch (error) {
        console.error('[API] Error:', error.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: false,
            error: error.message,
            code: 'API_ERROR'
        }));
    }
}

// Date formatting helpers
function formatDateMDY(isoDate) {
    if (!isoDate) return '';
    const [year, month, day] = isoDate.split('-');
    return `${parseInt(month, 10)}/${parseInt(day, 10)}/${year}`;
}

function formatTimestamp(isoTimestamp) {
    if (!isoTimestamp) return '';
    const date = new Date(isoTimestamp);
    return date.toLocaleString('en-US', {
        month: 'numeric',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}

function deriveCloseMonth(isoDate) {
    if (!isoDate) return '';
    const [year, month] = isoDate.split('-');
    return `${parseInt(month, 10)}/1/${year}`;
}

// Create server
const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // API endpoint
    if (req.url === '/api/salesforce') {
        await handleSalesforceAPI(req, res);
        return;
    }

    // Static file serving
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(__dirname, 'public', filePath);

    const ext = path.extname(filePath);
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('Not Found');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

server.listen(PORT, () => {
    console.log(`\n🚀 Server running at http://localhost:${PORT}`);
    console.log(`\n   Open this URL in your browser to test the dashboard.`);
    console.log(`   Click "Fetch from Salesforce" to test the API.\n`);
});
