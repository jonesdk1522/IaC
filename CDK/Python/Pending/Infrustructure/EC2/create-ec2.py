import pulumi
import pulumi_aws as aws

size = 't2.micro'
ami = aws.ec2.get_ami(most_recent="true",
                  owners=["137112412989"],
                  filters=[{"name":"name","values":["amzn-ami-hvm-*"]}])

group = aws.ec2.SecurityGroup('webserver-secgrp',
    description='Enable HTTP access',
    ingress=[
        { 'protocol': 'tcp', 'from_port': 22, 'to_port': 22, 'cidr_blocks': ['0.0.0.0/0'] }
    ])

server = aws.ec2.Instance('webserver-www',
    instance_type=size,
    vpc_security_group_ids=[group.id], # reference security group from above
    ami=ami.id)

pulumi.export('publicIp', server.public_ip)
pulumi.export('publicHostName', server.public_dns)