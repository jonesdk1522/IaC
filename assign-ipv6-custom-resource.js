'use strict';

const https = require('https');
const url = require('url');
const AWS = require('aws-sdk');

// Configure AWS region
AWS.config.update({ region: 'us-gov-west-1' });
const ec2 = new AWS.EC2();

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
  try {
    console.log('Received event:', JSON.stringify(event, null, 2));

    // Handle DELETE requests immediately
    if (event.RequestType === 'Delete') {
      console.log('Delete request - sending immediate success response');
      await sendResponse(event, context, 'SUCCESS', {
        Message: 'Resource deletion initiated'
      });
      // Optionally perform cleanup after responding
      try {
        // Add any cleanup logic here
        console.log('Cleanup completed');
      } catch (cleanupError) {
        console.error('Cleanup error:', cleanupError);
        // Don't throw - we already sent success response
      }
      return;
    }

    // For CREATE and UPDATE, do the work first
    if (event.RequestType === 'Create' || event.RequestType === 'Update') {
      const { SubnetIds, VpcId } = event.ResourceProperties;

      // Need to get VPC Id
      const vpcResponse = await ec2.describeVpcs({
        VpcIds: [VpcId]
      }).promise();

      const vpc = vpcResponse.Vpcs[0];
      const ipv6Association = vpc.Ipv6CidrBlockAssociationSet?.[0];

      if (!ipv6Association?.ipv6CidrBlock) {
        throw new Error ('VPC has no IPv6 CIDR assigned.');
      }

      const baseIpv6Block = ipv6Association.Ipv6CidrBlock;

      for (let i = 0; i < SubnetIds.length; i++) {
        const subnetId = SubnetIds[i];
        const cidr = getSubnetIpv6Cidr(baseIpv6Block, i);
        console.log(`Assigning ${cidr} to ${subnetId}`);
        await ec2.associateSubnetCidrBlock({
          SubnetId: subnetId,
          Ipv6CidrBlock: cidr,
        }).promise();
      }

      // Send success response with the results
      await sendResponse(event, context, 'SUCCESS', {
        Message: `${event.RequestType} completed successfully`,
        VpcId: event.ResourceProperties.VpcId,
        SubnetIds: event.ResourceProperties.SubnetIds
      });
    }

  } catch (error) {
    console.error('Error:', error);
    await sendResponse(event, context, 'FAILED', {
      Message: `Error: ${error.message}`,
      StackTrace: error.stack
    });
  }

  // Ensure the function completes
  return {
    statusCode: 200,
    body: JSON.stringify({ 
      message: `${event.RequestType} operation completed` 
    })
  };
};
