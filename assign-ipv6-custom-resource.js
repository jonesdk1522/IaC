'use strict';

const https = require('https');
const url = require('url');
const AWS = require('aws-sdk');

// Configure AWS region
AWS.config.update({ region: 'us-gov-west-1' });
const ec2 = new AWS.EC2();

function sendResponse(event, context, responseStatus, responseData) {
  return new Promise((resolve, reject) => {
    const responseBody = JSON.stringify({
      Status: responseStatus,
      Reason: `See the details in CloudWatch Log Stream: ${context.logStreamName}`,
      PhysicalResourceId: event.PhysicalResourceId || context.logStreamName,
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
      resolve();
    });

    req.on('error', err => {
      console.error('sendResponse Error:', err);
      reject(err);
    });

    req.write(responseBody);
    req.end();
  });
}

function ipv6ToBigInt(ipv6) {
  try {
    console.log('Input IPv6:', ipv6);
    const [address] = ipv6.split('/');
    const parts = address.split(':');
    const doubleColonIndex = parts.indexOf('');
    if (doubleColonIndex !== -1) {
      const zerosCount = 8 - (parts.length - 1);
      const zeros = Array(zerosCount).fill('0');
      parts.splice(doubleColonIndex, 1, ...zeros);
    }
    const normalizedParts = parts.map(part => part.padStart(4, '0'));
    const hexString = normalizedParts.join('');
    console.log('Hex string:', hexString);
    return BigInt(`0x${hexString}`);
  } catch (error) {
    console.error('Error in ipv6ToBigInt:', error);
    throw error;
  }
}

function bigIntToIpv6(value) {
  try {
    console.log('Input value:', value.toString());
    let hex = value.toString(16);
    while (hex.length < 32) {
      hex = '0' + hex;
    }
    const segments = [];
    for (let i = 0; i < 32; i += 4) {
      segments.push(hex.slice(i, i + 4));
    }
    let ipv6 = segments.join(':');
    const zeroRun = /:0(?::0)+/;
    const match = ipv6.match(zeroRun);
    if (match) {
      ipv6 = ipv6.replace(match[0], '::');
    }
    console.log('Output IPv6:', ipv6);
    return ipv6;
  } catch (error) {
    console.error('Error in bigIntToIpv6:', {
      input: value,
      error: error.message
    });
    throw error;
  }
}

function getSubnetIpv6Cidr(baseVpcCidr, index) {
  try {
    const [baseAddress] = baseVpcCidr.split('/');
    const segments = baseAddress.split(':');
    const baseNum = parseInt(segments[3], 16);
    segments[3] = (baseNum + index).toString(16);
    return `${segments.join(':')}/64`;
  } catch (error) {
    console.error('Error creating subnet CIDR:', error);
    throw error;
  }
}

exports.handler = async (event, context) => {
  try {
    console.log('Received event:', JSON.stringify(event, null, 2));

    if (event.RequestType === 'Delete') {
      try {
        console.log('Delete request received.');
        const { SubnetIds } = event.ResourceProperties;

        for (const subnetId of SubnetIds) {
          console.log(`Note: IPv6 CIDRs on ${subnetId} cannot be disassociated. Subnet will retain CIDRs unless deleted.`);
        }

        console.log('No disassociation possible — cleanup step complete.');

        await sendResponse(event, context, 'SUCCESS', {
          Message: 'Delete handled. IPv6 CIDRs remain unless subnet is deleted manually.'
        });
      } catch (cleanupError) {
        console.error('Error during DELETE cleanup:', cleanupError);
        await sendResponse(event, context, 'FAILED', {
          Message: `Cleanup error during delete: ${cleanupError.message}`
        });
        throw cleanupError;
      }
      return;
    }

    if (event.RequestType === 'Create' || event.RequestType === 'Update') {
      const { SubnetIds, VpcId } = event.ResourceProperties;

      const vpcResponse = await ec2.describeVpcs({ VpcIds: [VpcId] }).promise();
      const vpc = vpcResponse.Vpcs[0];
      const ipv6Association = vpc.Ipv6CidrBlockAssociationSet?.[0];

      if (!ipv6Association?.Ipv6CidrBlock) {
        throw new Error('VPC has no IPv6 CIDR assigned.');
      }

      const baseIpv6Block = ipv6Association.Ipv6CidrBlock;
      const subnetsResponse = await ec2.describeSubnets({ SubnetIds }).promise();

      for (let i = 0; i < SubnetIds.length; i++) {
        const subnetId = SubnetIds[i];
        const subnet = subnetsResponse.Subnets.find(s => s.SubnetId === subnetId);

        if (subnet.Ipv6CidrBlockAssociationSet?.length > 0) {
          console.log(`Subnet ${subnetId} already has IPv6 CIDR (${subnet.Ipv6CidrBlockAssociationSet[0].Ipv6CidrBlock}), skipping.`);
          continue;
        }

        const cidr = getSubnetIpv6Cidr(baseIpv6Block, i);
        console.log(`Assigning ${cidr} to ${subnetId}`);
        await ec2.associateSubnetCidrBlock({
          SubnetId: subnetId,
          Ipv6CidrBlock: cidr,
        }).promise();
      }

      await sendResponse(event, context, 'SUCCESS', {
        Message: `${event.RequestType} completed successfully`,
        VpcId,
        SubnetIds
      });

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: `${event.RequestType} operation completed`
        })
      };
    }

  } catch (error) {
    console.error('Error:', error);
    await sendResponse(event, context, 'FAILED', {
      Message: `Error: ${error.message}`,
      StackTrace: error.stack
    });
    throw error;
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: `${event.RequestType} operation completed`
    })
  };
};
