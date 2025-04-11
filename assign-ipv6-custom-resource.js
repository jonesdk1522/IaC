'use strict';

const https = require('https');
const url = require('url');
const AWS = require('aws-sdk');

// Configure AWS region
AWS.config.update({ region: 'us-east-1' }); // Replace with your desired region
const ec2 = new AWS.EC2();

// function sendResponse(event, context, responseStatus, responseData) {
//   console.log(`[Mock Response] ${responseStatus}:`, responseData);
// }

// Uncomment the following lines to enable actual response sending

function sendResponse(event, context, responseStatus, responseData) {
  const responseBody = JSON.stringify({
    Status: responseStatus,
    Reason: `See the details in CloudWatch Log Stream: ${context.logStreamName}`,
    PhysicalResourceId: context.logStreamName,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: responseData,
  });

  const parsedUrl = url.parse(event.ResponseURL);
  const options = {
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.path,
    method: 'PUT',
    headers: {
      'Content-Type': '',
      'Content-Length': responseBody.length,
    },
  };

  const req = https.request(options, res => {
    console.log(`Status code: ${res.statusCode}`);
  });

  req.on('error', err => {
    console.error('sendResponse Error:', err);
  });

  req.write(responseBody);
  req.end();
}

function ipv6ToBigInt(ipv6) {
  const parts = ipv6.split("::");
  const head = parts[0].split(":");
  const tail = parts[1] ? parts[1].split(":") : [];
  const full = [
    ...head,
    ...Array(8 - head.length - tail.length).fill("0"),
    ...tail,
  ].map(h => h === "" ? "0" : h);
  return BigInt("0x" + full.map(p => p.padStart(4, "0")).join(""));
}

function bigIntToIpv6(bigint) {
  const hex = bigint.toString(16).padStart(32, "0");
  const parts = [];
  for (let i = 0; i < 32; i += 4) {
    parts.push(hex.slice(i, i + 4));
  }
  const ipv6 = parts.join(":").replace(/(^|:)0{1,3}/g, ":").replace(/(:0)+:/, "::");
  return ipv6.replace(/^:/, "").replace(/:$/, "");
}

function getSubnetIpv6Cidr(baseCidr, index, newPrefixLength = 64) {
  const [baseAddr, basePrefixLength] = baseCidr.split('/');
  const baseBigInt = ipv6ToBigInt(baseAddr);
  // For /56 to /64, we need to shift by 8 bits (64-56=8)
  // This will increment the subnet part directly
  const offset = BigInt(index) << BigInt(128 - newPrefixLength);
  const subnetAddrBigInt = baseBigInt + offset;
  return `${bigIntToIpv6(subnetAddrBigInt)}/${newPrefixLength}`;
}

exports.handler = async (event, context) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  const { SubnetIds, BaseIpv6Block } = event.ResourceProperties;

  if (event.RequestType === 'Delete') {
    return sendResponse(event, context, 'SUCCESS', { Message: 'No action needed on delete' });
  }

  try {
    for (let i = 0; i < SubnetIds.length; i++) {
      const subnetId = SubnetIds[i];
      const cidr = getSubnetIpv6Cidr(BaseIpv6Block, i);
      console.log(`Assigning ${cidr} to ${subnetId}`);
      await ec2.associateSubnetCidrBlock({
        SubnetId: subnetId,
        Ipv6CidrBlock: cidr,
      }).promise();
    }

    sendResponse(event, context, 'SUCCESS', { Message: 'IPv6 CIDRs assigned successfully' });
  } catch (err) {
    console.error('Error assigning CIDRs:', err);
    sendResponse(event, context, 'FAILED', { Error: err.message });
  }
};
