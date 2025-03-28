FROM amazonlinux:2

# Install ClamAV and dependencies
RUN yum update -y && \
    yum install -y clamav clamav-update zip shadow-utils && \
    yum clean all && \
    rm -rf /var/cache/yum

# Create directories for Lambda layer
WORKDIR /home/build
RUN mkdir -p lambda/bin lambda/lib lambda/conf

# Copy required binaries and libraries
RUN cp /usr/bin/clamscan /home/build/lambda/bin/ && \
    cp /usr/bin/freshclam /home/build/lambda/bin/ && \
    cp -r /usr/lib64/libclamav.so* /home/build/lambda/lib/ && \
    cp -r /usr/lib64/libcrypto.so* /home/build/lambda/lib/ && \
    cp -r /usr/lib64/libssl.so* /home/build/lambda/lib/ && \
    cp -r /usr/lib64/libjson-c.so* /home/build/lambda/lib/ && \
    cp -r /usr/lib64/libpcre2-8.so* /home/build/lambda/lib/ && \
    cp -r /usr/lib64/libxml2.so* /home/build/lambda/lib/ && \
    cp -r /usr/lib64/libz.so* /home/build/lambda/lib/ && \
    cp -r /usr/lib64/libbz2.so* /home/build/lambda/lib/

# Copy and configure freshclam config
COPY freshclam.conf /home/build/lambda/conf/
RUN chmod 644 /home/build/lambda/conf/freshclam.conf

# Create Lambda layer zip
WORKDIR /home/build
RUN zip -r9 clamav_lambda_layer.zip lambda/
