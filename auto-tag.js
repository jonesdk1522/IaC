'use-strict';

const AWS = require("aws-sdk");
              const ec2 = new AWS.EC2();
              const autoscaling = new AWS.AutoScaling();

              const allowedAsgs = ["ProxyASG", "MailRelayASG"];

              exports.handler = async (event) => {
                const instanceId = event.detail?.EC2InstanceId;
                const az = event.detail?.AvailabilityZone;
                const asgName = event.detail?.AutoScalingGroupName;
                const hookName = event.detail?.LifecycleHookName;

                if (!instanceId || !asgName || !hookName) {
                  console.warn("Missing required fields");
                  return;
                }

                if (!allowedAsgs.includes(asgName)) {
                  console.log("Not an allowed ASG:", asgName);
                  return;
                }

                const suffix = instanceId.slice(-4);
                let prefix = "";

                if (asgName === "ProxyASG") {
                    prefix = "ProxyServer"
                } else if (asgName === "MailRelayASG") {
                    prefix = "MailRelayServer"
                }

                const nameTag = `${prefix}-${suffix}`

                await ec2.createTags({
                  Resources: [instanceId],
                  Tags: [
                    { Key: "Name", Value: nameTag }
                  ]
                }).promise();

                await autoscaling.completeLifecycleAction({
                  AutoScalingGroupName: asgName,
                  LifecycleHookName: hookName,
                  InstanceId: instanceId,
                  LifecycleActionResult: "CONTINUE"
                }).promise();

                console.log("Tagged and continued instance:", instanceId);
              };
