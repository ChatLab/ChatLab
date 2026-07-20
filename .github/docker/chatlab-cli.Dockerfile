# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim

ARG CHATLAB_VERSION

RUN test -n "$CHATLAB_VERSION" \
    && apt-get update \
    && apt-get install --yes --no-install-recommends g++ make python3 \
    && npm install --global --omit=dev "chatlab-cli@${CHATLAB_VERSION}" \
    && npm cache clean --force \
    && apt-get purge --yes --auto-remove g++ make python3 \
    && rm -rf /var/lib/apt/lists/*

ENV CHATLAB_DATA_DIR=/data

RUN install -d -o node -g node /data

WORKDIR /data

USER node

EXPOSE 3110

ENTRYPOINT ["chatlab"]
CMD ["start", "--no-open", "--host", "0.0.0.0"]
