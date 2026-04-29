FROM alpine:3.20

RUN apk add --no-cache openssh-server \
    && adduser -D -s /bin/sh testuser \
    && echo 'testuser:unused-test-password' | chpasswd \
    && mkdir -p /run/sshd /home/testuser/.ssh \
    && chown -R testuser:testuser /home/testuser/.ssh

COPY entrypoint.sh /entrypoint.sh

EXPOSE 22

ENTRYPOINT ["/entrypoint.sh"]
