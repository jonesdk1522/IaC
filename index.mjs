import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const AWS = require('aws-sdk');
const https = require('https');
const fs = require('fs');
const zlib = require('zlib');
import { URL } from 'url';

const s3 = new AWS.S3();

if (!process.env.SPLUNK_HEC_URL || !process.env.SPLUNK_HEC_TOKEN) {
    throw new Error('Missing required environment variables: SPLUNK_HEC_URL and/or SPLUNK_HEC_TOKEN');
}

const SPLUNK_HEC_URL = process.env.SPLUNK_HEC_URL;
const SPLUNK_HEC_TOKEN = process.env.SPLUNK_HEC_TOKEN;
const REQUEST_TIMEOUT_MS = 5000;
const ca = fs.readFileSync('./kinesis-lambda.pem');
https.globalAgent.options.ca = ca;

const BATCH_SIZE = 50;

export const handler = async (event) => {
    const results = await Promise.all(event.Records.map(async (record) => {
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
        let logData;

        try {
            const s3Object = await s3.getObject({ Bucket: bucket, Key: key }).promise();
            let body = s3Object.Body;

            // If gzipped, decompress
            if (key.endsWith('.gz')) {
                body = zlib.gunzipSync(body);
            }
            logData = body.toString('utf8');
        } catch (e) {
            console.error(`Failed to fetch or decompress S3 object: ${e.message}`);
            return { record, result: 'S3FetchFailed' };
        }

        // Split into lines, filter out empty lines
        const lines = logData.split(/\r?\n/).filter(line => line.trim().length > 0);
        const batches = [];
        for (let i = 0; i < lines.length; i += BATCH_SIZE) {
            batches.push(lines.slice(i, i + BATCH_SIZE));
        }

        // Send each batch to Splunk HEC
        const batchResults = await Promise.all(batches.map(async (batch) => {
            // HEC event array format
            const events = batch.map(line => ({
                sourcetype: 'json',
                index: 'main',
                host: 's3-lambda',
                event: line,
                fields: {
                    s3_bucket: bucket,
                    s3_key: key
                }
            }));

            const postData = events.map(e => JSON.stringify(e)).join('\n');
            const hecUrl = new URL(SPLUNK_HEC_URL);
            const options = {
                hostname: hecUrl.hostname,
                port: hecUrl.port || 443,
                path: hecUrl.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Splunk ${SPLUNK_HEC_TOKEN}`,
                    'Content-Length': Buffer.byteLength(postData)
                },
                timeout: REQUEST_TIMEOUT_MS
            };

            return new Promise((resolve) => {
                const req = https.request(options, (res) => {
                    let responseBody = '';
                    res.on('data', (chunk) => { responseBody += chunk; });
                    res.on('end', () => {
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            resolve({ result: 'Ok' });
                        } else {
                            console.error(`Splunk HEC error: ${res.statusCode} - ${responseBody}`);
                            resolve({ result: 'SplunkHECError' });
                        }
                    });
                });

                req.on('timeout', () => {
                    req.destroy();
                    console.error('Request to Splunk timed out');
                    resolve({ result: 'Timeout' });
                });

                req.on('error', (e) => {
                    console.error(`Request error to Splunk: ${e.message}`);
                    resolve({ result: 'RequestError' });
                });

                req.write(postData);
                req.end();
            });
        }));

        return { record, batchResults };
    }));

    return { results };
};
