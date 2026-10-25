ARG PLAYWRIGHT=1.64.1
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT}-noble

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential pkg-config curl git python3 \
      libwebkit2gtk-4.1-dev libgtk-3-dev libxdo-dev libssl-dev \
 && rm -rf /var/lib/apt/lists/*

ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo PATH=/usr/local/cargo/bin:$PATH
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable --component rustfmt,clippy \
 && chmod -R a+w $RUSTUP_HOME $CARGO_HOME

RUN npm install -g n && n 22 && npm uninstall -g n

ENV COREPACK_HOME=/usr/local/corepack
RUN mkdir -p $COREPACK_HOME && corepack enable && corepack prepare pnpm@11.21.0 --activate && chmod -R a+rwX $COREPACK_HOME \
 && git config --system --add safe.directory '*'

ENV CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
WORKDIR /work
