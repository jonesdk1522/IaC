
const {
  S3Client,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const s3 = new S3Client({ region: process.env.AWS_REGION });

exports.handler = async (event) => {
  for (const record of event.Records) {
    try {
      const message = JSON.parse(record.body);
      const bucket = message.Records[0].s3.bucket.name;
      const key = decodeURIComponent(message.Records[0].s3.object.key.replace(/\+/g, " "));
      const localPath = `/tmp/${path.basename(key)}`;

      console.log(`📥 Downloading s3://${bucket}/${key}`);
      const objectData = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));

      const writeStream = fs.createWriteStream(localPath);
      await new Promise((resolve, reject) => {
        objectData.Body.pipe(writeStream)
          .on("finish", resolve)
          .on("error", reject);
      });

      console.log("🔍 Scanning with ClamAV...");
      const scanClean = await new Promise((resolve, reject) => {
        exec(`/opt/bin/clamscan --database=/opt/lib ${localPath}`, (error, stdout, stderr) => {
          console.log("🧪 Scan output:", stdout);
          console.log("⚠️ Scan error (if any):", stderr);

          if (error) {
            if (error.code === 1) {
              console.log("🚨 Virus detected!");
              resolve(false); // Virus found
            } else {
              return reject(error); // Actual error
            }
          } else {
            console.log("✅ File is clean.");
            resolve(stdout.includes("OK"));
          }
        });
      });

      const destination = scanClean ? process.env.CLEAN_BUCKET : process.env.QUARANTINE_BUCKET;
      console.log(`📤 Copying to ${destination}...`);

      try {
        await s3.send(new CopyObjectCommand({
          Bucket: destination,
          CopySource: `${bucket}/${encodeURIComponent(key)}`,
          Key: key,
        }));
        console.log(`✅ Successfully copied to ${destination}`);
      } catch (copyErr) {
        console.error("❌ Copy failed:", copyErr);
      }

      console.log(`🧹 Deleting original from s3://${bucket}/${key}`);
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      console.log("🗑️ Original file deleted.");
    } catch (err) {
      console.error("💥 Error processing file:", err);
    }
  }
};
