# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim

ARG CHATLAB_VERSION
ENV CHATLAB_LOCAL_EMBEDDING_RUNTIME_DIR=/opt/chatlab/local-embedding

RUN test -n "$CHATLAB_VERSION" \
    && apt-get update \
    && apt-get install --yes --no-install-recommends g++ make python3 \
    && npm install --global --omit=dev "chatlab-cli@${CHATLAB_VERSION}" \
    && CHATLAB_SKIP_UPDATE_CHECK=1 chatlab runtime install local-embedding \
    && npm cache clean --force \
    && apt-get purge --yes --auto-remove g++ make python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /home/node

RUN mkdir -p .chatlab \
    && chown node:node .chatlab

USER node

EXPOSE 3110

ENTRYPOINT ["chatlab"]
CMD ["start", "--no-open", "--host", "0.0.0.0"]
