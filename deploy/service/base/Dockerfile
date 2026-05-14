FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY service/base/package*.json ./
RUN npm ci

COPY service/base/ ./
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app

LABEL org.opencontainers.image.title="easy-sms-service"
LABEL org.opencontainers.image.description="Unified SMS aggregation runtime with provider health management and public inbox abstraction."
LABEL org.opencontainers.image.source="https://github.com/aiaimimi0920/EasySms"
LABEL org.opencontainers.image.url="https://github.com/aiaimimi0920/EasySms"
LABEL org.opencontainers.image.documentation="https://github.com/aiaimimi0920/EasySms/tree/main/deploy/service/base"

ENV NODE_ENV=production
ENV EASY_SMS_CONFIG_PATH=/etc/easy-sms/config.yaml
ENV EASY_SMS_RUNTIME_ENV_PATH=/etc/easy-sms/runtime.env
ENV EASY_SMS_BOOTSTRAP_PATH=/etc/easy-sms/bootstrap/r2-bootstrap.json
ENV EASY_SMS_STATE_DIR=/var/lib/easy-sms
ENV EASY_SMS_RESET_STORE_ON_BOOT=false

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates chromium gosu python3 python3-pip \
  && python3 -m pip install --no-cache-dir --break-system-packages boto3 curl_cffi pynacl \
  && rm -rf /var/lib/apt/lists/*

COPY service/base/package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY deploy/service/base/docker-entrypoint.sh /usr/local/bin/easy-sms-entrypoint.sh
COPY deploy/service/base/bootstrap-service-config.py /usr/local/bin/bootstrap-service-config.py
COPY scripts/easysms-import-code.py /usr/local/bin/easysms-import-code.py
COPY deploy/service/base/config.template.yaml /opt/easy-sms/config.template.yaml

RUN chmod +x /usr/local/bin/easy-sms-entrypoint.sh \
  && chmod +x /usr/local/bin/bootstrap-service-config.py \
  && chmod +x /usr/local/bin/easysms-import-code.py \
  && useradd -r -u 10001 easy \
  && mkdir -p /etc/easy-sms /var/lib/easy-sms/state /etc/easy-sms/bootstrap \
  && chown -R easy:easy /etc/easy-sms /var/lib/easy-sms

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/easy-sms-entrypoint.sh"]
CMD ["node", "dist/src/runtime/main.js"]
