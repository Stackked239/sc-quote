// Salesforce API Integration - Vercel Serverless Function
// Fetches opportunity data and transforms it to match the dashboard's expected format

export default async function handler(req, res) {
    // Only allow GET requests
    if (req.method !== 'GET') {
        return res.status(405).json({
            success: false,
            error: 'Method not allowed',
            code: 'METHOD_NOT_ALLOWED'
        });
    }

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        // Step 1: Get access token using refresh token
        const accessToken = await refreshAccessToken();

        // Step 2: Execute SOQL query
        const opportunities = await querySalesforce(accessToken);

        // Step 3: Transform data to match CSV format
        const transformedData = transformData(opportunities);

        // Step 4: Return success response
        return res.status(200).json({
            success: true,
            data: transformedData,
            recordCount: transformedData.length,
            fetchedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error('Salesforce API Error:', error);

        return res.status(error.status || 500).json({
            success: false,
            error: error.message || 'An unexpected error occurred',
            code: error.code || 'UNKNOWN_ERROR'
        });
    }
}

/**
 * Exchange refresh token for access token
 */
async function refreshAccessToken() {
    const { SF_CLIENT_ID, SF_CLIENT_SECRET, SF_REFRESH_TOKEN } = process.env;

    if (!SF_CLIENT_ID || !SF_CLIENT_SECRET || !SF_REFRESH_TOKEN) {
        const error = new Error('Missing Salesforce credentials in environment variables');
        error.code = 'CONFIG_ERROR';
        error.status = 500;
        throw error;
    }

    const tokenUrl = 'https://login.salesforce.com/services/oauth2/token';

    const params = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: SF_CLIENT_ID,
        client_secret: SF_CLIENT_SECRET,
        refresh_token: SF_REFRESH_TOKEN
    });

    const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const error = new Error(errorData.error_description || 'Failed to authenticate with Salesforce');
        error.code = 'AUTH_ERROR';
        error.status = 401;
        throw error;
    }

    const data = await response.json();
    return data.access_token;
}

/**
 * Execute SOQL query against Salesforce
 */
async function querySalesforce(accessToken) {
    const { SF_INSTANCE_URL } = process.env;

    if (!SF_INSTANCE_URL) {
        const error = new Error('Missing SF_INSTANCE_URL in environment variables');
        error.code = 'CONFIG_ERROR';
        error.status = 500;
        throw error;
    }

    // SOQL query to fetch opportunities with quote data
    const soqlQuery = `
        SELECT Id, Amount, CloseDate, Quote_sent_TImestamp_2__c, StageName, Owner.Name
        FROM Opportunity
        WHERE Quote_sent_TImestamp_2__c != null
    `.trim().replace(/\s+/g, ' ');

    const queryUrl = `${SF_INSTANCE_URL}/services/data/v59.0/query?q=${encodeURIComponent(soqlQuery)}`;

    let allRecords = [];
    let nextRecordsUrl = queryUrl;

    // Handle pagination - Salesforce returns max 2000 records per request
    while (nextRecordsUrl) {
        const response = await fetch(nextRecordsUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const error = new Error(errorData[0]?.message || 'Failed to query Salesforce');
            error.code = 'QUERY_ERROR';
            error.status = response.status;
            throw error;
        }

        const data = await response.json();
        allRecords = allRecords.concat(data.records || []);

        // Check if there are more records
        if (data.nextRecordsUrl) {
            nextRecordsUrl = `${SF_INSTANCE_URL}${data.nextRecordsUrl}`;
        } else {
            nextRecordsUrl = null;
        }
    }

    return allRecords;
}

/**
 * Transform Salesforce API response to match CSV format expected by dashboard
 */
function transformData(records) {
    return records.map(record => ({
        'Amount': record.Amount != null ? record.Amount.toString() : '0',
        'Close Date': formatDateMDY(record.CloseDate),
        'Quote sent TImestamp 2': formatTimestamp(record.Quote_sent_TImestamp_2__c),
        'Stage': record.StageName || '',
        'Opportunity Owner': record.Owner?.Name || 'Unknown',
        'Close Month': deriveCloseMonth(record.CloseDate)
    }));
}

/**
 * Convert ISO date to M/D/YYYY format
 * "2023-07-20" -> "7/20/2023"
 */
function formatDateMDY(isoDate) {
    if (!isoDate) return '';
    const [year, month, day] = isoDate.split('-');
    return `${parseInt(month, 10)}/${parseInt(day, 10)}/${year}`;
}

/**
 * Convert ISO timestamp to dashboard format
 * "2023-08-28T12:07:00.000+0000" -> "8/28/2023, 12:07 PM"
 */
function formatTimestamp(isoTimestamp) {
    if (!isoTimestamp) return '';

    const date = new Date(isoTimestamp);

    // Use toLocaleString with specific options to match expected format
    return date.toLocaleString('en-US', {
        month: 'numeric',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'America/New_York' // Adjust timezone as needed
    });
}

/**
 * Derive Close Month from CloseDate
 * "2023-07-20" -> "7/1/2023"
 */
function deriveCloseMonth(isoDate) {
    if (!isoDate) return '';
    const [year, month] = isoDate.split('-');
    return `${parseInt(month, 10)}/1/${year}`;
}
